import asyncio
import base64
import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo

import google.generativeai as genai
from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from api.bot.handlers import bot, dp
from api.database.session import get_supabase
from api.prompts import SYSTEM_PROMPT, transform_ai_json_to_legacy
from api.security import (
    get_current_tg_user,
    is_trusted_user,
    verify_webhook_secret,
)
from api.services.email_service import send_tabel_email_bytes
from api.services.excel_service import generate_excel_bytes
from api.services.template_service import get_template_profile, list_template_profiles

logger = logging.getLogger(__name__)

GEMINI_KEY = os.getenv("GEMINI_API_KEY") or os.getenv("API_KEY")
if GEMINI_KEY:
    genai.configure(api_key=GEMINI_KEY, transport="rest")

PRIMARY_MODEL = os.getenv("GEMINI_PRIMARY_MODEL", "gemini-4-hydrogen")
FALLBACK_MODEL = os.getenv("GEMINI_FALLBACK_MODEL", "gemini-3.8-flash")
MAX_IMAGE_BASE64_LENGTH = 15_000_000

generation_config = {
    "temperature": 0.0,
    "response_mime_type": "application/json",
}

app = FastAPI(title="YSV Helper API", version="1.2.0")

ALLOWED_ORIGINS = [
    o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",") if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=(ALLOWED_ORIGINS != ["*"]),
    allow_methods=["*"],
    allow_headers=["*"],
)


class UploadRequest(BaseModel):
    image: str
    use_fallback: bool = False
    template_id: Optional[str] = "auto"


class ArchiveUpdateRequest(BaseModel):
    data: dict


class ExcelRequest(BaseModel):
    data: dict


class EmailRequest(BaseModel):
    tabel_id: int


@app.post("/api/telegram")
async def telegram_webhook(request: Request):
    if os.getenv("WEBHOOK_SECRET"):
        header_secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token")
        if not verify_webhook_secret(header_secret):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Invalid Telegram webhook secret token.",
            )

    if not dp or not bot:
        return {"ok": False, "message": "Bot not configured"}
    try:
        from aiogram.types import Update

        update_json = await request.json()
        update = Update(**update_json)
        await dp.feed_update(bot, update)
        return {"ok": True}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.get("/api/setup-webhook")
async def setup_webhook(secret: str | None = None):
    if not verify_webhook_secret(secret):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Доступ заборонено",
        )

    if not bot:
        return {"status": "error", "message": "BOT_TOKEN not configured"}

    raw_app_url = os.getenv("APP_URL")
    if not raw_app_url:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="APP_URL environment variable is required to configure webhook safely.",
        )

    webhook_url = f"{raw_app_url.rstrip('/')}/api/telegram"
    webhook_secret = os.getenv("WEBHOOK_SECRET")

    try:
        await bot.set_webhook(webhook_url, secret_token=webhook_secret)
        return {
            "status": "success",
            "message": f"Webhook configured successfully to {webhook_url}",
        }
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


@app.get("/api/templates")
async def get_templates(current_user: dict = Depends(get_current_tg_user)):
    return {"status": "success", "templates": list_template_profiles()}


@app.get("/api/state")
async def get_user_state(current_user: dict = Depends(get_current_tg_user)):
    chat_id = current_user.get("id")
    supabase = get_supabase()
    try:
        res = supabase.table("user_state").select("*").eq("chat_id", chat_id).execute()
        if res.data:
            return {"status": "success", "state": res.data[0]}
    except Exception as exc:
        logger.warning("Failed to fetch user state: %s", exc)
    return {"status": "success", "state": {"chat_id": chat_id, "status": "idle"}}


@app.post("/api/state/reset")
async def reset_user_state(current_user: dict = Depends(get_current_tg_user)):
    chat_id = current_user.get("id")
    supabase = get_supabase()
    try:
        supabase.table("user_state").upsert(
            {
                "chat_id": chat_id,
                "status": "idle",
                "raw_json": None,
                "error_message": None,
            }
        ).execute()
        return {"status": "success"}
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


@app.post("/api/upload")
async def receive_image(
    req: UploadRequest, current_user: dict = Depends(get_current_tg_user)
):
    chat_id = current_user.get("id")
    image_b64 = req.image

    if not image_b64:
        return {"status": "error", "message": "Зображення не знайдено"}

    if len(image_b64) > MAX_IMAGE_BASE64_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Розмір зображення перевищує допустимий ліміт (15 МБ).",
        )

    template_profile = get_template_profile(req.template_id)
    template_id = template_profile["id"]
    template_name = template_profile["name"]

    supabase = get_supabase()

    try:
        supabase.table("user_state").upsert(
            {
                "chat_id": chat_id,
                "status": "processing",
                "raw_json": None,
                "error_message": None,
            }
        ).execute()
    except Exception as state_err:
        logger.warning("Error saving processing state: %s", state_err)

    if bot:
        try:
            model_msg = "Gemini 3.8 Flash" if req.use_fallback else "Gemini 4 Hydrogen"
            await bot.send_message(
                chat_id,
                f"⏳ Розпочато аналіз табеля ({template_name}, модель {model_msg}). Зачекайте, будь ласка...",
            )
        except Exception as bot_err:
            logger.warning("Bot notification failed: %s", bot_err)

    try:
        if "," in image_b64:
            image_b64 = image_b64.split(",", 1)[1]
        image_bytes = base64.b64decode(image_b64, validate=True)
        image_part = {"mime_type": "image/jpeg", "data": image_bytes}

        prompt = "Проаналізуй цю таблицю."
        model_name = FALLBACK_MODEL if req.use_fallback else PRIMARY_MODEL
        current_model = genai.GenerativeModel(
            model_name=model_name,
            generation_config=generation_config,
            system_instruction=SYSTEM_PROMPT,
        )

        response = await asyncio.to_thread(
            current_model.generate_content,
            [prompt, image_part],
            request_options={"retry": None, "timeout": 250.0},
        )

        try:
            raw_text = response.text
        except ValueError:
            raise Exception("ШІ повернув порожній результат (фільтр безпеки).")

        match = re.search(r"\{.*\}", raw_text, re.DOTALL)
        if not match:
            raise Exception("Не вдалося знайти табличні дані.")

        parsed_data = json.loads(match.group(0))
        legacy_data = transform_ai_json_to_legacy(parsed_data, template_id=template_id)

        try:
            supabase.table("user_state").upsert(
                {
                    "chat_id": chat_id,
                    "status": "ready",
                    "raw_json": json.dumps(legacy_data),
                    "error_message": None,
                }
            ).execute()
        except Exception as save_err:
            logger.warning("Failed to save final state: %s", save_err)

        if bot:
            try:
                await bot.send_message(
                    chat_id,
                    "✅ Аналіз табеля завершено! Дані готові для перевірки у додатку.",
                )
            except Exception as bot_err:
                logger.warning("Bot success notification failed: %s", bot_err)

        return {"status": "success", "data": legacy_data}

    except Exception as exc:
        error_msg = str(exc)

        if "503" in error_msg or "high demand" in error_msg.lower():
            try:
                supabase.table("user_state").upsert(
                    {
                        "chat_id": chat_id,
                        "status": "idle",
                        "raw_json": None,
                        "error_message": None,
                    }
                ).execute()
            except Exception:
                pass

            return {"status": "high_demand", "message": error_msg}

        if "429" in error_msg or "Quota exceeded" in error_msg:
            error_msg = "Перевищено ліміт запитів ШІ. Спробуйте через 30 секунд."

        try:
            supabase.table("user_state").upsert(
                {
                    "chat_id": chat_id,
                    "status": "error",
                    "raw_json": None,
                    "error_message": error_msg,
                }
            ).execute()
        except Exception as save_err:
            logger.warning("Failed to save error state: %s", save_err)

        if bot:
            try:
                await bot.send_message(
                    chat_id,
                    f"❌ Виникла помилка під час аналізу табеля: {error_msg}",
                )
            except Exception as bot_err:
                logger.warning("Bot error notification failed: %s", bot_err)

        return {"status": "error", "message": error_msg}


@app.get("/api/archive")
async def get_archive(current_user: dict = Depends(get_current_tg_user)):
    chat_id = current_user.get("id")
    supabase = get_supabase()
    try:
        res = (
            supabase.table("tabel_archive")
            .select("id, period_text, year, date_filled, created_at")
            .eq("chat_id", chat_id)
            .order("id", desc=True)
            .execute()
        )

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
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


@app.get("/api/archive/detail/{tabel_id}")
async def get_archive_detail(
    tabel_id: int, current_user: dict = Depends(get_current_tg_user)
):
    chat_id = current_user.get("id")
    supabase = get_supabase()
    try:
        res = (
            supabase.table("tabel_archive")
            .select("*")
            .eq("id", tabel_id)
            .eq("chat_id", chat_id)
            .execute()
        )
        if not res.data:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Доступ заборонено або табель не знайдено.",
            )
        return {"status": "success", "data": json.loads(res.data[0]["raw_json"])}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/archive/update/{tabel_id}")
async def update_archive_item(
    tabel_id: int,
    req: ArchiveUpdateRequest,
    current_user: dict = Depends(get_current_tg_user),
):
    chat_id = current_user.get("id")
    updated_data = req.data
    if not updated_data:
        raise HTTPException(status_code=400, detail="Data body is missing")

    meta = updated_data.get("document_meta", {})
    supabase = get_supabase()
    try:
        res = (
            supabase.table("tabel_archive")
            .update(
                {
                    "period_text": meta.get("period_text", "Невідомий період"),
                    "year": meta.get("year", "2026"),
                    "date_filled": meta.get("date_filled", ""),
                    "raw_json": json.dumps(updated_data),
                }
            )
            .eq("id", tabel_id)
            .eq("chat_id", chat_id)
            .execute()
        )

        if not res.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Табель для оновлення не знайдено.",
            )
        return {"status": "success", "message": "Архівний табель успішно оновлено!"}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/generate-excel")
async def generate_excel(
    req: ExcelRequest, current_user: dict = Depends(get_current_tg_user)
):
    try:
        parsed_data = req.data
        chat_id = current_user.get("id")
        meta = parsed_data.get("document_meta", {})

        supabase = get_supabase()
        supabase.table("tabel_archive").insert(
            {
                "chat_id": chat_id,
                "period_text": meta.get("period_text", "Невідомий період"),
                "year": meta.get("year", "2026"),
                "date_filled": meta.get("date_filled", ""),
                "raw_json": json.dumps(parsed_data),
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        ).execute()

        test_user = not is_trusted_user(chat_id)
        excel_bytes = generate_excel_bytes(parsed_data, is_test_user=test_user)

        try:
            from aiogram.types import BufferedInputFile

            safe_period = (
                meta.get("period_text", "заповнений")
                .replace(" ", "_")
                .replace("/", "-")
            )
            filename = f"Табель_за_{safe_period}.xlsx"
            if bot:
                await bot.send_document(
                    chat_id=chat_id,
                    document=BufferedInputFile(excel_bytes, filename=filename),
                    caption="✅ Ваш табель успішно оцифровано!",
                )
        except Exception as bot_err:
            logger.warning("Telegram document delivery failed: %s", bot_err)

        try:
            supabase.table("user_state").upsert(
                {
                    "chat_id": chat_id,
                    "status": "idle",
                    "raw_json": None,
                    "error_message": None,
                }
            ).execute()
        except Exception as state_err:
            logger.warning("Failed to reset state: %s", state_err)

        return {"status": "success", "message": "Табель згенеровано та надіслано!"}
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


@app.post("/api/send-email")
async def send_email_endpoint(
    req: EmailRequest, current_user: dict = Depends(get_current_tg_user)
):
    chat_id = current_user.get("id")
    supabase = get_supabase()

    res = (
        supabase.table("tabel_archive")
        .select("*")
        .eq("id", req.tabel_id)
        .eq("chat_id", chat_id)
        .execute()
    )

    if not res.data:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Доступ заборонено або табель не знайдено.",
        )

    try:
        tabel = res.data[0]
        parsed_data = json.loads(tabel["raw_json"])
        meta = parsed_data.get("document_meta", {})

        test_user = not is_trusted_user(chat_id)
        excel_bytes = generate_excel_bytes(parsed_data, is_test_user=test_user)

        period_text = meta.get("period_text", "звітний період")
        year_text = meta.get("year", "2026")

        return send_tabel_email_bytes(
            tabel_id=req.tabel_id,
            excel_bytes=excel_bytes,
            period_text=period_text,
            year_text=year_text,
            is_test_user=test_user,
        )
    except Exception as exc:
        return {"status": "error", "message": str(exc)}
