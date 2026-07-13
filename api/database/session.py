import os
from supabase import create_client, Client

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_KEY")

# Глобальна змінна для лінивої ініціалізації клієнта
supabase: Client = None

# Функція створення або отримання існуючого клієнта БД
def get_supabase() -> Client:
    global supabase
    if not supabase:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_KEY")
        if not url or not key:
            raise ValueError("SUPABASE_URL and SUPABASE_KEY (or SUPABASE_SERVICE_KEY) environment variables are required")
        supabase = create_client(url, key)
    return supabase