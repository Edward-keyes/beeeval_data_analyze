"""
Database client entry point.
Re-exports the PostgreSQL-backed Supabase-compatible client so that all
existing `from api.services.supabase_client import supabase` imports
continue to work without changes.
"""
from api.services.local_db_client import supabase

__all__ = ["supabase"]
