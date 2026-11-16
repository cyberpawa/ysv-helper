from typing import Any

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    # Gemini AI
    gemini_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("GEMINI_API_KEY", "API_KEY"),
    )
    gemini_primary_model: str = "gemini-4-hydrogen"
    gemini_fallback_model: str = "gemini-3.8-flash"
    max_image_base64_length: int = 15_000_000

    # Telegram Bot & Mini App
    bot_token: str | None = Field(
        default=None,
        validation_alias=AliasChoices("BOT_TOKEN", "TELEGRAM_BOT_TOKEN"),
    )
    admin_id: int = 0
    trusted_users: str = ""
    test_photo_file_id: str | None = None
    webhook_secret: str | None = None
    app_url: str | None = None
    init_data_max_age_seconds: int = 86400
    allow_mock_telegram: bool = False
    allowed_origins: str = "*"

    # Supabase
    supabase_url: str | None = None
    supabase_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("SUPABASE_SERVICE_KEY", "SUPABASE_KEY"),
    )
    supabase_bucket: str = "templates"
    supabase_template_file: str = "timesheet_template.xlsx"

    # SMTP / Email
    sender_email: str | None = None
    sender_password: str | None = None
    target_email: str | None = None
    smtp_server: str = "smtp.gmail.com"
    smtp_port: int = 587

    @field_validator(
        "admin_id",
        "init_data_max_age_seconds",
        "smtp_port",
        "max_image_base64_length",
        mode="before",
    )
    @classmethod
    def _empty_str_to_default(cls, value: Any, info: Any) -> Any:
        if isinstance(value, str) and not value.strip():
            defaults = {
                "admin_id": 0,
                "init_data_max_age_seconds": 86400,
                "smtp_port": 587,
                "max_image_base64_length": 15_000_000,
            }
            return defaults.get(info.field_name, 0)
        return value

    @property
    def cors_origins(self) -> list[str]:
        origins = [o.strip() for o in self.allowed_origins.split(",") if o.strip()]
        return origins or ["*"]

    @property
    def trusted_user_ids(self) -> list[int]:
        ids: list[int] = []
        for raw_id in self.trusted_users.split(","):
            cleaned = raw_id.strip()
            if cleaned.lstrip("-").isdigit():
                ids.append(int(cleaned))
        return ids


settings = Settings()
