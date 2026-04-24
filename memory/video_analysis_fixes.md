# Video Analysis API Fixes

## Date: 2026-03-12

### Overview
Fixed the `/api/video/analyze` endpoint to complete the full video analysis flow: upload → transcribe → LLM evaluation → save results.

### Issues Fixed

#### 1. moviepy 2.x API Changes
**File:** `api/services/video_service.py`
- Changed import from `from moviepy.editor import VideoFileClip` to `from moviepy import VideoFileClip`
- Removed `verbose` parameter from `write_audiofile()` call

#### 2. Missing ffmpeg-python Package
**Solution:** Installed `ffmpeg-python` package for audio conversion

#### 3. evaluation_scores Table ID Auto-generation
**File:** `api/services/local_db_client.py`
- Fixed auto ID generation logic to only generate UUIDs for `analysis_tasks` and `video_results` tables
- `evaluation_scores` table now correctly uses SQLite `AUTOINCREMENT` integer ID

#### 4. Missing completed_at Column
**File:** Database schema
- Added `completed_at TIMESTAMP` column to `analysis_tasks` table

#### 5. video_result_id Query Failure (Chinese Encoding)
**File:** `api/routers/video.py`
- Modified query logic to first query by `task_id`, then match `video_name` in Python
- This avoids SQLite WHERE clause issues with Chinese character encoding

#### 6. SQLite Embedded Resource Query Not Supported
**File:** `api/routers/video.py`
- Modified `/api/video/results/{task_id}` endpoint to fetch `video_results` and `evaluation_scores` separately
- SQLite doesn't support Supabase-style embedded resource queries like `evaluation_scores(*)`

### Files Modified

| File | Changes |
|------|---------|
| `api/services/video_service.py` | moviepy import, removed verbose param |
| `api/services/local_db_client.py` | Fixed UUID auto-generation logic |
| `api/routers/video.py` | Fixed video_result_id query, fixed results endpoint |

### Dependencies Installed
```
loguru
moviepy (2.x)
pydantic_settings
python-multipart
diskcache
google-generativeai
ffmpeg-python
```

### Database Migration
```sql
ALTER TABLE analysis_tasks ADD COLUMN completed_at TIMESTAMP;
```

### Test Result
Successfully tested with video file `C:\测试视频\福特.mp4`:
- Transcription works (Moonshine ASR)
- LLM evaluation completes
- All 4 evaluation scores saved correctly
- Task status updates to "completed"
