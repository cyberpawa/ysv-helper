import asyncio
import logging

from aiogram import Bot, Dispatcher, types
from aiogram.filters import Command, CommandObject, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import ReplyKeyboardRemove, Update

from api.config import settings
from api.database.session import get_supabase
from api.exceptions import DomainError

logger = logging.getLogger(__name__)

bot = Bot(token=settings.bot_token) if settings.bot_token else None
dp = Dispatcher()


class BroadcastState(StatesGroup):
    waiting_for_message = State()


class DirectMessageState(StatesGroup):
    waiting_for_message = State()


async def process_telegram_update(update_payload: dict) -> dict:
    """Feed an incoming Telegram webhook update into the aiogram dispatcher."""
    if not bot:
        return {"ok": False, "message": "Bot not configured"}
    try:
        update = Update(**update_payload)
        await dp.feed_update(bot, update)
        return {"ok": True}
    except Exception as exc:
        logger.warning("Telegram webhook update handling failed: %s", exc)
        return {"ok": False, "error": str(exc)}


async def configure_bot_webhook() -> dict:
    """Register the Telegram bot webhook with APP_URL and WEBHOOK_SECRET."""
    if not bot:
        raise DomainError("BOT_TOKEN не налаштовано на сервері.")
    if not settings.app_url:
        raise DomainError("APP_URL environment variable is required to configure webhook safely.")

    webhook_url = f"{settings.app_url.rstrip('/')}/api/telegram"
    try:
        await bot.set_webhook(webhook_url, secret_token=settings.webhook_secret)
        return {
            "status": "success",
            "message": f"Webhook configured successfully to {webhook_url}",
        }
    except Exception as exc:
        raise DomainError(f"Не вдалося налаштувати webhook: {exc}") from exc


@dp.message(CommandStart())
async def cmd_start(message: types.Message):
    if message.from_user and message.from_user.id == settings.admin_id:
        await message.answer(
            "👨‍💻 Вітаю, адміне! Тобі доступний ввід тексту та команди (/broadcast, /msg).",
            reply_markup=ReplyKeyboardRemove(),
        )
        return

    await message.answer(
        "Вітаю! Я ваш асистент для оцифрування табелів робочого часу.\n\n"
        "Натисніть кнопку зліва від поля вводу повідомлення, щоб відкрити програму.",
        reply_markup=ReplyKeyboardRemove(),
    )

    if not message.from_user:
        return

    supabase = get_supabase()
    res = (
        supabase.table("tabel_archive")
        .select("id")
        .eq("chat_id", message.from_user.id)
        .limit(1)
        .execute()
    )

    if not res.data and settings.test_photo_file_id:
        try:
            await message.answer_photo(
                photo=settings.test_photo_file_id,
                caption=(
                    "👋 Бачу, ви тут вперше! Ось тестове фото заповненого табеля. "
                    "Збережіть його та завантажте у додаток, щоб перевірити, як працює розпізнавання. "
                    "Можете не переживати, це реальний бот, але нові юзери будуть отримувати файли з цензурою "
                    "і їх листи будуть надсилатися несправжньому бухгалтеру"
                ),
            )
        except Exception as exc:
            logger.warning("Failed to send test photo: %s", exc)


@dp.message(Command("broadcast"))
async def cmd_broadcast(message: types.Message, state: FSMContext):
    if not message.from_user or message.from_user.id != settings.admin_id:
        return

    await message.answer(
        "📢 Режим розсилки увімкнено.\n\n"
        "Надішліть повідомлення (текст, фото або документ), яке потрібно розіслати всім користувачам.\n"
        "Для скасування напишіть /cancel"
    )
    await state.set_state(BroadcastState.waiting_for_message)


@dp.message(Command("cancel"), BroadcastState.waiting_for_message)
async def cancel_broadcast(message: types.Message, state: FSMContext):
    await state.clear()
    await message.answer("❌ Розсилку скасовано.")


@dp.message(BroadcastState.waiting_for_message)
async def process_broadcast_message(message: types.Message, state: FSMContext):
    await state.clear()
    await message.answer("⏳ Збираю базу користувачів та розпочинаю розсилку...")

    supabase = get_supabase()
    success_count = 0
    error_count = 0

    try:
        res = supabase.table("tabel_archive").select("chat_id").execute()
        if not res.data:
            await message.answer("В базі даних ще немає жодного користувача.")
            return

        users = {item["chat_id"] for item in res.data if item.get("chat_id")}
        for chat_id in users:
            try:
                await message.copy_to(chat_id)
                success_count += 1
                await asyncio.sleep(0.05)
            except Exception:
                error_count += 1

        await message.answer(
            f"✅ Розсилку успішно завершено!\n\n"
            f"Отримали повідомлення: {success_count} користувачів\n"
            f"Заблокували бота (не доставлено): {error_count}"
        )
    except Exception as exc:
        await message.answer(f"❌ Виникла помилка при зверненні до бази даних: {exc}")


@dp.message(Command("msg"))
async def cmd_direct_message(message: types.Message, command: CommandObject, state: FSMContext):
    if not message.from_user or message.from_user.id != settings.admin_id:
        return

    if not command.args:
        await message.answer(
            "⚠️ Використання: <code>/msg &lt;ID_користувача&gt;</code>\n"
            "Наприклад: <code>/msg 123456789</code>",
            parse_mode="HTML",
        )
        return

    target_chat_id = command.args.strip()
    if not target_chat_id.isdigit():
        await message.answer("❌ ID користувача має складатися лише з цифр.")
        return

    await state.update_data(target_chat_id=target_chat_id)
    await message.answer(
        f"📨 Режим приватного повідомлення.\n\n"
        f"Надішліть повідомлення (текст, фото або документ) для користувача <code>{target_chat_id}</code>.\n"
        f"Для скасування напишіть /cancel",
        parse_mode="HTML",
    )
    await state.set_state(DirectMessageState.waiting_for_message)


@dp.message(Command("cancel"), DirectMessageState.waiting_for_message)
async def cancel_direct_message(message: types.Message, state: FSMContext):
    await state.clear()
    await message.answer("❌ Надсилання приватного повідомлення скасовано.")


@dp.message(DirectMessageState.waiting_for_message)
async def process_direct_message(message: types.Message, state: FSMContext):
    data = await state.get_data()
    target_chat_id = data.get("target_chat_id")
    await state.clear()

    if not target_chat_id:
        return

    try:
        await message.copy_to(chat_id=int(target_chat_id))
        await message.answer(
            f"✅ Повідомлення успішно надіслано користувачу <code>{target_chat_id}</code>!",
            parse_mode="HTML",
        )
    except Exception as exc:
        await message.answer(
            f"❌ Не вдалося надіслати повідомлення.\n"
            f"Можливо, користувач заблокував бота або ID вказано невірно.\n\n"
            f"Деталі помилки: {exc}"
        )


@dp.message()
async def catch_all_messages(message: types.Message):
    if not message.from_user or message.from_user.id != settings.admin_id:
        try:
            await message.delete()
        except Exception:
            pass
    elif message.photo:
        file_id = message.photo[-1].file_id
        await message.answer(
            f"Ось `file_id` цієї фотографії для .env файлу:\n\n`{file_id}`",
            parse_mode="Markdown",
        )
