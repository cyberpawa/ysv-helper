from typing import Any

from pydantic import BaseModel, Field, field_validator


class UploadRequest(BaseModel):
    image: str
    use_fallback: bool = False
    template_id: str | None = "auto"


class ArchiveUpdateRequest(BaseModel):
    data: dict[str, Any]


class ExcelRequest(BaseModel):
    data: dict[str, Any]


class EmailRequest(BaseModel):
    tabel_id: int


class DayRecordSchema(BaseModel):
    hours: str = "-"
    code: str = "-"


class TotalsSchema(BaseModel):
    days: str = ""
    hours: str = ""


class AbsenceReasonSchema(BaseModel):
    col: str | None = None
    code: str = ""
    days: str = ""
    hours: str = ""


class AbsencesSchema(BaseModel):
    total_days: str = ""
    total_hours: str = ""
    reasons: list[AbsenceReasonSchema] = Field(default_factory=list)


class EmployeeRecordSchema(BaseModel):
    row_id: int | str | None = None
    days: dict[str, DayRecordSchema] = Field(default_factory=dict)
    totals: TotalsSchema = Field(default_factory=TotalsSchema)
    absences: AbsencesSchema = Field(default_factory=AbsencesSchema)


class DocumentMetaSchema(BaseModel):
    period_text: str = ""
    year: str = "2026"
    date_filled: str = ""
    period_start: str = ""
    period_end: str = ""
    period_type: str = ""
    template_type: str | None = None
    crossed_out_headers: list[str] = Field(default_factory=list)


class TimesheetResponseData(BaseModel):
    document_meta: DocumentMetaSchema = Field(default_factory=DocumentMetaSchema)
    employees: list[EmployeeRecordSchema] = Field(default_factory=list)


class StatusResponse(BaseModel):
    status: str
    message: str | None = None


class StatePayload(BaseModel):
    chat_id: int
    status: str = "idle"
    raw_json: str | None = None
    error_message: str | None = None

    @field_validator("status", mode="before")
    @classmethod
    def _default_status(cls, value: Any) -> str:
        if value is None:
            return "idle"
        return str(value)


class StateResponse(BaseModel):
    status: str = "success"
    state: StatePayload


class UploadAcceptedResponse(BaseModel):
    status: str = "processing"
    message: str


class ArchiveItemSchema(BaseModel):
    id: int
    period_text: str = ""
    year: str = ""
    date_filled: str = ""
    created_at: str = ""

    @field_validator("period_text", "year", "date_filled", "created_at", mode="before")
    @classmethod
    def _coerce_optional_str(cls, value: Any) -> str:
        if value is None:
            return ""
        return str(value)


class ArchiveListResponse(BaseModel):
    status: str = "success"
    archive: list[ArchiveItemSchema]


class ArchiveDetailResponse(BaseModel):
    status: str = "success"
    data: dict[str, Any]


class TemplateProfileSchema(BaseModel):
    id: str
    name: str
    description: str
    roi_crop: dict[str, float]
    employee_rows: int
    excel_template: str


class TemplatesResponse(BaseModel):
    status: str = "success"
    templates: list[TemplateProfileSchema]
