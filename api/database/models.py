from pydantic import BaseModel
from typing import Optional, List, Dict

class TabelArchive(BaseModel):
    id: Optional[int] = None
    chat_id: int
    period_text: str
    year: str
    date_filled: str
    raw_json: str
    created_at: Optional[str] = None

class UserState(BaseModel):
    chat_id: int
    status: str  # 'idle', 'processing', 'ready', 'error'
    raw_json: Optional[str] = None
    error_message: Optional[str] = None
    updated_at: Optional[str] = None
