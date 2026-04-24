from api.services.supabase_client import supabase
import json

try:
    # Fetch recent video results
    res = supabase.table("video_results").select("*").order("created_at", desc=True).limit(5).execute()
    
    print("Recent Video Results:")
    for item in res.data:
        print(f"\nID: {item['id']}")
        print(f"Video: {item['video_name']}")
        print(f"Metadata: {json.dumps(item['metadata'], indent=2, ensure_ascii=False)}")
except Exception as e:
    print(f"Error: {e}")
