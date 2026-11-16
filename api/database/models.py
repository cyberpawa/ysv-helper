from pydantic import BaseModel


class TabelArchive(BaseModel):
    id: int | None = None
    chat_id: int
    period_text: str
    year: str
    date_filled: str
    raw_json: str
    created_at: str | None = None


class UserState(BaseModel):
    chat_id: int
    status: str  # Варіанти статусу: 'idle', 'processing', 'ready', 'high_demand', 'error'
    raw_json: str | None = None
    error_message: str | None = None
    updated_at: str | None = None
