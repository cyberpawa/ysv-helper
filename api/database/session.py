import os
from supabase import Client, create_client

_supabase_client: Client | None = None


def get_supabase() -> Client:
    global _supabase_client
    if _supabase_client is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_KEY")
        if not url or not key:
            raise ValueError(
                "SUPABASE_URL and SUPABASE_KEY (or SUPABASE_SERVICE_KEY) environment variables are required"
            )
        _supabase_client = create_client(url, key)
    return _supabase_client
