"""Configuration profiles for supported paper timesheet templates and PII ROI cropping."""

TIMESHEET_TEMPLATES: dict[str, dict] = {
    "auto": {
        "id": "auto",
        "name": "Авто",
        "description": "Автоматичне обрізання до верхньої та нижньої меж таблиці та 10% зліва від її краю",
        "roi_crop": {"left": 0.10, "top": 0.10, "width": 0.90, "height": 0.80},
        "employee_rows": 4,
        "excel_template": "timesheet_template.xlsx",
    },
    "original": {
        "id": "original",
        "name": "Оригінал",
        "description": "Повний лист без додаткової ROI-обрізки",
        "roi_crop": {"left": 0.0, "top": 0.0, "width": 1.0, "height": 1.0},
        "employee_rows": 4,
        "excel_template": "timesheet_template.xlsx",
    },
    "form_p5": {
        "id": "form_p5",
        "name": "П-5",
        "description": "Стандартна обрізка бланка П-5 (15% зліва, 15% зверху, 15% знизу)",
        "roi_crop": {"left": 0.15, "top": 0.15, "width": 0.85, "height": 0.70},
        "employee_rows": 4,
        "excel_template": "timesheet_template.xlsx",
    },
    "form_p5_extended": {
        "id": "form_p5_extended",
        "name": "П-5 extended",
        "description": "Розширена обрізка бланка П-5 (10% зліва, 10% зверху, 10% знизу)",
        "roi_crop": {"left": 0.10, "top": 0.10, "width": 0.90, "height": 0.80},
        "employee_rows": 4,
        "excel_template": "timesheet_template.xlsx",
    },
}

# Alias for backward compatibility with earlier requests
TIMESHEET_TEMPLATES["form_p5_standard"] = TIMESHEET_TEMPLATES["form_p5"]

DEFAULT_TEMPLATE_ID = "form_p5"


def get_template_profile(template_id: str | None) -> dict:
    """Resolve template profile by ID, falling back to form_p5."""
    if not template_id or template_id not in TIMESHEET_TEMPLATES:
        return TIMESHEET_TEMPLATES[DEFAULT_TEMPLATE_ID]
    return TIMESHEET_TEMPLATES[template_id]


def list_template_profiles() -> list[dict]:
    """Return configured primary template profiles for API consumers."""
    return [
        TIMESHEET_TEMPLATES["auto"],
        TIMESHEET_TEMPLATES["original"],
        TIMESHEET_TEMPLATES["form_p5"],
        TIMESHEET_TEMPLATES["form_p5_extended"],
    ]
