import os
import ssl
import httpx

# Aggressive Monkey-patch to disable SSL verification in httpx
original_client_init = httpx.Client.__init__

def new_client_init(self, *args, **kwargs):
    print(f"Intercepted httpx.Client.__init__! verify was: {kwargs.get('verify')}")
    kwargs['verify'] = False
    print(f"Forced verify=False")
    original_client_init(self, *args, **kwargs)

httpx.Client.__init__ = new_client_init


from dotenv import load_dotenv
from supabase import create_client

load_dotenv("api/.env")

url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_KEY")

print(f"URL: {url}")

# Removed try-except to see traceback
supabase = create_client(url, key)
print("Client created.")

# Test connection by listing tables or selecting from a known table
print("Testing 'analysis_tasks' insert...")

task_data = {
    "folder_path": "/test/path",
    "status": "processing",
    "total_videos": 1,
    "completed_videos": 0
}

res = supabase.table("analysis_tasks").insert(task_data).execute()
print("Insert successful!")
print(res.data)

task_id = res.data[0]['id']
print(f"Created task ID: {task_id}")

# Clean up
supabase.table("analysis_tasks").delete().eq("id", task_id).execute()
print("Cleanup successful.")
