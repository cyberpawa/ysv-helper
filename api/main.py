import logging
from typing import Annotated

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api.bot.handlers import configure_bot_webhook, process_telegram_update
from api.config import settings
from api.exceptions import (
    AccessDeniedError,
    DomainError,
    HighDemandError,
    NotATimesheetError,
    QuotaExceededError,
    ResourceNotFoundError,
)
from api.schemas import (
    ArchiveDetailResponse,
    ArchiveListResponse,
    ArchiveUpdateRequest,
    EmailRequest,
    ExcelRequest,
    StatePayload,
    StateResponse,
    StatusResponse,
    TemplatesResponse,
    UploadAcceptedResponse,
    UploadRequest,
)
from api.security import get_current_tg_user, verify_webhook_secret
from api.services.template_service import list_template_profiles
from api.services.timesheet_service import (
    create_and_deliver_excel,
    get_user_archive_detail,
    get_user_state_record,
    list_user_archive,
    mark_state_processing,
    process_timesheet_upload_task,
    reset_user_state_record,
    send_archived_tabel_email,
    update_user_archive_item,
)

CurrentUser = Annotated[dict, Depends(get_current_tg_user)]
logger = logging.getLogger(__name__)

app = FastAPI(title="YSV Helper API", version="1.3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=(settings.cors_origins != ["*"]),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(DomainError)
async def domain_error_handler(_request: Request, exc: DomainError) -> JSONResponse:
    status_code = status.HTTP_400_BAD_REQUEST
    error_status = "error"

    if isinstance(exc, AccessDeniedError):
        status_code = status.HTTP_403_FORBIDDEN
    elif isinstance(exc, ResourceNotFoundError):
        status_code = status.HTTP_404_NOT_FOUND
    elif isinstance(exc, NotATimesheetError):
        status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    elif isinstance(exc, QuotaExceededError):
        status_code = status.HTTP_429_TOO_MANY_REQUESTS
    elif isinstance(exc, HighDemandError):
        status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        error_status = "high_demand"

    return JSONResponse(
        status_code=status_code,
        content={"status": error_status, "message": str(exc), "detail": str(exc)},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(_request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled server exception: %s", exc)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "status": "error",
            "message": f"Внутрішня помилка сервера: {exc}",
            "detail": str(exc),
        },
    )


@app.post("/api/telegram")
async def telegram_webhook(request: Request) -> dict:
    if settings.webhook_secret:
        header_secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token")
        if not verify_webhook_secret(header_secret):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Invalid Telegram webhook secret token.",
            )

    update_payload = await request.json()
    return await process_telegram_update(update_payload)


@app.get("/api/setup-webhook", response_model=StatusResponse)
async def setup_webhook(secret: str | None = None) -> StatusResponse:
    if not verify_webhook_secret(secret):
        raise AccessDeniedError("Доступ заборонено")

    result = await configure_bot_webhook()
    return StatusResponse(**result)


@app.get("/api/templates", response_model=TemplatesResponse)
async def get_templates(_current_user: CurrentUser) -> TemplatesResponse:
    return TemplatesResponse(templates=list_template_profiles())


@app.get("/api/state", response_model=StateResponse)
async def get_user_state(current_user: CurrentUser) -> StateResponse:
    state_record = get_user_state_record(current_user["id"])
    return StateResponse(state=StatePayload(**state_record))


@app.post("/api/state/reset", response_model=StatusResponse)
async def reset_user_state(current_user: CurrentUser) -> StatusResponse:
    reset_user_state_record(current_user["id"])
    return StatusResponse(status="success")


@app.post(
    "/api/upload",
    response_model=UploadAcceptedResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def receive_image(
    req: UploadRequest,
    background_tasks: BackgroundTasks,
    current_user: CurrentUser,
) -> UploadAcceptedResponse:
    if not req.image:
        raise DomainError("Зображення не знайдено")

    if len(req.image) > settings.max_image_base64_length:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Розмір зображення перевищує допустимий ліміт (15 МБ).",
        )

    chat_id = current_user["id"]
    mark_state_processing(chat_id)
    background_tasks.add_task(
        process_timesheet_upload_task,
        chat_id=chat_id,
        image_b64=req.image,
        template_id=req.template_id,
        use_fallback=req.use_fallback,
    )
    return UploadAcceptedResponse(status="processing", message="Обробку табеля розпочато")


@app.get("/api/archive", response_model=ArchiveListResponse)
async def get_archive(current_user: CurrentUser) -> ArchiveListResponse:
    items = list_user_archive(current_user["id"])
    return ArchiveListResponse(archive=items)


@app.get("/api/archive/detail/{tabel_id}", response_model=ArchiveDetailResponse)
async def get_archive_detail(tabel_id: int, current_user: CurrentUser) -> ArchiveDetailResponse:
    data = get_user_archive_detail(current_user["id"], tabel_id)
    return ArchiveDetailResponse(data=data)


@app.post("/api/archive/update/{tabel_id}", response_model=StatusResponse)
async def update_archive_item(
    tabel_id: int,
    req: ArchiveUpdateRequest,
    current_user: CurrentUser,
) -> StatusResponse:
    update_user_archive_item(current_user["id"], tabel_id, req.data)
    return StatusResponse(status="success", message="Архівний табель успішно оновлено!")


@app.post("/api/generate-excel", response_model=StatusResponse)
async def generate_excel(req: ExcelRequest, current_user: CurrentUser) -> StatusResponse:
    await create_and_deliver_excel(current_user["id"], req.data)
    return StatusResponse(status="success", message="Табель згенеровано та надіслано!")


@app.post("/api/send-email", response_model=StatusResponse)
async def send_email_endpoint(req: EmailRequest, current_user: CurrentUser) -> StatusResponse:
    result = await send_archived_tabel_email(current_user["id"], req.tabel_id)
    return StatusResponse(**result)
