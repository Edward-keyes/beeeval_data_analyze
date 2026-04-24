import psycopg2, os
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))

conn = psycopg2.connect(
    host=os.getenv("DB_HOST", "localhost"),
    port=os.getenv("DB_PORT", "5432"),
    dbname=os.getenv("DB_NAME", "beeeval"),
    user=os.getenv("DB_USER", "postgres"),
    password=os.getenv("DB_PASSWORD", ""),
)
cur = conn.cursor()

cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name")
print("=== All Tables ===")
for r in cur.fetchall():
    print(f"  {r[0]}")

for table in ["vehicles", "test_cases", "video_results"]:
    cur.execute(f"SELECT column_name, data_type FROM information_schema.columns WHERE table_name='{table}' ORDER BY ordinal_position")
    rows = cur.fetchall()
    print(f"\n=== {table} ({len(rows)} columns) ===")
    for col, dtype in rows:
        print(f"  {col:30s} {dtype}")

conn.close()
