# YSV Helper

Telegram Mini App із бекендом на FastAPI для оцифрування паперових табелів обліку робочого часу, їх перевірки у таблиці, генерації `.xlsx` та відправки в бухгалтерію.

## Як це працює

1. **Захоплення фото:** камера в Mini App або завантаження зображення з галереї.
2. **Обрізка приватних даних на клієнті:** до відправки на сервер користувач обирає режим обрізки:
   - `Авто`: пошук меж таблиці на зображенні через адаптивну бінаризацію і проекції сітки.
   - `Оригінал`: повне зображення без додаткового кропу.
   - `П-5`: стандартний шаблон.
   - `П-5 extended`: розширений шаблон.
3. **Розпізнавання :** FastAPI передає обрізане зображення в Gemini зі структурованим JSON-виводом.
4. **Перевірка та доставка:** редагування будь-якої клітинки в UI, збереження стану а архів, генерація `.xlsx` через у пам'яті, відправка файлу в Telegram та на email через SMTP.

## Архітектура

```text
[React + TypeScript + Vite]
   |  1. Камера / Завантаження фото + Cropper.js
   |  2. Визначення меж таблиці + ROI-обрізка PII-зон на клієнті
   v
[FastAPI Backend]
   |  3. Перевірка HMAC-SHA256 Telegram initData + auth_date TTL
   |  4. Стейт-машина та архів у Supabase
   |  5. Gemini API
   v
[Таблиця перевірки -> Excel & Доставка]
   |  6. Заповнення шаблону .xlsx в оперативній пам'яті
   |  7. Надсилання у Telegram-чат та на email бухгалтеру
```

### Структура проєкту

- `src/config/templates.ts`: профілі обрізки та мапінг кодів неявок.
- `src/utils/templateDetector.ts`: алгоритм автовизначення меж таблиці та формування ROI-кропу на `<canvas>`.
- `src/components/TimesheetTable.tsx`: інтерактивна таблиця перевірки табеля.
- `api/index.py`: маршрути FastAPI (`/api/upload`, `/api/state`, `/api/archive/*`, `/api/generate-excel`, `/api/send-email`, `/api/telegram`).
- `api/security.py`: валідація `X-Telegram-Init-Data` (`hmac.compare_digest` + перевірка `auth_date`), список `TRUSTED_USERS`, перевірка `WEBHOOK_SECRET`.
- `api/prompts.py`: системний промпт та трансформація JSON у формат таблиці/Excel.
- `api/services/template_service.py`: реєстр шаблонів на бекенді.
- `api/services/excel_service.py`: генерація `.xlsx` через `openpyxl` у пам'яті.
- `api/services/email_service.py`: SMTP-відправка з таймаутом та IPv4 fallback.
- `api/bot/handlers.py`: хендлери `aiogram 3`.
