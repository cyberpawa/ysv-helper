import os
import json
import re
import time
import hmac
import hashlib
import asyncio
import base64
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from urllib.parse import parse_qsl
from fastapi import FastAPI, Request, Header, HTTPException, status, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import google.generativeai as genai

from api.database.session import get_supabase
from api.services.excel_service import generate_excel_bytes
from api.services.email_service import send_tabel_email_bytes
from api.bot.handlers import bot, dp

# Налаштування доступу до Gemini API
GEMINI_KEY = os.getenv("GEMINI_API_KEY") or os.getenv("API_KEY")
if GEMINI_KEY:
    genai.configure(api_key=GEMINI_KEY, transport="rest")

generation_config = {
    "temperature": 0.0,
    "response_mime_type": "application/json"
    }

# Системні інструкції для ШІ-моделі винесені в окрему константу
SYSTEM_PROMPT = """
<ROLE>
You are a flawless Optical Character Recognition (OCR) API. Your sole purpose is to digitize handwritten Ukrainian Form P-5 timesheets into a strict JSON format. You are a transcription engine, not a calculator.
</ROLE>

<CRITICAL_DIRECTIVES>
1. ZERO HALLUCINATION & ANTI-SEMANTIC OVERRIDE: Transcribe ONLY what is physically written. Do not guess codes based on context. If a cell has "-" for hours, do NOT automatically assume the code is "ВЩ". Look closely at the ink: differentiate strictly between the letter "В" and "ВЩ".
2. INDEPENDENT ROWS: The document contains 4 distinct employee rows. Treat every row as a completely new image. NEVER copy data from Employee 1 to Employee 2, 3, or 4.
3. ANTI-COPYCAT & MID-MONTH CHANGES: Employee schedules frequently change abruptly mid-month (e.g., suddenly switching from "Р" to "В" for vacation). Do NOT let autoregressive patterns blind you. Employee 4 is unique. Pay extreme visual attention to the bottom rows to catch these sudden code changes. Verify the ink for every single day independently.
4. EXACT CYRILLIC: Output Ukrainian text exactly as written.
5. DECIMAL FORMAT: Always use a comma for decimals (e.g., "8,25").
6. BLANK CELLS HANDLING: 
   - For daily chunks (days 01-31): If a cell is empty or has a dash, output "-_-".
   - For Totals and Absences sections: If a cell is empty or has a dash, output an empty string "". NEVER use "-_-" in totals or absences.
7. CROSSED OUT DAYS (WEEKENDS): Do not rush! Before processing employee rows, you MUST explicitly scan the top header row (containing day numbers 01 to 31). Look carefully for thin handwritten diagonal strokes or 'X' marks crossing out these numbers.
</CRITICAL_DIRECTIVES>

<SPECIFIC_CORRECTIONS>
CRITICAL WARNING FOR ABSENCE CODES (Right side of the table):
- In the absence reason columns, the TOP cell contains ONLY NUMERIC CODES (e.g., 8, 24).
- It is visually impossible for a letter to be here. 
- If you see a shape that resembles the Cyrillic letter "В" (Ve) or "B", it is STRICTLY the number "8".
- ALWAYS output digits for absence codes. NEVER letters.
</SPECIFIC_CORRECTIONS>

<EXTRACTION_ALGORITHM>
Follow these steps linearly:

STEP 1: METADATA
- "period_text": Extract the full description of the reporting period from the main title line. It MUST explicitly include the word "місяць" or "місяця" formatted in the exact grammatical case written (e.g., "березеньBox" or "першу половину березня місяця"). NEVER output just a standalone month name like "березень".
- "year": 4-digit year string from the title line (e.g., "2026").
- "date_filled": Top right date (DD.MM.YYYY).
- "period_start" & "period_end": Top right reporting period (DD.MM).
- "period_type": If period_end is "15", type is "A". If >= "28", type is "B".
- "crossed_out_headers": Inspect every cell in the day-header rows (columns 01-31). If a cell is highlighted, hatched, or has a distinct handwritten diagonal line or 'X' drawn through it, add its zero-padded number (e.g., "01", "07", "11", "X") to the array. If no cells are marked, return [].

STEP 2: CELL FORMATTING PROTOCOL (Days 01-31)
Each day column has two sub-rows:
- TOP sub-row: Hours worked (e.g., "8,25", "7") or empty/dash.
- BOTTOM sub-row: Attendance code (e.g., "Р", "ВЩ", "В", "ТН") or empty/dash.
- Combine them as: "[BOTTOM_CODE]_[TOP_HOURS]".
- Valid examples: "Р_8,25", "ВЩ_-", "-_-"

STEP 3: CHUNKED ROW PROCESSING (PREVENTS COPYING)
Process each of the 4 employee rows strictly chunk by chunk:
- Chunk 1: Days 01-05
- Chunk 2: Days 06-10
- Chunk 3: Days 11-15
- Chunk 4: Days 16-20 (If period_type is "A", output "-_-" for all without reading)
- Chunk 5: Days 21-25 (If period_type is "A", output "-_-" for all without reading)
- Chunk 6: Days 26-31 (If period_type is "A", output "-_-" for all without reading)

STEP 4: TOTALS & ABSENCES (USE EMPTY STRINGS "" FOR BLANKS)
- "totals_days": Integer from "Відпрацьовано за місяць" -> "днів". Output "" if blank.
- "totals_hours": Decimal from "Відпрацьовано за місяць" -> "годин". Output "" if blank.
- Absence Totals Column (The first column in the absences block - "Всього неявок"):
  * "absences_total_days" = The value written in the TOP cell of this column.
  * "absences_total_hours" = The value written in the BOTTOM cell of this column.
- Absence Reason Columns (The remaining columns in the absences block):
  * "code" = The value in the TOP cell (STRICTLY NUMERIC).
  * "days" & "hours" = The value in the BOTTOM cell. It is usually written as a fraction "days/hours" (e.g., "5/40"). Extract the number of days and hours respectively. If only one number is present, determine if it's days or hours based on context.
  * ONLY create an object for a column if it has data. Format: {"col": "XX", "code": "Y", "days": "Z", "hours": "W"}. 
</EXTRACTION_ALGORITHM>

<OUTPUT_FORMAT>
Return ONLY a valid JSON object matching the exact schema below. Do not include markdown formatting like ```json. Do not include any explanations.

{
  "visual_scratchpad": "string",
  "document_meta": {
    "period_text": "string",
    "year": "string",
    "date_filled": "DD.MM.YYYY",
    "period_start": "DD.MM",
    "period_end": "DD.MM",
    "period_type": "string",
    "crossed_out_headers": ["string"]
  },

  "employees": [
    {
      "row_id": 1,
      "chunk_01_05": { "01": "val", "02": "val", "03": "val", "04": "val", "05": "val" },
      "chunk_06_10": { "06": "val", "07": "val", "08": "val", "09": "val", "10": "val" },
      "chunk_11_15": { "11": "val", "12": "val", "13": "val", "14": "val", "15": "val" },
      "chunk_16_20": { "16": "val", "17": "val", "18": "val", "19": "val", "20": "val" },
      "chunk_21_25": { "21": "val", "22": "val", "23": "val", "24": "val", "25": "val" },
      "chunk_26_31": { "26": "val", "27": "val", "28": "val", "29": "val", "30": "val", "31": "val" },
      "totals_days": "string",
      "totals_hours": "string",
      "absences_total_days": "string",
      "absences_total_hours": "string",
      "absence_reasons": [
        { "col": "string", "code": "string", "days": "string", "hours": "string" }
      ]
    }
  ]
}
</OUTPUT_FORMAT>
"""
model = genai.GenerativeModel(
    model_name="gemini-3.6-flash",
    generation_config=generation_config,
    system_instruction=SYSTEM_PROMPT
)

# Адаптація JSON-відповіді від ШІ до попередньої структури даних
def transform_ai_json_to_legacy(ai_json):
    legacy_json = {"document_meta": ai_json.get("document_meta", {}), "employees": []}
    for emp in ai_json.get("employees", []):
        legacy_emp = {
            "row_id": emp.get("row_id"),
            "days": {},
            "totals": {"days": emp.get("totals_days", "-"), "hours": emp.get("totals_hours", "-")},
            "absences": {
                "total_days": emp.get("absences_total_days", "-"),
                "total_hours": emp.get("absences_total_hours", "-"),
                "reasons": emp.get("absence_reasons", [])
            }
        }
        all_chunks = {}
        chunk_keys = ["chunk_01_05", "chunk_06_10", "chunk_11_15", "chunk_16_20", "chunk_21_25", "chunk_26_31"]
        for chunk_name in chunk_keys:
            all_chunks.update(emp.get(chunk_name, {}))
        for day_str, value in all_chunks.items():
            parts = str(value).split("_")
            code = parts[0] if len(parts) > 0 else "-"
            hours = parts[1] if len(parts) > 1 else "-"
            legacy_emp["days"][day_str] = {"hours": hours, "code": code}
        for d in range(1, 32):
            day_key = f"{d:02d}" if d < 10 else str(d)
            if day_key not in legacy_emp["days"]:
                legacy_emp["days"][day_key] = {"hours": "-", "code": "-"}
        legacy_json["employees"].append(legacy_emp)
    return legacy_json

BOT_TOKEN = os.getenv("BOT_TOKEN") or os.getenv("TELEGRAM_BOT_TOKEN")

# Перевірка валідності даних, отриманих від Telegram Mini App
def verify_telegram_init_data(init_data: str) -> dict:
    if not BOT_TOKEN:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Security Server Error: BOT_TOKEN is missing in environment."
        )

    try:
        parsed_data = dict(parse_qsl(init_data))
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, 
            detail="Invalid Telegram initData format."
        )

    if "hash" not in parsed_data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, 
            detail="Missing Telegram cryptographic signature."
        )

    received_hash = parsed_data.pop("hash")
    sorted_items = sorted(parsed_data.items())
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted_items)

    secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    calculated_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

    if calculated_hash != received_hash:
        # Дозвіл на локальне тестування, якщо підпис не збігається
        if os.getenv("NODE_ENV") != "production" or os.getenv("ALLOW_MOCK_TELEGRAM") == "true":
             return {"id": 1234567, "first_name": "Developer"}
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, 
            detail="Telegram signature verification failed."
        )

    user_str = parsed_data.get("user")
    if not user_str:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, 
            detail="Telegram user metadata is missing."
        )

    try:
        return json.loads(user_str)
    except Exception:
         raise HTTPException(
             status_code=status.HTTP_401_UNAUTHORIZED, 
             detail="Failed to parse Telegram user JSON."
         )

# Отримання інформації про поточного користувача через заголовки
def get_current_tg_user(x_telegram_init_data: str = Header(None, alias="X-Telegram-Init-Data")) -> dict:
    if not x_telegram_init_data:
        # Фіктивні дані для локальної розробки
        if os.getenv("NODE_ENV") != "production" or os.getenv("ALLOW_MOCK_TELEGRAM") == "true":
            return {"id": 1234567, "first_name": "Developer"}
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, 
            detail="Authorization Header (X-Telegram-Init-Data) is empty."
        )
    return verify_telegram_init_data(x_telegram_init_data)

# Створення інстансу додатку FastAPI
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Точка входу для оновлень від Telegram
@app.post("/api/telegram")
async def telegram_webhook(request: Request):
    if not dp or not bot:
        return {"ok": False, "message": "Bot not configured"}
    try:
        from aiogram.types import Update
        update_json = await request.json()
        update = Update(**update_json)
        await dp.feed_update(bot, update)
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}

# Встановлення webhook для зв'язку з Telegram
@app.get("/api/setup-webhook")
async def setup_webhook(request: Request, secret: str = None):
    # Примітивний захист доступу за допомогою секретного ключа
    if secret != "super_admin_123":
        return {"status": "error", "message": "Доступ заборонено"}

    if not bot:
        return {"status": "error", "message": "BOT_TOKEN not configured"}
    
    raw_app_url = os.getenv("APP_URL") or str(request.base_url)
    app_url = raw_app_url.rstrip("/")
    webhook_url = f"{app_url}/api/telegram"
    
    try:
        await bot.set_webhook(webhook_url)
        return {"status": "success", "message": f"Webhook configured successfully to {webhook_url}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

# Отримання поточного статусу обробки для користувача
@app.get("/api/state")
async def get_user_state(current_user: dict = Depends(get_current_tg_user)):
    chat_id = current_user.get("id")
    supabase = get_supabase()
    try:
        res = supabase.table("user_state").select("*").eq("chat_id", chat_id).execute()
        if res.data:
            return {"status": "success", "state": res.data[0]}
    except Exception as e:
        print(f"Failed to fetch state: {e}")
    return {"status": "success", "state": {"chat_id": chat_id, "status": "idle"}}

# Примусове скидання стану користувача
@app.post("/api/state/reset")
async def reset_user_state(current_user: dict = Depends(get_current_tg_user)):
    chat_id = current_user.get("id")
    supabase = get_supabase()
    try:
        supabase.table("user_state").upsert({
            "chat_id": chat_id, 
            "status": "idle", 
            "raw_json": None, 
            "error_message": None
        }).execute()
        return {"status": "success"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

# Обробка завантаженого зображення табеля
@app.post("/api/upload")
async def receive_image(request: Request, current_user: dict = Depends(get_current_tg_user)):
    chat_id = current_user.get("id")
    data = await request.json()
    image_b64 = data.get("image")
    use_fallback = data.get("use_fallback", False) 
    
    if not image_b64:
        return {"status": "error", "message": "Зображення не знайдено"}
        
    supabase = get_supabase()
    
    # Оновлюємо статус в базі
    try:
        supabase.table("user_state").upsert({
            "chat_id": chat_id,
            "status": "processing",
            "raw_json": None,
            "error_message": None
        }).execute()
    except Exception as state_err:
        print(f"Error saving state: {state_err}")

    # Сповіщаємо користувача про початок процесу з вказанням версії моделі
    if bot:
        try:
            model_msg = "v3.1 Lite" if use_fallback else "v3.5"
            await bot.send_message(chat_id, f"⏳ Розпочато аналіз табеля (модель {model_msg}). Зачекайте, будь ласка...")
        except Exception as bot_err:
            print(f"Bot notification failed: {bot_err}")

    try:
        if "," in image_b64:
            image_b64 = image_b64.split(",")[1]
        image_bytes = base64.b64decode(image_b64)
        image_part = {"mime_type": "image/jpeg", "data": image_bytes}
        
        prompt = "Проаналізуй цю таблицю."
        
        # Динамічний вибір моделі на основі прапорця резервного варіанту
        model_name = "gemini-3.5-flash-lite" if use_fallback else "gemini-3.5-flash"
        current_model = genai.GenerativeModel(
            model_name=model_name,
            generation_config=generation_config,
            system_instruction=SYSTEM_PROMPT
        )
        
        # Виклик моделі для розпізнавання тексту
        response = await asyncio.to_thread(
            current_model.generate_content, 
            [prompt, image_part],
            request_options={"retry": None, "timeout": 250.0}
        )
        
        try:
            raw_text = response.text
        except ValueError:
            raise Exception("ШІ повернув порожній результат (фільтр безпеки).")

        match = re.search(r'\{.*\}', raw_text, re.DOTALL)
        if not match:
            raise Exception("Не вдалося знайти табличні дані.")

        parsed_data = json.loads(match.group(0))
        legacy_data = transform_ai_json_to_legacy(parsed_data)
        
        # Збереження успішного результату
        try:
            supabase.table("user_state").upsert({
                "chat_id": chat_id,
                "status": "ready",
                "raw_json": json.dumps(legacy_data),
                "error_message": None
            }).execute()
        except Exception as save_err:
            print(f"Failed to save final state: {save_err}")

        # Сповіщення про успіх
        if bot:
            try:
                await bot.send_message(chat_id, "✅ Аналіз табеля завершено! Дані готові для перевірки у додатку.")
            except Exception as bot_err:
                print(f"Bot success notification failed: {bot_err}")

        return {"status": "success", "data": legacy_data}

    except Exception as e:
        error_msg = str(e)
        
        # Обробка помилки 503 (перевантаження серверів)
        if "503" in error_msg or "high demand" in error_msg.lower():
            # Повернення стану в очікування для уникнення зависання
            try:
                supabase.table("user_state").upsert({
                    "chat_id": chat_id, "status": "idle", "raw_json": None, "error_message": None
                }).execute()
            except: pass
            
            # Спеціальний статус для клієнта
            return {"status": "high_demand", "message": error_msg}

        # Стандартна обробка інших помилок
        if "429" in error_msg or "Quota exceeded" in error_msg:
            error_msg = "Перевищено ліміт запитів ШІ. Спробуйте через 30 секунд."
            
        try:
            supabase.table("user_state").upsert({
                "chat_id": chat_id,
                "status": "error",
                "raw_json": None,
                "error_message": error_msg
            }).execute()
        except Exception as save_err:
            print(f"Failed to save error state: {save_err}")

        if bot:
            try:
                await bot.send_message(chat_id, f"❌ Виникла помилка під час аналізу табеля: {error_msg}")
            except Exception as bot_err:
                print(f"Bot error notification failed: {bot_err}")

        return {"status": "error", "message": error_msg}

# Отримання архіву оброблених табелів користувача
@app.get("/api/archive")
async def get_archive(current_user: dict = Depends(get_current_tg_user)):
    chat_id = current_user.get("id")
    supabase = get_supabase()
    try:
        res = supabase.table("tabel_archive") \
            .select("id, period_text, year, date_filled, created_at") \
            .eq("chat_id", chat_id) \
            .order("id", desc=True) \
            .execute()
        
        # Приведення часових міток до Київського часу
        target_tz = ZoneInfo("Europe/Kyiv")
        
        for item in res.data:
            if item.get("created_at"):
                try:
                    safe_date_str = item["created_at"].replace("Z", "+00:00")
                    dt_utc = datetime.fromisoformat(safe_date_str)
                    item["created_at"] = dt_utc.astimezone(target_tz).isoformat()
                except Exception:
                    pass 

        return {"status": "success", "archive": res.data}
    except Exception as e:
        return {"status": "error", "message": str(e)}

# Отримання детальної інформації про архівний табель
@app.get("/api/archive/detail/{tabel_id}")
async def get_archive_detail(tabel_id: int, current_user: dict = Depends(get_current_tg_user)):
    chat_id = current_user.get("id")
    supabase = get_supabase()
    try:
        res = supabase.table("tabel_archive") \
            .select("*") \
            .eq("id", tabel_id) \
            .eq("chat_id", chat_id) \
            .execute()
        if not res.data:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, 
                detail="Доступ заборонено або табель не знайдено."
            )
        return {"status": "success", "data": json.loads(res.data[0]["raw_json"])}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Оновлення даних вже існуючого архівного табеля
@app.post("/api/archive/update/{tabel_id}")
async def update_archive_item(tabel_id: int, request: Request, current_user: dict = Depends(get_current_tg_user)):
    chat_id = current_user.get("id")
    body = await request.json()
    updated_data = body.get("data")
    if not updated_data:
        raise HTTPException(status_code=400, detail="Data body is missing")
        
    meta = updated_data.get("document_meta", {})
    supabase = get_supabase()
    try:
        # Перевірка доступу до запису через ID користувача
        res = supabase.table("tabel_archive") \
            .update({
                "period_text": meta.get("period_text", "Невідомий період"),
                "year": meta.get("year", "2026"),
                "date_filled": meta.get("date_filled", ""),
                "raw_json": json.dumps(updated_data)
            }) \
            .eq("id", tabel_id) \
            .eq("chat_id", chat_id) \
            .execute()
            
        if not res.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Табель для оновлення не знайдено."
            )
        return {"status": "success", "message": "Архівний табель успішно оновлено!"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class ExcelRequest(BaseModel):
    data: dict

class EmailRequest(BaseModel):
    tabel_id: int

def is_trusted_user(chat_id: int) -> bool:
    trusted_str = os.getenv("TRUSTED_USERS", "")
    trusted_list = [int(x.strip()) for x in trusted_str.split(",") if x.strip()]
    admin_id = int(os.getenv("ADMIN_ID", 0))
    return chat_id in trusted_list or chat_id == admin_id

# Генерація файлу табеля у форматі Excel
@app.post("/api/generate-excel")
async def generate_excel(req: ExcelRequest, current_user: dict = Depends(get_current_tg_user)):
    try:
        parsed_data = req.data
        chat_id = current_user.get("id")
        meta = parsed_data.get("document_meta", {})
        
        supabase = get_supabase()
        
        # Додавання нового запису в таблицю архіву
        archive_res = supabase.table("tabel_archive").insert({
            "chat_id": chat_id,
            "period_text": meta.get("period_text", "Невідомий період"),
            "year": meta.get("year", "2026"),
            "date_filled": meta.get("date_filled", ""),
            "raw_json": json.dumps(parsed_data),
            "created_at": datetime.now(timezone.utc).isoformat()
        }).execute()

        # Формування Excel-документа виключно в оперативній пам'яті
        test_user = not is_trusted_user(chat_id)
        excel_bytes = generate_excel_bytes(parsed_data, is_test_user=test_user)
        
        # Відправка готового файлу користувачу в Telegram
        try:
            from aiogram.types import BufferedInputFile
            safe_period = meta.get('period_text', 'заповнений').replace(' ', '_').replace('/', '-')
            filename = f"Табель_за_{safe_period}.xlsx"
            if bot:
                await bot.send_document(
                    chat_id=chat_id, 
                    document=BufferedInputFile(excel_bytes, filename=filename), 
                    caption="✅ Ваш табель успішно оцифровано!"
                )
        except Exception as bot_err:
            print(f"⚠️ Telegram sending failed: {bot_err}")

        # Очищення поточного стану користувача
        try:
            supabase.table("user_state").upsert({
                "chat_id": chat_id,
                "status": "idle",
                "raw_json": None,
                "error_message": None
            }).execute()
        except Exception as state_err:
            print(f"Failed to reset state: {state_err}")

        return {"status": "success", "message": "Табель згенеровано та надіслано!"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

# Відправлення згенерованого Excel-файлу електронною поштою
@app.post("/api/send-email")
async def send_email_endpoint(req: EmailRequest, current_user: dict = Depends(get_current_tg_user)):
    chat_id = current_user.get("id")
    supabase = get_supabase()
    
    # Верифікація власника архівного запису
    res = supabase.table("tabel_archive") \
        .select("*") \
        .eq("id", req.tabel_id) \
        .eq("chat_id", chat_id) \
        .execute()
        
    if not res.data:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, 
            detail="Доступ заборонено або табель не знайдено."
        )
        
    try:
        tabel = res.data[0]
        parsed_data = json.loads(tabel["raw_json"])
        meta = parsed_data.get("document_meta", {})
        
        test_user = not is_trusted_user(chat_id)
        excel_bytes = generate_excel_bytes(parsed_data, is_test_user=test_user)
        
        period_text = meta.get('period_text', 'звітний період')
        year_text = meta.get('year', '2026')
        
        email_res = send_tabel_email_bytes(
            tabel_id=req.tabel_id,
            excel_bytes=excel_bytes,
            period_text=period_text,
            year_text=year_text,
            is_test_user=test_user
        )
        return email_res
        
    except Exception as e:
        return {"status": "error", "message": str(e)}