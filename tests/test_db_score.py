
import pytest
from api.services.supabase_client import supabase
import uuid

def test_score_overflow_fix():
    """
    Integration test to verify that we can insert a score of 10.0
    into the evaluation_scores table without overflow error.
    """
    # 1. Create a dummy task
    task_data = {
        "folder_path": "/tmp/test_integration",
        "status": "processing",
        "total_videos": 1,
        "completed_videos": 0
    }
    task_res = supabase.table("analysis_tasks").insert(task_data).execute()
    assert task_res.data, "Failed to create task"
    task_id = task_res.data[0]['id']
    
    try:
        # 2. Create a dummy video result
        video_data = {
            "task_id": task_id,
            "video_name": "integration_test_score.mp4",
            "transcript": "test",
            "metadata": {"status": "processing"}
        }
        vid_res = supabase.table("video_results").insert(video_data).execute()
        assert vid_res.data, "Failed to create video result"
        video_id = vid_res.data[0]['id']
        
        # 3. Insert score of 10.0
        score_entry = {
            "video_result_id": video_id,
            "criteria": "Test Criteria",
            "score": 10.0,
            "feedback": "Perfect score"
        }
        
        score_res = supabase.table("evaluation_scores").insert(score_entry).execute()
        assert score_res.data, "Failed to insert score 10.0"
        assert score_res.data[0]['score'] == 10.0
        
    finally:
        # Cleanup
        if 'video_id' in locals():
            supabase.table("evaluation_scores").delete().eq("video_result_id", video_id).execute()
            supabase.table("video_results").delete().eq("id", video_id).execute()
        if 'task_id' in locals():
            supabase.table("analysis_tasks").delete().eq("id", task_id).execute()
