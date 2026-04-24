# Changelog

All notable changes to the BeeEVAL project will be documented in this file.

## [2026-03-12] - Video Analysis API Bug Fixes

### Fixed

#### API Endpoint Fixes
- **`/api/video/analyze`** - Fixed complete video analysis flow (upload → transcribe → LLM evaluation → save results)
- **`/api/video/results/{task_id}`** - Fixed SQLite embedded resource query issue

#### Core Issues
1. **moviepy 2.x Compatibility** (`api/services/video_service.py`)
   - Updated import: `from moviepy import VideoFileClip` (was `moviepy.editor`)
   - Removed deprecated `verbose` parameter from `write_audiofile()`

2. **Database ID Generation** (`api/services/local_db_client.py`)
   - Fixed UUID auto-generation to only apply to `analysis_tasks` and `video_results` tables
   - `evaluation_scores` table now correctly uses SQLite `AUTOINCREMENT`

3. **Video Result ID Query** (`api/routers/video.py`)
   - Fixed Chinese character encoding issue in WHERE clause
   - Changed to query by `task_id` first, then match `video_name` in Python

4. **Database Schema**
   - Added `completed_at TIMESTAMP` column to `analysis_tasks` table

5. **SQLite Query Compatibility**
   - Replaced embedded resource query `evaluation_scores(*)` with separate queries
   - SQLite doesn't support Supabase-style nested resource queries

### Dependencies Added
```bash
pip install loguru moviepy pydantic_settings python-multipart diskcache google-generativeai ffmpeg-python
```

### Database Migration
```sql
ALTER TABLE analysis_tasks ADD COLUMN completed_at TIMESTAMP;
```

### Testing
Successfully tested end-to-end video analysis with `C:\测试视频\福特.mp4`:
- ✅ Audio extraction
- ✅ Moonshine ASR transcription (Chinese language)
- ✅ Smart frame detection
- ✅ LLM evaluation
- ✅ Evaluation scores saved (4 criteria)
- ✅ Task completion status

### Files Changed
- `api/services/video_service.py` - moviepy 2.x compatibility
- `api/services/local_db_client.py` - ID generation fix
- `api/routers/video.py` - Query fixes

---

## [Previous Versions]

_No changelog entries recorded._
