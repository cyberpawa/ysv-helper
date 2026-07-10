import os
from aiogram import Bot, Dispatcher, types
from aiogram.filters import CommandStart

BOT_TOKEN = os.getenv("BOT_TOKEN") or os.getenv("TELEGRAM_BOT_TOKEN")
bot = Bot(token=BOT_TOKEN) if BOT_TOKEN else None
dp = Dispatcher()

@dp.message(CommandStart())
async def cmd_start(message: types.Message):
    await message.answer(
        "Вітаю! Я ваш асистент для оцифрування табелів робочого часу.\n\n"
        "Вся робота, архів та сканування проходять у Mini App. "
        "Будь ласка, скористайтеся кнопкою меню внизу екрана для входу."
    )
