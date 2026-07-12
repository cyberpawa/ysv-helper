import os
from aiogram import Bot, Dispatcher, types
from aiogram.filters import CommandStart, Command, CommandObject
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup

# Импортируем функцию для работы с базой данных из твоего проекта
from api.database.session import get_supabase

BOT_TOKEN = os.getenv("BOT_TOKEN") or os.getenv("TELEGRAM_BOT_TOKEN")
bot = Bot(token=BOT_TOKEN) if BOT_TOKEN else None
dp = Dispatcher()

ADMIN_ID = int(os.getenv("ADMIN_ID"))

# 1. Создаем класс состояний для режима рассылки
class BroadcastState(StatesGroup):
    waiting_for_message = State()

@dp.message(CommandStart())
async def cmd_start(message: types.Message):
    await message.answer(
        "Вітаю! Я ваш асистент для оцифрування табелів робочого часу.\n\n"
        "Вся робота, архів та сканування проходять у Mini App. "
        "Будь ласка, скористайтеся кнопкою меню внизу екрана для входу."
    )

# ==========================================
# БЛОК РАССЫЛКИ (ТОЛЬКО ДЛЯ АДМИНА)
# ==========================================

# 2. Команда для запуска рассылки
@dp.message(Command("broadcast"))
async def cmd_broadcast(message: types.Message, state: FSMContext):
    # Если пишет не админ, просто выходим (бот промолчит)
    if message.from_user.id != ADMIN_ID:
        return 

    await message.answer(
        "📢 Режим розсилки увімкнено.\n\n"
        "Надішліть повідомлення (текст, фото або документ), яке потрібно розіслати всім користувачам.\n"
        "Для скасування напишіть /cancel"
    )
    # Переводим бота в состояние ожидания сообщения
    await state.set_state(BroadcastState.waiting_for_message)

# 3. Кнопка отмены (если передумал рассылать)
@dp.message(Command("cancel"), BroadcastState.waiting_for_message)
async def cancel_broadcast(message: types.Message, state: FSMContext):
    await state.clear()
    await message.answer("❌ Розсилку скасовано.")

# 4. Ловим само сообщение и начинаем рассылать
@dp.message(BroadcastState.waiting_for_message)
async def process_broadcast_message(message: types.Message, state: FSMContext):
    # Сразу выходим из режима ожидания, чтобы следующие сообщения не шли в рассылку
    await state.clear() 
    
    await message.answer("⏳ Збираю базу користувачів та розпочинаю розсилку...")
    
    supabase = get_supabase()
    success_count = 0
    error_count = 0
    
    try:
        # Достаем всех пользователей, которые когда-либо запускали бота (из таблицы user_state)
        res = supabase.table("tabel_archive").select("chat_id").execute()
        
        if not res.data:
            await message.answer("В базі даних ще немає жодного користувача.")
            return
            
        # Используем set(), чтобы убрать возможные дубликаты ID
        users = set(item["chat_id"] for item in res.data if item.get("chat_id"))
        
        for chat_id in users:
            try:
                # Метод copy_to идеален для рассылок: он копирует сообщение "как есть", 
                # поддерживая форматирование, картинки, кнопки и файлы.
                await message.copy_to(chat_id)
                success_count += 1
                
                # КРИТИЧЕСКИ ВАЖНО: Защита от спам-фильтра Telegram (Flood Limit)
                # Без этой паузы Telegram навсегда заблокирует бота при отправке >30 сообщений в секунду
                await asyncio.sleep(0.05) 
                
            except Exception:
                # Ошибка обычно значит, что пользователь заблокировал бота или удалил чат
                error_count += 1
                
        await message.answer(
            f"✅ Розсилку успішно завершено!\n\n"
            f"Отримали повідомлення: {success_count} користувачів\n"
            f"Заблокували бота (не доставлено): {error_count}"
        )
        
    except Exception as e:
        await message.answer(f"❌ Виникла помилка при зверненні до бази даних: {str(e)}")

# ==========================================
# БЛОК ЛИЧНЫХ СООБЩЕНИЙ (ТОЛЬКО ДЛЯ АДМИНА)
# ==========================================

# 1. Создаем класс состояний для личного сообщения
class DirectMessageState(StatesGroup):
    waiting_for_message = State()

# 2. Команда для запуска отправки личного сообщения (/msg <ID>)
@dp.message(Command("msg"))
async def cmd_direct_message(message: types.Message, command: CommandObject, state: FSMContext):
    # Проверка на админа
    if message.from_user.id != ADMIN_ID:
        return 

    # Проверяем, передал ли админ ID пользователя
    if not command.args:
        await message.answer(
            "⚠️ Використання: <code>/msg &lt;ID_користувача&gt;</code>\n"
            "Наприклад: <code>/msg 123456789</code>",
            parse_mode="HTML"
        )
        return

    target_chat_id = command.args.strip()
    
    # Защита от дурака: ID должен состоять только из цифр
    if not target_chat_id.isdigit():
        await message.answer("❌ ID користувача має складатися лише з цифр.")
        return

    # Сохраняем ID получателя в оперативную память состояния (FSM)
    await state.update_data(target_chat_id=target_chat_id)
    
    await message.answer(
        f"📨 Режим приватного повідомлення.\n\n"
        f"Надішліть повідомлення (текст, фото або документ) для користувача <code>{target_chat_id}</code>.\n"
        f"Для скасування напишіть /cancel",
        parse_mode="HTML"
    )
    # Переводим бота в состояние ожидания самого сообщения
    await state.set_state(DirectMessageState.waiting_for_message)

# 3. Ловим сообщение и отправляем адресату
@dp.message(DirectMessageState.waiting_for_message)
async def process_direct_message(message: types.Message, state: FSMContext):
    # Достаем сохраненный ID пользователя из памяти FSM
    data = await state.get_data()
    target_chat_id = data.get("target_chat_id")
    
    # Сразу выходим из режима ожидания
    await state.clear() 
    
    try:
        # Снова используем copy_to, чтобы переслать медиа, текст или файлы 1-в-1
        await message.copy_to(chat_id=target_chat_id)
        await message.answer(f"✅ Повідомлення успішно надіслано користувачу <code>{target_chat_id}</code>!", parse_mode="HTML")
        
    except Exception as e:
        await message.answer(
            f"❌ Не вдалося надіслати повідомлення.\n"
            f"Можливо, користувач заблокував бота або ID вказано невірно.\n\n"
            f"Деталі помилки: {str(e)}"
        )