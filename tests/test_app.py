import asyncio
import base64
import hashlib
import hmac
import json
import time
from types import SimpleNamespace
from urllib.parse import urlencode

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from api.config import settings
from api.exceptions import (
    DomainError,
    HighDemandError,
    NotATimesheetError,
)
from api.main import app
from api.prompts import transform_ai_json_to_response
from api.security import (
    is_trusted_user,
    verify_telegram_init_data,
    verify_webhook_secret,
)
from api.services.excel_service import _format_absence_fraction, _resolve_absence_col
from api.services.gemini_service import analyze_timesheet_image


def _build_signed_init_data(bot_token: str, user_payload: dict, auth_date: int) -> str:
    params = {
        "auth_date": str(auth_date),
        "query_id": "AAHdF6IQAAAAAN0XohDhrOrc",
        "user": json.dumps(user_payload, separators=(",", ":")),
    }
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(params.items()))
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    signature = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    params["hash"] = signature
    return urlencode(params)


def test_verify_telegram_init_data_valid(monkeypatch: pytest.MonkeyPatch) -> None:
    token = "123456:TEST_TOKEN"
    monkeypatch.setattr(settings, "bot_token", token)
    monkeypatch.setattr(settings, "allow_mock_telegram", False)
    monkeypatch.setattr(settings, "init_data_max_age_seconds", 86400)

    init_data = _build_signed_init_data(token, {"id": 4242, "first_name": "Ivan"}, int(time.time()))
    user = verify_telegram_init_data(init_data)
    assert user["id"] == 4242
    assert user["first_name"] == "Ivan"


def test_verify_telegram_init_data_invalid_hash(monkeypatch: pytest.MonkeyPatch) -> None:
    token = "123456:TEST_TOKEN"
    monkeypatch.setattr(settings, "bot_token", token)
    monkeypatch.setattr(settings, "allow_mock_telegram", False)

    init_data = _build_signed_init_data(token, {"id": 4242, "first_name": "Ivan"}, int(time.time()))
    tampered = init_data[:-4] + "0000"

    with pytest.raises(HTTPException) as exc_info:
        verify_telegram_init_data(tampered)
    assert exc_info.value.status_code == 401


def test_verify_telegram_init_data_expired(monkeypatch: pytest.MonkeyPatch) -> None:
    token = "123456:TEST_TOKEN"
    monkeypatch.setattr(settings, "bot_token", token)
    monkeypatch.setattr(settings, "allow_mock_telegram", False)
    monkeypatch.setattr(settings, "init_data_max_age_seconds", 300)

    old_ts = int(time.time()) - 1000
    init_data = _build_signed_init_data(token, {"id": 4242}, old_ts)

    with pytest.raises(HTTPException) as exc_info:
        verify_telegram_init_data(init_data)
    assert exc_info.value.status_code == 401


def test_trusted_user_and_webhook_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "trusted_users", "111, 222")
    monkeypatch.setattr(settings, "admin_id", 999)
    monkeypatch.setattr(settings, "webhook_secret", "super-secret")

    assert is_trusted_user(111) is True
    assert is_trusted_user(999) is True
    assert is_trusted_user(333) is False

    assert verify_webhook_secret("super-secret") is True
    assert verify_webhook_secret("wrong-secret") is False
    assert verify_webhook_secret(None) is False


def test_transform_ai_json_to_response() -> None:
    ai_payload = {
        "is_timesheet_table": True,
        "document_meta": {
            "period_text": "березень місяць",
            "year": "2026",
            "date_filled": "31.03.2026",
            "period_start": "01.03",
            "period_end": "31.03",
            "period_type": "B",
            "crossed_out_headers": ["07", "08"],
        },
        "employees": [
            {
                "row_id": 1,
                "chunk_01_05": {"01": "Р_8,25", "02": "В_-"},
                "totals_days": "20",
                "totals_hours": "165",
                "absences_total_days": "1",
                "absences_total_hours": "8",
                "absence_reasons": [{"code": "8", "days": "1", "hours": "8"}],
            }
        ],
    }

    normalized = transform_ai_json_to_response(ai_payload, template_id="form_p5_extended")
    assert normalized["document_meta"]["template_type"] == "form_p5_extended"
    assert len(normalized["employees"]) == 1

    emp = normalized["employees"][0]
    assert emp["days"]["01"] == {"hours": "8,25", "code": "Р"}
    assert emp["days"]["02"] == {"hours": "-", "code": "В"}
    assert emp["days"]["31"] == {"hours": "-", "code": "-"}
    assert len(emp["days"]) == 31


def test_excel_absence_helpers() -> None:
    assert _resolve_absence_col("8") == 32
    assert _resolve_absence_col("ТН") == 39
    assert _resolve_absence_col("UNKNOWN") == 40

    assert _format_absence_fraction("2", "16") == "2/16"
    assert _format_absence_fraction("3", "-") == "3"
    assert _format_absence_fraction("-", "8") == "/8"
    assert _format_absence_fraction("-", "-") == ""


def test_gemini_invalid_base64() -> None:
    with pytest.raises(DomainError, match="Некоректний формат зображення"):
        asyncio.run(analyze_timesheet_image("!!!not-valid-base64!!!", "auto"))


def test_gemini_invalid_json_raises_domain_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeModel:
        def __init__(self, **_kwargs):
            pass

        def generate_content(self, _contents, **_kwargs):
            return SimpleNamespace(text="{broken: json payload}")

    monkeypatch.setattr("api.services.gemini_service.genai.GenerativeModel", FakeModel)
    valid_b64 = base64.b64encode(b"fake-jpeg").decode()

    with pytest.raises(DomainError, match="Помилка розбору JSON-відповіді"):
        asyncio.run(analyze_timesheet_image(valid_b64, "auto"))


def test_gemini_non_table_image_raises_not_a_timesheet(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeModel:
        def __init__(self, **_kwargs):
            pass

        def generate_content(self, _contents, **_kwargs):
            payload = {
                "is_timesheet_table": False,
                "rejection_reason": "На фото зображено пейзаж, а не табель.",
                "employees": [],
            }
            return SimpleNamespace(text=json.dumps(payload, ensure_ascii=False))

    monkeypatch.setattr("api.services.gemini_service.genai.GenerativeModel", FakeModel)
    valid_b64 = base64.b64encode(b"fake-jpeg").decode()

    with pytest.raises(NotATimesheetError, match="пейзаж"):
        asyncio.run(analyze_timesheet_image(valid_b64, "auto"))


def test_gemini_high_demand_error(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeModel:
        def __init__(self, **_kwargs):
            pass

        def generate_content(self, _contents, **_kwargs):
            raise RuntimeError("503 Service Unavailable due to high demand")

    monkeypatch.setattr("api.services.gemini_service.genai.GenerativeModel", FakeModel)
    valid_b64 = base64.b64encode(b"fake-jpeg").decode()

    with pytest.raises(HighDemandError):
        asyncio.run(analyze_timesheet_image(valid_b64, "auto"))


def test_api_routes_auth_and_templates(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "allow_mock_telegram", False)
    client = TestClient(app)

    unauth_resp = client.get("/api/templates")
    assert unauth_resp.status_code == 401

    monkeypatch.setattr(settings, "allow_mock_telegram", True)
    auth_resp = client.get("/api/templates")
    assert auth_resp.status_code == 200
    body = auth_resp.json()
    assert body["status"] == "success"
    assert [t["id"] for t in body["templates"]] == [
        "auto",
        "original",
        "form_p5",
        "form_p5_extended",
    ]


def test_api_upload_schedules_background_task(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "allow_mock_telegram", True)
    recorded_calls: list[dict] = []

    monkeypatch.setattr(
        "api.main.mark_state_processing", lambda chat_id: recorded_calls.append({"marked": chat_id})
    )

    async def fake_bg_task(**kwargs):
        recorded_calls.append({"bg": kwargs})

    monkeypatch.setattr("api.main.process_timesheet_upload_task", fake_bg_task)

    client = TestClient(app)
    resp = client.post(
        "/api/upload",
        json={"image": "data:image/jpeg;base64,ZmFrZQ==", "template_id": "form_p5"},
    )
    assert resp.status_code == 202
    assert resp.json()["status"] == "processing"
    assert any("marked" in item for item in recorded_calls)
    assert any("bg" in item for item in recorded_calls)


def test_api_state_error_returns_http_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "allow_mock_telegram", True)

    def fail_state(_chat_id: int) -> dict:
        raise DomainError("DB unavailable")

    monkeypatch.setattr("api.main.get_user_state_record", fail_state)
    client = TestClient(app)
    resp = client.get("/api/state")
    assert resp.status_code == 400
    assert resp.json()["status"] == "error"


def test_api_setup_webhook_rejects_invalid_secret(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "webhook_secret", "expected-secret")
    client = TestClient(app)
    resp = client.get("/api/setup-webhook", params={"secret": "invalid"})
    assert resp.status_code == 403
    assert resp.json()["status"] == "error"


def test_api_archive_handles_null_and_int_fields_from_db(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "allow_mock_telegram", True)
    monkeypatch.setattr(
        "api.main.list_user_archive",
        lambda _chat_id: [
            {
                "id": 10,
                "period_text": None,
                "year": 2026,
                "date_filled": None,
                "created_at": "2026-11-14T12:00:00Z",
            }
        ],
    )
    client = TestClient(app)
    resp = client.get("/api/archive")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "success"
    assert body["archive"][0] == {
        "id": 10,
        "period_text": "",
        "year": "2026",
        "date_filled": "",
        "created_at": "2026-11-14T12:00:00Z",
    }
