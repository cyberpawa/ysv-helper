import hashlib
import hmac
import json
import os
import time
from urllib.parse import parse_qsl
from fastapi import Header, HTTPException, status


def _is_mock_telegram_allowed() -> bool:
    """Explicit opt-in for local development without Telegram WebApp signature."""
    return os.getenv("ALLOW_MOCK_TELEGRAM", "false").lower() == "true"


def verify_telegram_init_data(init_data: str) -> dict:
    """Validate Telegram WebApp initData HMAC-SHA256 signature and freshness."""
    bot_token = os.getenv("BOT_TOKEN") or os.getenv("TELEGRAM_BOT_TOKEN")
    if not bot_token:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Security Server Error: BOT_TOKEN is missing in environment.",
        )

    try:
        parsed_data = dict(parse_qsl(init_data, keep_blank_values=True))
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Telegram initData format.",
        )

    if "hash" not in parsed_data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Telegram cryptographic signature.",
        )

    received_hash = parsed_data.pop("hash")
    sorted_items = sorted(parsed_data.items())
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted_items)

    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    calculated_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

    if not hmac.compare_digest(calculated_hash, received_hash):
        if _is_mock_telegram_allowed():
            return {"id": 1234567, "first_name": "Developer"}
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Telegram signature verification failed.",
        )

    if not _is_mock_telegram_allowed():
        auth_date_raw = parsed_data.get("auth_date")
        if not auth_date_raw or not auth_date_raw.isdigit():
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Telegram auth_date is missing or invalid.",
            )
        max_age = int(os.getenv("INIT_DATA_MAX_AGE_SECONDS", "86400"))
        if int(time.time()) - int(auth_date_raw) > max_age:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Telegram session expired. Please reopen Mini App.",
            )

    user_str = parsed_data.get("user")
    if not user_str:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Telegram user metadata is missing.",
        )

    try:
        return json.loads(user_str)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Failed to parse Telegram user JSON.",
        )


def get_current_tg_user(
    x_telegram_init_data: str | None = Header(None, alias="X-Telegram-Init-Data"),
) -> dict:
    """FastAPI dependency that extracts and verifies the Telegram user."""
    if not x_telegram_init_data:
        if _is_mock_telegram_allowed():
            return {"id": 1234567, "first_name": "Developer"}
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization Header (X-Telegram-Init-Data) is empty.",
        )
    return verify_telegram_init_data(x_telegram_init_data)


def is_trusted_user(chat_id: int) -> bool:
    """Check whether chat_id belongs to trusted users or admin (non-sandbox mode)."""
    trusted_str = os.getenv("TRUSTED_USERS", "")
    trusted_list: list[int] = []
    for raw_id in trusted_str.split(","):
        cleaned = raw_id.strip()
        if cleaned.lstrip("-").isdigit():
            trusted_list.append(int(cleaned))

    admin_raw = (os.getenv("ADMIN_ID") or "0").strip()
    admin_id = int(admin_raw) if admin_raw.lstrip("-").isdigit() else 0
    return chat_id in trusted_list or (admin_id != 0 and chat_id == admin_id)


def verify_webhook_secret(secret: str | None) -> bool:
    """Constant-time check for webhook secret against WEBHOOK_SECRET env var."""
    expected = os.getenv("WEBHOOK_SECRET")
    if not expected or not secret:
        return False
    return hmac.compare_digest(expected, secret)
