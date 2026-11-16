import asyncio
import json
import logging
from datetime import UTC, datetime

from aiogram.types import BufferedInputFile

from api.bot.handlers import bot
from api.database.session import get_supabase
from api.exceptions import (
    AccessDeniedError,
    DomainError,
    HighDemandError,
    NotATimesheetError,
    QuotaExceededError,
    ResourceNotFoundError,
)
from api.security import is_trusted_user
from api.services.email_service import send_tabel_email_bytes
from api.services.excel_service import generate_excel_bytes
from api.services.gemini_service import analyze_timesheet_image
from api.services.template_service import get_template_profile

logger = logging.getLogger(__name__)


async def _notify_bot(chat_id: int, text: str) -> None:
    if not bot:
        return
    try:
        await bot.send_message(chat_id, text)
    except Exception as exc:
        logger.warning("Bot notification failed for chat_id=%s: %s", chat_id, exc)


def _upsert_user_state(
    chat_id: int,
    status_value: str,
    raw_json: str | None = None,
    error_message: str | None = None,
) -> None:
    supabase = get_supabase()
    supabase.table("user_state").upsert(
        {
            "chat_id": chat_id,
            "status": status_value,
            "raw_json": raw_json,
            "error_message": error_message,
        }
    ).execute()


def get_user_state_record(chat_id: int) -> dict:
    """Return persisted processing state for the user."""
    supabase = get_supabase()
    try:
        res = supabase.table("user_state").select("*").eq("chat_id", chat_id).execute()
    except Exception as exc:
        logger.exception("Failed to fetch user state for chat_id=%s", chat_id)
        raise DomainError(f"Не вдалося отримати стан користувача: {exc}") from exc

    if res.data:
        return res.data[0]
    return {"chat_id": chat_id, "status": "idle"}


def reset_user_state_record(chat_id: int) -> None:
    """Reset user processing state back to idle."""
    try:
        _upsert_user_state(chat_id, "idle")
    except Exception as exc:
        logger.exception("Failed to reset user state for chat_id=%s", chat_id)
        raise DomainError(f"Не вдалося скинути стан користувача: {exc}") from exc


def mark_state_processing(chat_id: int) -> None:
    """Persist processing status before running background OCR."""
    try:
        _upsert_user_state(chat_id, "processing")
    except Exception as exc:
        logger.warning("Failed to persist processing state for chat_id=%s: %s", chat_id, exc)


async def process_timesheet_upload_task(
    chat_id: int,
    image_b64: str,
    template_id: str | None,
    use_fallback: bool,
) -> None:
    """Run Gemini timesheet extraction in background and update persisted user_state."""
    profile = get_template_profile(template_id)
    resolved_template_id = profile["id"]
    template_name = profile["name"]
    model_label = "Gemini 3.8 Flash" if use_fallback else "Gemini 4 Hydrogen"

    await _notify_bot(
        chat_id,
        f"⏳ Розпочато аналіз табеля ({template_name}, модель {model_label}). Зачекайте, будь ласка...",
    )

    try:
        normalized_data = await analyze_timesheet_image(
            image_b64=image_b64,
            template_id=resolved_template_id,
            use_fallback=use_fallback,
        )
        _upsert_user_state(chat_id, "ready", raw_json=json.dumps(normalized_data))
        await _notify_bot(
            chat_id,
            "✅ Аналіз табеля завершено! Дані готові для перевірки у додатку.",
        )
    except HighDemandError as exc:
        logger.warning("Gemini high demand for chat_id=%s: %s", chat_id, exc)
        try:
            _upsert_user_state(chat_id, "high_demand", error_message=str(exc))
        except Exception as state_exc:
            logger.warning("Failed to save high_demand state: %s", state_exc)
    except (NotATimesheetError, QuotaExceededError, DomainError) as exc:
        logger.warning("Timesheet analysis rejected/failed for chat_id=%s: %s", chat_id, exc)
        try:
            _upsert_user_state(chat_id, "error", error_message=str(exc))
        except Exception as state_exc:
            logger.warning("Failed to save error state: %s", state_exc)
        await _notify_bot(chat_id, f"❌ Виникла помилка під час аналізу табеля: {exc}")
    except Exception as exc:
        logger.exception("Unexpected error in background analysis for chat_id=%s", chat_id)
        try:
            _upsert_user_state(chat_id, "error", error_message=str(exc))
        except Exception as state_exc:
            logger.warning("Failed to save unexpected error state: %s", state_exc)
        await _notify_bot(chat_id, f"❌ Виникла помилка під час аналізу табеля: {exc}")


def list_user_archive(chat_id: int) -> list[dict]:
    """List user's archived timesheets with raw UTC timestamps for frontend formatting."""
    supabase = get_supabase()
    try:
        res = (
            supabase.table("tabel_archive")
            .select("id, period_text, year, date_filled, created_at")
            .eq("chat_id", chat_id)
            .order("id", desc=True)
            .execute()
        )
    except Exception as exc:
        logger.exception("Failed to list archive for chat_id=%s", chat_id)
        raise DomainError(f"Не вдалося завантажити архів: {exc}") from exc

    return res.data or []


def get_user_archive_detail(chat_id: int, tabel_id: int) -> dict:
    """Fetch a single archived timesheet owned by the user."""
    supabase = get_supabase()
    try:
        res = (
            supabase.table("tabel_archive")
            .select("*")
            .eq("id", tabel_id)
            .eq("chat_id", chat_id)
            .execute()
        )
    except Exception as exc:
        logger.exception("Failed to load archive detail tabel_id=%s", tabel_id)
        raise DomainError(f"Помилка завантаження архіву: {exc}") from exc

    if not res.data:
        raise AccessDeniedError("Доступ заборонено або табель не знайдено.")

    try:
        return json.loads(res.data[0]["raw_json"])
    except json.JSONDecodeError as exc:
        raise DomainError("Пошкоджений формат архівного запису.") from exc


def update_user_archive_item(chat_id: int, tabel_id: int, updated_data: dict) -> None:
    """Update an archived timesheet owned by the user."""
    if not updated_data:
        raise DomainError("Дані для оновлення відсутні.")

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
    except Exception as exc:
        logger.exception("Failed to update archive tabel_id=%s", tabel_id)
        raise DomainError(f"Помилка оновлення архіву: {exc}") from exc

    if not res.data:
        raise ResourceNotFoundError("Табель для оновлення не знайдено.")


async def create_and_deliver_excel(chat_id: int, parsed_data: dict) -> None:
    """Archive the confirmed timesheet, generate .xlsx in memory, send to Telegram, and reset state."""
    meta = parsed_data.get("document_meta", {})
    supabase = get_supabase()

    try:
        supabase.table("tabel_archive").insert(
            {
                "chat_id": chat_id,
                "period_text": meta.get("period_text", "Невідомий період"),
                "year": meta.get("year", "2026"),
                "date_filled": meta.get("date_filled", ""),
                "raw_json": json.dumps(parsed_data),
                "created_at": datetime.now(UTC).isoformat(),
            }
        ).execute()
    except Exception as exc:
        logger.exception("Failed to insert archive item for chat_id=%s", chat_id)
        raise DomainError(f"Не вдалося зберегти табель в архів: {exc}") from exc

    test_user = not is_trusted_user(chat_id)
    try:
        excel_bytes = await asyncio.to_thread(
            generate_excel_bytes, parsed_data, is_test_user=test_user
        )
    except Exception as exc:
        logger.exception("Excel generation failed for chat_id=%s", chat_id)
        raise DomainError(f"Помилка формування Excel: {exc}") from exc

    if bot:
        try:
            safe_period = meta.get("period_text", "заповнений").replace(" ", "_").replace("/", "-")
            filename = f"Табель_за_{safe_period}.xlsx"
            await bot.send_document(
                chat_id=chat_id,
                document=BufferedInputFile(excel_bytes, filename=filename),
                caption="✅ Ваш табель успішно оцифровано!",
            )
        except Exception as exc:
            logger.warning("Telegram document delivery failed: %s", exc)

    try:
        _upsert_user_state(chat_id, "idle")
    except Exception as exc:
        logger.warning("Failed to reset state after Excel generation: %s", exc)


async def send_archived_tabel_email(chat_id: int, tabel_id: int) -> dict:
    """Build .xlsx from an archived timesheet and deliver it via SMTP."""
    parsed_data = get_user_archive_detail(chat_id, tabel_id)
    meta = parsed_data.get("document_meta", {})
    test_user = not is_trusted_user(chat_id)

    try:
        excel_bytes = await asyncio.to_thread(
            generate_excel_bytes, parsed_data, is_test_user=test_user
        )
    except Exception as exc:
        logger.exception("Excel generation failed before email send for tabel_id=%s", tabel_id)
        raise DomainError(f"Помилка формування Excel: {exc}") from exc

    period_text = meta.get("period_text", "звітний період")
    year_text = meta.get("year", "2026")

    try:
        return await asyncio.to_thread(
            send_tabel_email_bytes,
            tabel_id=tabel_id,
            excel_bytes=excel_bytes,
            period_text=period_text,
            year_text=year_text,
            is_test_user=test_user,
        )
    except Exception as exc:
        logger.exception("SMTP email delivery failed for tabel_id=%s", tabel_id)
        raise DomainError(f"Помилка відправлення листа: {exc}") from exc
