from supabase import Client, create_client

from api.config import settings

_supabase_client: Client | None = None


def get_supabase() -> Client:
    global _supabase_client
    if _supabase_client is None:
        if not settings.supabase_url or not settings.supabase_key:
            raise ValueError(
                "SUPABASE_URL and SUPABASE_KEY (or SUPABASE_SERVICE_KEY) environment variables are required"
            )
        _supabase_client = create_client(settings.supabase_url, settings.supabase_key)
    return _supabase_client
