import asyncio
import base64
import json
import re

import google.generativeai as genai

from api.config import settings
from api.exceptions import (
    DomainError,
    HighDemandError,
    NotATimesheetError,
    QuotaExceededError,
)
from api.prompts import SYSTEM_PROMPT, transform_ai_json_to_response

if settings.gemini_api_key:
    genai.configure(api_key=settings.gemini_api_key, transport="rest")

GENERATION_CONFIG = {
    "temperature": 0.0,
    "response_mime_type": "application/json",
}


async def analyze_timesheet_image(
    image_b64: str,
    template_id: str,
    use_fallback: bool = False,
) -> dict:
    """Send cropped timesheet image to Gemini Vision and return normalized table data."""
    payload = image_b64.split(",", 1)[1] if "," in image_b64 else image_b64
    try:
        image_bytes = base64.b64decode(payload, validate=True)
    except Exception as exc:
        raise DomainError("Некоректний формат зображення (base64).") from exc

    image_part = {"mime_type": "image/jpeg", "data": image_bytes}
    model_name = settings.gemini_fallback_model if use_fallback else settings.gemini_primary_model
    current_model = genai.GenerativeModel(
        model_name=model_name,
        generation_config=GENERATION_CONFIG,
        system_instruction=SYSTEM_PROMPT,
    )

    try:
        response = await asyncio.to_thread(
            current_model.generate_content,
            ["Проаналізуй цю таблицю.", image_part],
            request_options={"retry": None, "timeout": 250.0},
        )
    except Exception as exc:
        error_text = str(exc)
        if "503" in error_text or "high demand" in error_text.lower():
            raise HighDemandError(error_text) from exc
        if "429" in error_text or "Quota exceeded" in error_text:
            raise QuotaExceededError(
                "Перевищено ліміт запитів ШІ. Спробуйте через 30 секунд."
            ) from exc
        raise DomainError(f"Помилка звернення до ШІ: {error_text}") from exc

    try:
        raw_text = response.text
    except ValueError as exc:
        raise DomainError("ШІ повернув порожній результат (фільтр безпеки).") from exc

    match = re.search(r"\{.*\}", raw_text or "", re.DOTALL)
    if not match:
        raise NotATimesheetError("На фото не вдалося знайти табличні дані табеля.")

    try:
        parsed_data = json.loads(match.group(0))
    except json.JSONDecodeError as exc:
        raise DomainError("Помилка розбору JSON-відповіді від ШІ.") from exc

    if parsed_data.get("is_timesheet_table") is False:
        reason = parsed_data.get("rejection_reason")
        raise NotATimesheetError(reason or "На завантаженому фото не виявлено таблиці табеля.")

    employees = parsed_data.get("employees")
    if not isinstance(employees, list) or len(employees) == 0:
        raise NotATimesheetError(
            "Таблиця на фото не містить рядків працівників або занадто розмита."
        )

    return transform_ai_json_to_response(parsed_data, template_id=template_id)
