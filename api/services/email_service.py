import os
import smtplib
import socket
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from email.header import Header

# Основна функція для надсилання згенерованого Excel-файлу електронною поштою
def send_tabel_email_bytes(tabel_id: int, excel_bytes: bytes, period_text: str, year_text: str, is_test_user: bool = False) -> dict:
    sender_email = os.getenv("SENDER_EMAIL")
    sender_password = os.getenv("SENDER_PASSWORD")
    target_email = sender_email if is_test_user else os.getenv("TARGET_EMAIL")
    smtp_server = os.getenv("SMTP_SERVER", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", 587))
    
    if not all([sender_email, sender_password, target_email]):
        return {"status": "error", "message": "Налаштування пошти (.env) відсутні або неповні."}

    # Формування базових метаданих повідомлення
    subject = f"Табель обліку робочого часу за {period_text} {year_text}"
    body = (
        f"Добрий день!\n\n"
        f"Надсилаю вам табель обліку робочого часу за {period_text} {year_text}.\n"
        f"З повагою,\n"
        f"Юхименко С.В."
    )
    safe_period = period_text.replace(' ', '_').replace('/', '-')
    filename = f"Табель_за_{safe_period}_{year_text}.xlsx"

    # Створення об'єкта листа
    msg = MIMEMultipart()
    msg['From'] = sender_email
    msg['To'] = target_email
    msg['Subject'] = Header(subject, 'utf-8').encode()
    msg.attach(MIMEText(body, 'plain', 'utf-8'))

    # Додавання вкладення у вигляді байтового потоку
    part = MIMEBase("application", "vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    part.set_payload(excel_bytes)
    encoders.encode_base64(part)
    
    encoded_filename = Header(filename, 'utf-8').encode()
    part.add_header('Content-Disposition', 'attachment', filename=encoded_filename)
    msg.attach(part)

    # Примусове використання IPv4 для обходу обмежень у деяких хмарних мережах
    if "gmail.com" in smtp_server.lower():
        try:
            resolved = socket.getaddrinfo(smtp_server, smtp_port, socket.AF_INET)
            if resolved:
                smtp_server = resolved[0][4][0]
        except Exception as e:
            print(f"⚠️ IPv4 force failed: {e}")

    # Відправлення через безпечне з'єднання залежно від порту
    if smtp_port == 465:
        with smtplib.SMTP_SSL(smtp_server, smtp_port, timeout=15) as server:
            server.login(sender_email, sender_password)
            server.sendmail(sender_email, target_email, msg.as_string())
    else:
        with smtplib.SMTP(smtp_server, smtp_port, timeout=15) as server:
            server.starttls()
            server.login(sender_email, sender_password)
            server.sendmail(sender_email, target_email, msg.as_string())

    return {"status": "success", "message": "Табель успішно надіслано на email!"}