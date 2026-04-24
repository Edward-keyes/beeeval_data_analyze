"""
One-time migration script: SQLite (beeeval.db) -> local PostgreSQL.

Usage:
    python -m api.scripts.migrate_sqlite_to_pg

Prerequisites:
    1. PostgreSQL is running and the 'beeeval' database exists.
    2. DB_* variables are set in .env (or environment).
    3. The BeeEVAL API has been started at least once so that
       PostgreSQL tables are auto-created by local_db_client.
"""
import json
import os
import sqlite3
import sys

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
load_dotenv(os.path.join(PROJECT_ROOT, ".env"))

SQLITE_PATH = os.path.join(PROJECT_ROOT, "beeeval.db")

PG_DSN = (
    f"host={os.getenv('DB_HOST', 'localhost')} "
    f"port={os.getenv('DB_PORT', '5432')} "
    f"dbname={os.getenv('DB_NAME', 'beeeval')} "
    f"user={os.getenv('DB_USER', 'postgres')} "
    f"password={os.getenv('DB_PASSWORD', '')}"
)

TABLES_ORDERED = ["analysis_tasks", "video_results", "evaluation_scores"]


def sqlite_rows(db_path: str, table: str) -> list[dict]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute(f"SELECT * FROM {table}")
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows


def insert_pg(pg_conn, table: str, rows: list[dict]):
    if not rows:
        print(f"  [skip] {table}: no data")
        return

    cur = pg_conn.cursor()
    for row in rows:
        if table == "video_results" and "metadata" in row and isinstance(row["metadata"], str):
            try:
                row["metadata"] = json.loads(row["metadata"])
            except (json.JSONDecodeError, TypeError):
                pass

        columns = list(row.keys())
        values = []
        for v in row.values():
            if isinstance(v, (dict, list)):
                values.append(psycopg2.extras.Json(v))
            else:
                values.append(v)

        col_names = ", ".join(columns)
        placeholders = ", ".join(["%s"] * len(columns))
        sql = (
            f"INSERT INTO {table} ({col_names}) VALUES ({placeholders}) "
            f"ON CONFLICT (id) DO NOTHING"
        )
        try:
            cur.execute(sql, values)
        except Exception as e:
            print(f"  [warn] {table} row skipped: {e}")
            pg_conn.rollback()
            continue

    pg_conn.commit()
    cur.close()
    print(f"  [done] {table}: {len(rows)} rows migrated")


def main():
    abs_path = os.path.abspath(SQLITE_PATH)
    if not os.path.exists(abs_path):
        print(f"SQLite database not found: {abs_path}")
        print("Nothing to migrate.")
        sys.exit(0)

    print(f"Source : {abs_path}")
    print(f"Target : PostgreSQL @ {os.getenv('DB_HOST', 'localhost')}:{os.getenv('DB_PORT', '5432')}/{os.getenv('DB_NAME', 'beeeval')}")
    print()

    pg_conn = psycopg2.connect(PG_DSN)

    for table in TABLES_ORDERED:
        print(f"Migrating {table}...")
        rows = sqlite_rows(abs_path, table)
        insert_pg(pg_conn, table, rows)

    pg_conn.close()
    print("\nMigration complete.")


if __name__ == "__main__":
    main()
