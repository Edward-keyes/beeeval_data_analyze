
import asyncio
from api.services.supabase_client import supabase
from api.core.logger import logger

async def verify_score_insert():
    try:
        print("Testing insert with score 10.0...")
        
        # 1. Create a dummy task
        task_data = {
            "folder_path": "/tmp/test",
            "status": "processing",
            "total_videos": 1,
            "completed_videos": 0
        }
        task_res = supabase.table("analysis_tasks").insert(task_data).execute()
        task_id = task_res.data[0]['id']
        print(f"Created dummy task: {task_id}")
        
        # 2. Create a dummy video result
        video_data = {
            "task_id": task_id,
            "video_name": "test_score_overflow.mp4",
            "transcript": "test",
            "metadata": {"status": "processing"}
        }
        vid_res = supabase.table("video_results").insert(video_data).execute()
        video_id = vid_res.data[0]['id']
        print(f"Created dummy video result: {video_id}")
        
        # 3. Insert score of 10.0
        score_entry = {
            "video_result_id": video_id,
            "criteria": "Test Criteria",
            "score": 10.0,
            "feedback": "Perfect score"
        }
        
        print("Attempting to insert score 10.0...")
        score_res = supabase.table("evaluation_scores").insert(score_entry).execute()
        
        if score_res.data:
            print("SUCCESS: Score 10.0 inserted successfully!")
            print(score_res.data)
        else:
            print("FAILED: No data returned.")
            
        # Cleanup
        print("Cleaning up...")
        supabase.table("evaluation_scores").delete().eq("video_result_id", video_id).execute()
        supabase.table("video_results").delete().eq("id", video_id).execute()
        supabase.table("analysis_tasks").delete().eq("id", task_id).execute()
        print("Cleanup complete.")
        
    except Exception as e:
        print(f"ERROR: {e}")

if __name__ == "__main__":
    asyncio.run(verify_score_insert())
