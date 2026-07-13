import os
from aiogram import Bot, Dispatcher, types
from aiogram.filters import CommandStart, Command, CommandObject
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import ReplyKeyboardMarkup, KeyboardButton, WebAppInfo, ReplyKeyboardRemove

from api.database.session import get_supabase

# Налаштування інстансу бота та диспетчера подій
BOT_TOKEN = os.getenv("BOT_TOKEN") or os.getenv("TELEGRAM_BOT_TOKEN")
bot = Bot(token=BOT_TOKEN) if BOT_TOKEN else None
dp = Dispatcher()

ADMIN_ID = int(os.getenv("ADMIN_ID"))

# FSM стан для процесу масової розсилки
class BroadcastState(StatesGroup):
    waiting_for_message = State()

# Стартове повідомлення бота
@dp.message(CommandStart())
async def cmd_start(message: types.Message):
    if message.from_user.id == ADMIN_ID:
        await message.answer(
            "👨‍💻 Вітаю, адміне! Тобі доступний ввід тексту та команди (/broadcast, /msg).",
            reply_markup=ReplyKeyboardRemove()
        )
    else:
        app_url = os.getenv("APP_URL", "https://ysv-helper.vercel.app").rstrip("/")
        
        markup = ReplyKeyboardMarkup(
            keyboard=[
                [KeyboardButton(text="📱 Відкрити Mini App", web_app=WebAppInfo(url=app_url))]
            ],
            resize_keyboard=True,
            is_persistent=True
        )
        
        await message.answer(
            "Вітаю! Я ваш асистент для оцифрування табелів робочого часу.\n\n"
            "Натисніть велику кнопку нижче, щоб відкрити програму.",
            reply_markup=markup
        )

# Активація режиму розсилки для адміністратора
@dp.message(Command("broadcast"))
async def cmd_broadcast(message: types.Message, state: FSMContext):
    # Ігноруємо запит, якщо ініціатор не є адміністратором
    if message.from_user.id != ADMIN_ID:
        return 

    await message.answer(
        "📢 Режим розсилки увімкнено.\n\n"
        "Надішліть повідомлення (текст, фото або документ), яке потрібно розіслати всім користувачам.\n"
        "Для скасування напишіть /cancel"
    )
    # Очікуємо на ввід контенту для розсилки
    await state.set_state(BroadcastState.waiting_for_message)

# Переривання процесу розсилки
@dp.message(Command("cancel"), BroadcastState.waiting_for_message)
async def cancel_broadcast(message: types.Message, state: FSMContext):
    await state.clear()
    await message.answer("❌ Розсилку скасовано.")

# Виконання розсилки після отримання повідомлення від адміністратора
@dp.message(BroadcastState.waiting_for_message)
async def process_broadcast_message(message: types.Message, state: FSMContext):
    # Очищуємо стан, щоб уникнути помилкових повторних відправок
    await state.clear() 
    
    await message.answer("⏳ Збираю базу користувачів та розпочинаю розсилку...")
    
    supabase = get_supabase()
    success_count = 0
    error_count = 0
    
    try:
        # Збираємо аудиторію з бази даних архіву
        res = supabase.table("tabel_archive").select("chat_id").execute()
        
        if not res.data:
            await message.answer("В базі даних ще немає жодного користувача.")
            return
            
        # Формуємо унікальну множину ID для уникнення дублікатів
        users = set(item["chat_id"] for item in res.data if item.get("chat_id"))
        
        for chat_id in users:
            try:
                # Відправляємо копію повідомлення зі збереженням структури та медіа
                await message.copy_to(chat_id)
                success_count += 1
                
                # Затримка для уникнення блокування від Telegram за спам
                await asyncio.sleep(0.05) 
                
            except Exception:
                # Рахуємо тих, хто заблокував бота або видалив акаунт
                error_count += 1
                
        await message.answer(
            f"✅ Розсилку успішно завершено!\n\n"
            f"Отримали повідомлення: {success_count} користувачів\n"
            f"Заблокували бота (не доставлено): {error_count}"
        )
        
    except Exception as e:
        await message.answer(f"❌ Виникла помилка при зверненні до бази даних: {str(e)}")

# FSM стан для надсилання повідомлення конкретному користувачу
class DirectMessageState(StatesGroup):
    waiting_for_message = State()

# Команда для ініціації приватного повідомлення
@dp.message(Command("msg"))
async def cmd_direct_message(message: types.Message, command: CommandObject, state: FSMContext):
    # Перевірка прав адміністратора
    if message.from_user.id != ADMIN_ID:
        return 

    # Перевірка наявності аргументу з ID
    if not command.args:
        await message.answer(
            "⚠️ Використання: <code>/msg &lt;ID_користувача&gt;</code>\n"
            "Наприклад: <code>/msg 123456789</code>",
            parse_mode="HTML"
        )
        return

    target_chat_id = command.args.strip()
    
    # Валідація формату ID
    if not target_chat_id.isdigit():
        await message.answer("❌ ID користувача має складатися лише з цифр.")
        return

    # Зберігаємо ID отримувача у контексті стану
    await state.update_data(target_chat_id=target_chat_id)
    
    await message.answer(
        f"📨 Режим приватного повідомлення.\n\n"
        f"Надішліть повідомлення (текст, фото або документ) для користувача <code>{target_chat_id}</code>.\n"
        f"Для скасування напишіть /cancel",
        parse_mode="HTML"
    )
    # Активуємо стан очікування контенту
    await state.set_state(DirectMessageState.waiting_for_message)

# Переривання процесу надсилання приватного повідомлення
@dp.message(Command("cancel"), DirectMessageState.waiting_for_message)
async def cancel_direct_message(message: types.Message, state: FSMContext):
    await state.clear()
    await message.answer("❌ Надсилання приватного повідомлення скасовано.")

# Надсилання зібраного контенту заданому користувачу
@dp.message(DirectMessageState.waiting_for_message)
async def process_direct_message(message: types.Message, state: FSMContext):
    # Отримуємо цільовий ID із пам'яті FSM
    data = await state.get_data()
    target_chat_id = data.get("target_chat_id")
    
    # Деактивуємо стан очікування
    await state.clear() 
    
    try:
        # Пересилаємо повідомлення адресату
        await message.copy_to(chat_id=target_chat_id)
        await message.answer(f"✅ Повідомлення успішно надіслано користувачу <code>{target_chat_id}</code>!", parse_mode="HTML")
        
    except Exception as e:
        await message.answer(
            f"❌ Не вдалося надіслати повідомлення.\n"
            f"Можливо, користувач заблокував бота або ID вказано невірно.\n\n"
            f"Деталі помилки: {str(e)}"
        )

# Видалення повідомлень звичайних користувачів
@dp.message()
async def catch_all_messages(message: types.Message):
    if message.from_user.id != ADMIN_ID:
        try:
            await message.delete()
        except Exception:
            pass