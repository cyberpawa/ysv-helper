import io
import logging
import os

import openpyxl
from openpyxl.styles import PatternFill

from api.database.session import get_supabase

logger = logging.getLogger(__name__)

ABSENCE_CODE_TO_COL: list[tuple[set[str], int]] = [
    ({"В", "Щ", "Д", "8", "9", "10"}, 32),
    ({"Н", "ВЧ", "11", "12", "13", "14", "15", "17", "22"}, 33),
    ({"НА", "БЗ", "18", "19"}, 34),
    ({"НД", "20"}, 35),
    ({"П", "23"}, 36),
    ({"ПР", "24"}, 37),
    ({"С", "25"}, 38),
    ({"ТН", "Л", "26", "27"}, 39),
]


def _resolve_absence_col(code: str) -> int:
    for codes, col in ABSENCE_CODE_TO_COL:
        if code in codes:
            return col
    return 40


def _format_absence_fraction(days_val: str, hours_val: str) -> str:
    has_days = bool(days_val and days_val != "-")
    has_hours = bool(hours_val and hours_val != "-")
    if has_days and has_hours:
        return f"{days_val}/{hours_val}"
    if has_days:
        return days_val
    if has_hours:
        return f"/{hours_val}"
    return ""


def generate_excel_bytes(parsed_data: dict, is_test_user: bool = False) -> bytes:
    """Populate the Excel form in memory and return .xlsx bytes."""
    meta = parsed_data.get("document_meta", {})

    try:
        supabase_client = get_supabase()
        bucket_name = os.getenv("SUPABASE_BUCKET", "templates")
        if is_test_user:
            template_name = "fake_template.xlsx"
        else:
            template_name = os.getenv("SUPABASE_TEMPLATE_FILE", "timesheet_template.xlsx")

        logger.info("Downloading Excel template from %s/%s", bucket_name, template_name)
        response = supabase_client.storage.from_(bucket_name).download(template_name)
        template_file = io.BytesIO(response)
    except Exception as exc:
        logger.warning("Supabase Storage download failed (%s), falling back to local file", exc)
        template_path = (
            "табель(травень1)2026.xlsx"
            if os.path.exists("табель(травень1)2026.xlsx")
            else "Табель 1.xlsx"
        )
        if not os.path.exists(template_path):
            raise RuntimeError(f"Failed to fetch Excel template: {exc}") from exc
        with open(template_path, "rb") as f:
            template_file = io.BytesIO(f.read())

    wb = openpyxl.load_workbook(template_file)
    ws = wb["Бланк"] if "Бланк" in wb.sheetnames else wb.active

    yellow_fill = PatternFill(start_color="FFFF00", end_color="FFFF00", fill_type="solid")

    def write_to_cell(row: int, col: int, value) -> None:
        if value is None or value == "":
            return
        cell = ws.cell(row=row, column=col)
        for merged_range in ws.merged_cells.ranges:
            if cell.coordinate in merged_range:
                ws.cell(
                    row=merged_range.min_row,
                    column=merged_range.min_col,
                    value=value,
                )
                return
        cell.value = value

    def fill_cell_yellow(row: int, col: int) -> None:
        cell = ws.cell(row=row, column=col)
        for merged_range in ws.merged_cells.ranges:
            if cell.coordinate in merged_range:
                for r in range(merged_range.min_row, merged_range.max_row + 1):
                    for c in range(merged_range.min_col, merged_range.max_col + 1):
                        ws.cell(row=r, column=c).fill = yellow_fill
                return
        cell.fill = yellow_fill

    crossed_days = meta.get("crossed_out_headers", [])
    title = (
        f"Табель обліку використання робочого часу за "
        f"{meta.get('period_text', '')} {meta.get('year', '2026')} року"
    )
    write_to_cell(7, 5, title)
    write_to_cell(8, 36, meta.get("date_filled", ""))
    write_to_cell(8, 38, meta.get("period_start", ""))
    write_to_cell(8, 40, meta.get("period_end", ""))

    if "X" in crossed_days or "Х" in crossed_days:
        fill_cell_yellow(12, 22)

    start_row = 21
    for i, emp in enumerate(parsed_data.get("employees", [])):
        base_row = start_row + (i * 4)
        days = emp.get("days", {})
        totals = emp.get("totals", {})
        absences = emp.get("absences", {})

        for d in range(1, 16):
            col = 6 + d
            day_str = f"{d:02d}"
            if day_str in crossed_days:
                fill_cell_yellow(12, col)
            write_to_cell(base_row, col, days.get(day_str, {}).get("hours", ""))
            write_to_cell(base_row + 1, col, days.get(day_str, {}).get("code", ""))

        for d in range(16, 32):
            col = 6 + (d - 15)
            day_str = str(d)
            if day_str in crossed_days:
                fill_cell_yellow(17, col)
            write_to_cell(base_row + 2, col, days.get(day_str, {}).get("hours", ""))
            write_to_cell(base_row + 3, col, days.get(day_str, {}).get("code", ""))

        write_to_cell(base_row, 23, totals.get("days", ""))
        write_to_cell(base_row, 24, totals.get("hours", ""))

        total_abs_days = absences.get("total_days", "")
        total_abs_hours = absences.get("total_hours", "")
        if total_abs_days and total_abs_days != "-":
            write_to_cell(base_row, 31, total_abs_days)
        if total_abs_hours and total_abs_hours != "-":
            write_to_cell(base_row + 2, 31, total_abs_hours)

        cols_data: dict[int, dict[str, str]] = {}
        for reason in absences.get("reasons", []):
            code = str(reason.get("code", "")).upper().strip()
            if not code or code == "-":
                continue
            r_days = str(reason.get("days", "")).strip()
            r_hours = str(reason.get("hours", "")).strip()
            target_col = _resolve_absence_col(code)
            cols_data[target_col] = {
                "code": code,
                "frac": _format_absence_fraction(r_days, r_hours),
            }

        for target_col, item in cols_data.items():
            write_to_cell(base_row, target_col, item["code"])
            if item["frac"]:
                write_to_cell(base_row + 2, target_col, item["frac"])

    output_stream = io.BytesIO()
    wb.save(output_stream)
    return output_stream.getvalue()
