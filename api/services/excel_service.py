import io
import os
import openpyxl
from openpyxl.styles import PatternFill
from api.database.session import get_supabase

# Функція генерації табеля у пам'яті без збереження на диск
def generate_excel_bytes(parsed_data: dict, is_test_user: bool = False) -> bytes:
    meta = parsed_data.get("document_meta", {})
    
    # Отримання базового шаблону Excel з хмарного сховища Supabase
    try:
        supabase_client = get_supabase()
        bucket_name = os.getenv("SUPABASE_BUCKET", "templates")

        # Динамічний вибір шаблону
        if is_test_user:
            template_name = "fake_template.xlsx"
        else:
            template_name = os.getenv("SUPABASE_TEMPLATE_FILE", "timesheet_template.xlsx")

        print(f"📥 Downloading Excel template from Supabase Storage: {bucket_name}/{template_name}...")
        response = supabase_client.storage.from_(bucket_name).download(template_name)
        template_file = io.BytesIO(response)
    except Exception as e:
        # Альтернативний сценарій: завантаження локального файлу, якщо хмара недоступна
        print(f"⚠️ Supabase Storage download failed: {e}. Falling back to local file.")
        template_path = "табель(травень1)2026.xlsx" if os.path.exists("табель(травень1)2026.xlsx") else "Табель 1.xlsx"
        if os.path.exists(template_path):
            with open(template_path, "rb") as f:
                template_file = io.BytesIO(f.read())
        else:
            raise Exception(f"Failed to fetch Excel template: {e}")
            
    wb = openpyxl.load_workbook(template_file)
    ws = wb["Бланк"] if "Бланк" in wb.sheetnames else wb.active
    
    COORD_TITLE, COORD_DATE_FILLED, COORD_PERIOD_START, COORD_PERIOD_END = (7, 5), (8, 36), (8, 38), (8, 40)
    yellow_fill = PatternFill(start_color="FFFF00", end_color="FFFF00", fill_type="solid")

    # Допоміжна функція для запису даних у комірки (з урахуванням об'єднаних комірок)
    def write_to_cell(row, col, value):
        if value is None or value == "": return
        cell = ws.cell(row=row, column=col)
        for merged_range in ws.merged_cells.ranges:
            if cell.coordinate in merged_range:
                ws.cell(row=merged_range.min_row, column=merged_range.min_col, value=value)
                return
        cell.value = value

    # Допоміжна функція для фарбування комірок (з урахуванням об'єднаних комірок)
    def fill_cell_yellow(row, col):
        cell = ws.cell(row=row, column=col)
        for merged_range in ws.merged_cells.ranges:
            if cell.coordinate in merged_range:
                for r in range(merged_range.min_row, merged_range.max_row + 1):
                    for c in range(merged_range.min_col, merged_range.max_col + 1):
                        ws.cell(row=r, column=c).fill = yellow_fill
                return
        cell.fill = yellow_fill

    crossed_days = meta.get("crossed_out_headers", [])
    write_to_cell(COORD_TITLE[0], COORD_TITLE[1], f"Табель обліку використання робочого часу за {meta.get('period_text', '')} {meta.get('year', '2026')} року") 
    write_to_cell(COORD_DATE_FILLED[0], COORD_DATE_FILLED[1], meta.get("date_filled", "")) 
    write_to_cell(COORD_PERIOD_START[0], COORD_PERIOD_START[1], meta.get("period_start", "")) 
    write_to_cell(COORD_PERIOD_END[0], COORD_PERIOD_END[1], meta.get("period_end", "")) 

    if "X" in crossed_days or "Х" in crossed_days: fill_cell_yellow(12, 22)

    # Ітерація по кожному співробітнику для внесення відпрацьованого часу
    start_row = 21 
    for i, emp in enumerate(parsed_data.get("employees", [])):
        base_row = start_row + (i * 4) 
        days, totals, absences = emp.get("days", {}), emp.get("totals", {}), emp.get("absences", {})
        
        # Заповнення першої половини місяця (1-15 числа)
        for d in range(1, 16):
            col = 6 + d
            day_str = f"{d:02d}"
            if day_str in crossed_days: fill_cell_yellow(12, col)
            write_to_cell(base_row, col, days.get(day_str, {}).get("hours", ""))
            write_to_cell(base_row+1, col, days.get(day_str, {}).get("code", ""))

        # Заповнення другої половини місяця (16-31 числа)
        for d in range(16, 32): 
            col = 6 + (d - 15)
            day_str = str(d)
            if day_str in crossed_days: fill_cell_yellow(17, col)
            write_to_cell(base_row+2, col, days.get(day_str, {}).get("hours", ""))
            write_to_cell(base_row+3, col, days.get(day_str, {}).get("code", ""))

        # Внесення підсумкових сум по відпрацьованому часу
        write_to_cell(base_row, 23, totals.get("days", ""))
        write_to_cell(base_row, 24, totals.get("hours", ""))
        
        total_abs_days, total_abs_hours = absences.get("total_days", ""), absences.get("total_hours", "")
        if total_abs_days and total_abs_days != "-": write_to_cell(base_row, 31, total_abs_days)
        if total_abs_hours and total_abs_hours != "-": write_to_cell(base_row+2, 31, total_abs_hours) 
            
        # Логіка розподілу причин неявок по відповідних колонках
        cols_data = {}
        for r in absences.get("reasons", []):
            code = str(r.get("code", "")).upper().strip()
            if not code or code == "-": continue
            r_days, r_hours = r.get("days", "").strip(), r.get("hours", "").strip()
            
            target_col = 40 
            if code in ["В", "Щ", "Д", "8", "9", "10"]: target_col = 32
            elif code in ["Н", "ВЧ", "11", "12", "13", "14", "15", "17", "22"]: target_col = 33
            elif code in ["НА", "БЗ", "18", "19"]: target_col = 34
            elif code in ["НД", "20"]: target_col = 35
            elif code in ["П", "23"]: target_col = 36
            elif code in ["ПР", "24"]: target_col = 37
            elif code in ["С", "25"]: target_col = 38
            elif code in ["ТН", "Л", "26", "27"]: target_col = 39
            
            frac = f"{r_days}/{r_hours}" if r_days and r_days != "-" and r_hours and r_hours != "-" else (r_days if r_days and r_days != "-" else (f"/{r_hours}" if r_hours and r_hours != "-" else ""))
            cols_data[target_col] = {"code": code, "frac": frac}
        
        for target_col, item in cols_data.items():
            write_to_cell(base_row, target_col, item["code"])
            if item["frac"]: write_to_cell(base_row+2, target_col, item["frac"])

    output_stream = io.BytesIO()
    wb.save(output_stream)
    return output_stream.getvalue()