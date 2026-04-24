import httpx
import os
from dotenv import load_dotenv

load_dotenv("api/.env")
url = os.environ.get("SUPABASE_URL")
print(f"Testing connection to: {url}")
print(f"httpx version: {httpx.__version__}")

try:
    # Try default verify=True
    print("Attempting GET with verify=True...")
    r = httpx.get(url, verify=True)
    print(f"Status: {r.status_code}")
except Exception as e:
    print(f"Verify=True failed: {e}")

try:
    # Try verify=False
    print("Attempting GET with verify=False...")
    r = httpx.get(url, verify=False)
    print(f"Status: {r.status_code}")
except Exception as e:
    print(f"Verify=False failed: {e}")
