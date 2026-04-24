import os
import json
import uuid
import asyncio
from typing import Optional, Dict
from fastapi import APIRouter, HTTPException, BackgroundTasks, Request
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
import mimetypes
from concurrent.futures import ThreadPoolExecutor

from api.services.video_service import video_service, ASRModel, VideoService
from api.services.llm_service import llm_service
from api.services.supabase_client import supabase
from api.services.nas_service import nas_service
from api.services.redis_service import get_progress, get_all_progress_for_task, delete_progress as redis_delete_progress
from api.core.logger import logger
from api.core.video_name_parser import parse_video_name

# In-memory progress cache (fallback when Redis unavailable)
_progress_cache: Dict[str, Dict] = {}

# ThreadPoolExecutor fallback when Celery is not running
executor = ThreadPoolExecutor(max_workers=3)

# USE_CELERY is opt-in via .env / settings. Default = False (use ThreadPoolExecutor).
from api.core.config import settings as _settings
_USE_CELERY = _settings.USE_CELERY
celery_analyze_video = None
if _USE_CELERY:
    try:
        from api.tasks.video_tasks import analyze_video as celery_analyze_video
        logger.info("USE_CELERY=true, dispatching to Celery task queue.")
    except Exception as e:
        _USE_CELERY = False
        logger.warning(f"USE_CELERY=true but import failed ({e}), falling back to ThreadPoolExecutor.")
else:
    logger.info("Using ThreadPoolExecutor for video analysis (set USE_CELERY=true to switch to Celery).")


def run_async_in_thread(coro):
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _on_task_done(future, video_name=""):
    """Log any exception from a background thread task."""
    try:
        exc = future.exception()
        if exc:
            logger.error(f"[DISPATCH] Background task FAILED for {video_name}: {exc}")
    except Exception:
        pass


def dispatch_video_task(task_id, video_result_id, video_path, video_name, config, asr_model, source="local"):
    """Route task to Celery (if available) or ThreadPoolExecutor."""
    logger.info(f"[DISPATCH] Submitting {video_name} (source={source}, celery={_USE_CELERY}, path={video_path[:80]})")
    if _USE_CELERY:
        celery_analyze_video.delay(task_id, video_result_id, video_path, video_name, config, asr_model, source)
    else:
        future = executor.submit(
            run_async_in_thread,
            process_video(task_id, video_result_id, video_path, video_name, config, asr_model, source)
        )
        future.add_done_callback(lambda f: _on_task_done(f, video_name))


router = APIRouter(prefix="/api/video", tags=["video"])

class FolderRequest(BaseModel):
    folder_path: str

class AnalyzeRequest(BaseModel):
    folder_path: str
    video_names: list[str]
    analysis_config: Optional[dict] = None
    asr_model: Optional[str] = "whisper"


class NasAnalyzeRequest(BaseModel):
    nas_paths: list[str]
    analysis_config: Optional[dict] = None
    asr_model: Optional[str] = "whisper"

async def process_video(task_id: str, video_result_id: str, video_path: str, video_name: str, config: dict, asr_model: str = "whisper", source: str = "local"):
    """
    处理单个视频：ASR 转录 → 截图 → LLM 评估 → 保存结果。
    source = "local": 直接用本地路径
    source = "nas":   先下载到临时目录 → 分析 → 清理临时文件
    """
    nas_temp_path = None

    def update_progress(phase: str, progress: int):
        try:
            logger.info(f"[PROGRESS] {video_name}: {phase} ({progress}%)")
            progress_data = {
                "status": "processing",
                "progress": progress,
                "current_phase": phase,
                "path": video_path
            }
            _progress_cache[video_result_id] = progress_data
            from api.services.redis_service import set_progress
            set_progress(video_result_id, progress_data)
        except Exception as e:
            logger.error(f"Error updating progress: {e}")

    try:
        # Create per-request video service with selected ASR model
        try:
            selected_asr = ASRModel(asr_model.lower())
        except ValueError:
            logger.warning(f"Invalid ASR model '{asr_model}', defaulting to FUNASR")
            selected_asr = ASRModel.FUNASR

        per_request_video_service = VideoService(asr_model=selected_asr)

        logger.info(f"Starting processing for {video_name} with {asr_model.upper()} ASR (source={source})")
        update_progress("Initializing Analysis", 5)

        actual_path = video_path
        if source == "nas":
            update_progress("Downloading from NAS", 5)
            nas_temp_path = await nas_service.download_to_temp(video_path)
            actual_path = nas_temp_path
            logger.info(f"NAS video downloaded to: {actual_path}")
            update_progress("NAS Download Complete", 8)

        # 1. Extract Audio
        logger.debug(f"Extracting audio for {video_name}")
        update_progress("Extracting Audio from Video", 10)
        audio_path = per_request_video_service.extract_audio(actual_path)
        logger.debug(f"Audio extracted to {audio_path}")
        update_progress("Audio Extraction Complete", 20)

        # 2. Transcribe
        logger.debug(f"Starting transcription with {asr_model.upper()}")
        update_progress(f"Transcribing Audio ({asr_model.upper()} ASR)", 30)
        transcript_data = per_request_video_service.transcribe_audio(audio_path)
        transcript_text = transcript_data["text"]
        logger.debug(f"Transcription complete. Length: {len(transcript_text)}")
        logger.debug(f"Transcript snippet: {transcript_text[:100]}...")
        update_progress("Transcription Complete", 45)

        if not transcript_text.strip():
            logger.warning("Transcript is empty!")
            # Provide a placeholder to LLM
            transcript_data = {"segments": [], "text": "(Video had audio track but no speech was detected by Moonshine ASR)"}
            transcript_text = "(Video had audio track but no speech was detected by Moonshine ASR)"

        # 3. Capture Screenshot (Now with smart detection)
        screenshot_path = ""
        screenshot_abs_path = ""
        try:
             update_progress("Capturing System Screenshot", 50)
             rel_path = per_request_video_service.capture_frame(actual_path, transcript_data=transcript_data)
             screenshot_path = rel_path

             if rel_path:
                 project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
                 screenshot_abs_path = os.path.join(project_root, "public", rel_path.lstrip('/'))
                 logger.debug(f"Screenshot captured at {screenshot_abs_path}")
                 update_progress("Screenshot Captured", 55)

        except Exception as e:
             logger.error(f"Error capturing screenshot: {e}")
             pass

        update_progress("Sending to LLM for AI Analysis", 60)

        # 4. LLM Evaluation
        logger.debug(f"Starting LLM evaluation")
        criteria = config.get("evaluation_criteria", ["accuracy", "response_time", "user_experience"])
        # Pass screenshot path if available
        evaluation_json = await llm_service.evaluate_video(transcript_data, criteria, image_path=screenshot_abs_path)
        logger.debug(f"LLM Response raw: {evaluation_json}")

        # Check if LLM returned an error (retry exhausted)
        evaluation_data = None
        llm_error = None

        try:
            # Clean markdown code blocks from LLM response (e.g., ```json ... ```)
            cleaned_json = evaluation_json.strip()
            if cleaned_json.startswith("```json"):
                cleaned_json = cleaned_json[7:]
            elif cleaned_json.startswith("```"):
                cleaned_json = cleaned_json[3:]
            if cleaned_json.endswith("```"):
                cleaned_json = cleaned_json[:-3]
            cleaned_json = cleaned_json.strip()

            eval_parsed = json.loads(cleaned_json)
            if isinstance(eval_parsed, dict) and "error" in eval_parsed:
                llm_error = eval_parsed.get("error_message", eval_parsed.get("error", "Unknown LLM error"))
                logger.warning(f"LLM service returned error: {llm_error}")
            else:
                evaluation_data = eval_parsed
        except json.JSONDecodeError as e:
            llm_error = f"Failed to parse LLM response: {e}"
            logger.error(f"LLM returned invalid JSON: {evaluation_json[:500]}...")

        if llm_error:
            # LLM failed - save error info and mark as failed
            logger.error(f"LLM analysis failed: {llm_error}")
            update_progress("LLM Analysis Failed", 60)

            error_metadata = {
                "path": video_path,
                "status": "failed",
                "error": f"LLM service unavailable: {llm_error}",
                "progress": 60,
                "current_phase": "LLM Analysis Failed"
            }

            supabase.table("video_results").update({
                "transcript": transcript_text,
                "metadata": error_metadata
            }).eq("id", video_result_id).execute()

            # Update task to reflect failure
            try:
                current_task = supabase.table("analysis_tasks").select("completed_videos, total_videos").eq("id", task_id).execute().data[0]
                task_update = {}
                if current_task['completed_videos'] >= current_task['total_videos'] - 1:
                    task_update["status"] = "completed"
                    task_update["completed_at"] = "now()"
                supabase.table("analysis_tasks").update(task_update).eq("id", task_id).execute()
            except:
                pass
            return  # Exit early, don't continue with empty results
        update_progress("LLM Analysis Complete", 80)

        # Handle potential empty or invalid JSON
        if not evaluation_json or evaluation_json.strip() == "{}":
             logger.error("LLM returned empty response")
             raise Exception("LLM analysis failed to produce results")

        # Clean markdown code blocks if present
        if "```json" in evaluation_json:
            evaluation_json = evaluation_json.split("```json")[1].split("```")[0].strip()
        elif "```" in evaluation_json:
            evaluation_json = evaluation_json.split("```")[1].split("```")[0].strip()

        evaluation_data = json.loads(evaluation_json)

        # Handle new multi-case format: {"cases": [...]}
        if isinstance(evaluation_data, dict) and "cases" in evaluation_data:
            cases = evaluation_data.get("cases", [])
            if cases:
                # Use first case for top-level metadata (backward compatibility)
                first_case = cases[0]
                evaluation_data["user_question"] = first_case.get("user_question", "")
                evaluation_data["system_response"] = first_case.get("system_response", "")
                evaluation_data["response_quality_score"] = first_case.get("response_quality_score", 0)
                evaluation_data["latency_ms"] = first_case.get("latency_ms", 0)
                evaluation_data["summary"] = first_case.get("summary", "")
                evaluation_data["ui_ux_feedback"] = first_case.get("ui_ux_feedback", "")
                # Collect all matched_metrics from all cases
                all_metrics = []
                for case in cases:
                    for metric in case.get("matched_metrics", []):
                        all_metrics.append({
                            "criteria": metric.get("metric_name", ""),
                            "metric_code": metric.get("metric_code", ""),
                            "category": metric.get("category", ""),
                            "score": metric.get("score", 0),
                            "feedback": metric.get("feedback", ""),
                            "selection_reason": metric.get("selection_reason", ""),
                            "case_index": all_metrics.count({"criteria": metric.get("metric_name", "")}) // len(cases) if cases else 0
                        })
                evaluation_data["evaluations"] = all_metrics
                logger.info(f"Processed {len(cases)} cases with {len(all_metrics)} total metrics")
            else:
                logger.warning("LLM returned empty cases array")
                evaluation_data = {"user_question": "", "system_response": "", "evaluations": []}
        # Handle old single-case format (backward compatibility)
        elif isinstance(evaluation_data, dict) and "user_question" in evaluation_data:
            logger.info("LLM returned single-case format (backward compatible)")
            if "evaluations" not in evaluation_data:
                evaluation_data["evaluations"] = []
        # Handle case where LLM returns a list instead of a dict
        elif isinstance(evaluation_data, list):
            logger.warning("LLM returned a JSON list instead of an object. Attempting to recover.")
            if len(evaluation_data) > 0 and isinstance(evaluation_data[0], dict):
                # Check if the first item looks like our result
                if "user_question" in evaluation_data[0] or "evaluations" in evaluation_data[0]:
                     evaluation_data = evaluation_data[0]
                else:
                     # Assume the list IS the evaluations list
                     evaluation_data = {"evaluations": evaluation_data}
            else:
                # Empty list or list of non-dicts
                evaluation_data = {}
        else:
            logger.warning("LLM returned unexpected format, using empty default")
            evaluation_data = {"user_question": "", "system_response": "", "evaluations": []}

        update_progress("Saving Results to Database", 90)

        # 4. Save Results to Supabase
        # Update video_result entry with final data
        final_metadata = {
            "path": video_path,
            "status": "completed",
            "progress": 100,
            "current_phase": "Completed",
            "user_question": evaluation_data.get("user_question", ""),
            "system_response": evaluation_data.get("system_response", ""),
            "response_quality_score": evaluation_data.get("response_quality_score", 0),
            "latency_ms": evaluation_data.get("latency_ms", 0),
            "summary": evaluation_data.get("summary", ""),
            "screenshot_path": screenshot_path,
            # Save full LLM evaluation data
            "cases": evaluation_data.get("cases", []),
            "evaluations": evaluation_data.get("evaluations", [])
        }
        
        video_result_data = {
            "transcript": transcript_text,
            "metadata": final_metadata,
        }
        
        supabase.table("video_results").update(video_result_data).eq("id", video_result_id).execute()
        
        # Save scores
        evaluations = evaluation_data.get("evaluations", [])
        score_entries = []
        for eval_item in evaluations:
            score_entry = {
                "result_id": video_result_id,
                "criteria": eval_item.get("criteria"),
                "score": eval_item.get("score"),
                "feedback": eval_item.get("feedback")
            }
            # Add new fields for multi-case support (if present)
            if "metric_code" in eval_item:
                score_entry["metric_code"] = eval_item.get("metric_code")
            if "category" in eval_item:
                score_entry["category"] = eval_item.get("category")
            if "selection_reason" in eval_item:
                score_entry["selection_reason"] = eval_item.get("selection_reason")
            score_entries.append(score_entry)

        if score_entries:
            supabase.table("evaluation_scores").insert(score_entries).execute()
            
        logger.info(f"Completed processing for {video_name}")
        
        # Update task progress
        current_task = supabase.table("analysis_tasks").select("completed_videos, total_videos").eq("id", task_id).execute().data[0]
        new_completed = current_task['completed_videos'] + 1
        
        task_update = {"completed_videos": new_completed}
        if new_completed >= current_task['total_videos']:
            task_update["status"] = "completed"
            task_update["completed_at"] = "now()"
            
        supabase.table("analysis_tasks").update(task_update).eq("id", task_id).execute()

        _progress_cache.pop(video_result_id, None)
        redis_delete_progress(video_result_id)

    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        logger.error(f"Error processing video {video_name}: {e}\n{error_trace}")

        supabase.table("video_results").update({
            "metadata": {
                "path": video_path,
                "status": "failed",
                "error": str(e),
                "progress": 100,
                "current_phase": "Failed"
            }
        }).eq("id", video_result_id).execute()

        try:
            current_task = supabase.table("analysis_tasks").select("completed_videos, total_videos").eq("id", task_id).execute().data[0]
            task_update = {}
            if current_task['completed_videos'] >= current_task['total_videos'] - 1:
                task_update["status"] = "completed"
                task_update["completed_at"] = "now()"
            supabase.table("analysis_tasks").update(task_update).eq("id", task_id).execute()
        except:
            pass

        _progress_cache.pop(video_result_id, None)
        redis_delete_progress(video_result_id)
    finally:
        if nas_temp_path:
            await nas_service.cleanup_temp(nas_temp_path)

@router.post("/list")
async def list_videos(request: FolderRequest):
    if not os.path.exists(request.folder_path):
        raise HTTPException(status_code=404, detail="Folder not found")
    
    video_extensions = {".mp4", ".mov", ".avi", ".mkv"}
    videos = []
    
    try:
        for f in os.listdir(request.folder_path):
            if os.path.isfile(os.path.join(request.folder_path, f)):
                ext = os.path.splitext(f)[1].lower()
                if ext in video_extensions:
                    # Get file stats
                    stats = os.stat(os.path.join(request.folder_path, f))
                    videos.append({
                        "name": f,
                        "size": stats.st_size,
                        "path": os.path.join(request.folder_path, f)
                    })
        return {"videos": videos}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/analyze")
async def analyze_videos(request: AnalyzeRequest, background_tasks: BackgroundTasks):
    # Create an Analysis Task record
    try:
        import uuid
        task_id = str(uuid.uuid4())  # Generate UUID for task_id
        task_data = {
            "id": task_id,  # Explicitly set the id
            "folder_path": request.folder_path,
            "status": "processing",
            "total_videos": len(request.video_names),
            "completed_videos": 0
        }

        logger.info(f"Creating analysis task with id: {task_id}")
        res = supabase.table("analysis_tasks").insert(task_data).execute()
        logger.info(f"Task created. Response data: {res.data}")

        # Verify task_id is valid
        if not res.data or not res.data[0] or 'id' not in res.data[0] or not res.data[0]['id']:
            logger.error(f"Task creation failed or returned null id. Response: {res.data}")
            raise Exception("Failed to create analysis task")

        task_id = res.data[0]['id']
        logger.info(f"Confirmed task_id: {task_id}")

        # Create initial video_result entries first (sync) so frontend sees them immediately
        for video_name in request.video_names:
            video_path = os.path.join(request.folder_path, video_name)

            # 解析视频名称，提取结构化信息
            video_info = parse_video_name(video_name)

            initial_metadata = {
                "path": video_path,
                "status": "pending",
                "progress": 0,
                "current_phase": "Queued"
            }
            video_result_data = {
                "task_id": task_id,
                "video_name": video_name,
                "transcript": "",
                "metadata": initial_metadata,
                "case_id": video_info.get("case_id"),
                "brand_model": video_info.get("brand_model"),
                "system_version": video_info.get("system_version"),
                "function_domain": video_info.get("function_domain"),
                "scenario": video_info.get("scenario"),
                "sequence": video_info.get("sequence"),
                "created_at": "now()"
            }
            logger.info(f"Inserting video_result: task_id={task_id}, video_name={video_name}, case_id={video_info.get('case_id')}")
            res_vid = supabase.table("video_results").insert(video_result_data).execute()
            logger.info(f"Video result inserted")

        # Enqueue background tasks
        for video_name in request.video_names:
            video_path = os.path.join(request.folder_path, video_name)

            # Fetch the ID we just created - query by task_id only first to debug
            logger.debug(f"Querying video_results: task_id={task_id}, video_name={video_name}")
            res_vid = supabase.table("video_results").select("id, video_name").eq("task_id", task_id).execute()
            logger.debug(f"Query result: data={res_vid.data}")

            # Find matching record by video_name (in case of encoding issues)
            video_result_id = None
            if res_vid.data:
                for record in res_vid.data:
                    if record.get('video_name') == video_name:
                        video_result_id = record['id']
                        break
                # Fallback to first record if no exact match
                if video_result_id is None:
                    logger.warning(f"No exact match for video_name '{video_name}', using first record")
                    video_result_id = res_vid.data[0]['id']

            if video_result_id is None:
                logger.error(f"Failed to fetch video_result_id for {video_name}")
                continue

            logger.info(f"Found video_result_id={video_result_id} for {video_name}")

            dispatch_video_task(task_id, video_result_id, video_path, video_name, request.analysis_config or {}, request.asr_model or "whisper")

        return {"task_id": task_id, "status": "processing", "message": "Analysis started"}
        
    except Exception as e:
        import traceback
        logger.error(f"Error starting analysis: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/analyze-nas")
async def analyze_nas_videos(request: NasAnalyzeRequest, background_tasks: BackgroundTasks):
    """从 NAS 分析视频：下载 → ASR → LLM → 保存结果 → 清理临时文件"""
    if not nas_service.available:
        raise HTTPException(status_code=503, detail="NAS service not configured")
    try:
        task_id = str(uuid.uuid4())
        folder_display = os.path.dirname(request.nas_paths[0]) if request.nas_paths else "NAS"
        task_data = {
            "id": task_id,
            "folder_path": f"[NAS] {folder_display}",
            "status": "processing",
            "total_videos": len(request.nas_paths),
            "completed_videos": 0,
        }
        logger.info(f"Creating NAS analysis task: {task_id}")
        res = supabase.table("analysis_tasks").insert(task_data).execute()
        task_id = res.data[0]["id"]

        for nas_path in request.nas_paths:
            video_name = os.path.basename(nas_path)
            video_info = parse_video_name(video_name)

            initial_metadata = {
                "path": nas_path,
                "status": "pending",
                "progress": 0,
                "current_phase": "Queued",
                "video_source": "nas",
            }
            video_result_data = {
                "task_id": task_id,
                "video_name": video_name,
                "transcript": "",
                "metadata": initial_metadata,
                "case_id": video_info.get("case_id"),
                "brand_model": video_info.get("brand_model"),
                "system_version": video_info.get("system_version"),
                "function_domain": video_info.get("function_domain"),
                "scenario": video_info.get("scenario"),
                "sequence": video_info.get("sequence"),
                "created_at": "now()",
            }
            supabase.table("video_results").insert(video_result_data).execute()

        for nas_path in request.nas_paths:
            video_name = os.path.basename(nas_path)
            res_vid = supabase.table("video_results").select("id, video_name").eq("task_id", task_id).execute()
            video_result_id = None
            if res_vid.data:
                for record in res_vid.data:
                    if record.get("video_name") == video_name:
                        video_result_id = record["id"]
                        break
            if video_result_id is None:
                logger.error(f"Failed to fetch video_result_id for NAS video {video_name}")
                continue

            dispatch_video_task(task_id, video_result_id, nas_path, video_name, request.analysis_config or {}, request.asr_model or "whisper", source="nas")

        return {"task_id": task_id, "status": "processing", "message": f"NAS analysis started for {len(request.nas_paths)} videos"}

    except Exception as e:
        import traceback
        logger.error(f"Error starting NAS analysis: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/status/{task_id}")
async def get_analysis_status(task_id: str):
    try:
        # Fetch task status
        task_res = supabase.table("analysis_tasks").select("status, completed_videos, total_videos").eq("id", task_id).execute()
        if not task_res.data:
            raise HTTPException(status_code=404, detail="Task not found")

        task = task_res.data[0]

        videos_res = supabase.table("video_results").select("id, video_name, metadata").eq("task_id", task_id).execute()

        video_ids = [v.get("id") for v in videos_res.data if v.get("id")]
        redis_progress = get_all_progress_for_task(video_ids)

        videos = []
        for v in videos_res.data:
            video_data = dict(v)
            video_id = video_data.get('id')
            if video_id and video_id in redis_progress:
                video_data['metadata'] = redis_progress[video_id]
            elif video_id and video_id in _progress_cache:
                video_data['metadata'] = _progress_cache[video_id]
            videos.append(video_data)

        return {
            "task": task,
            "videos": videos
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/results/{task_id}")
async def get_results(task_id: str, offset: int = 0, limit: int = 20, status: Optional[str] = None):
    try:
        task_res = supabase.table("analysis_tasks").select("*").eq("id", task_id).execute()
        if not task_res.data:
            raise HTTPException(status_code=404, detail="Task not found")

        task = task_res.data[0]

        status_filter = ""
        params_count = [task_id]
        params_query = [task_id]

        if status:
            if status == "pending":
                status_filter = " AND vr.metadata->>'status' IN ('pending', 'queued')"
            else:
                status_filter = " AND vr.metadata->>'status' = %s"
                params_count = [task_id, status]
                params_query = [task_id, status]

        count_sql = f"SELECT COUNT(*) FROM video_results vr WHERE vr.task_id = %s{status_filter}"
        total = supabase.raw_sql_count(count_sql, params_count)

        # Also count failed videos for the retry button
        failed_count = supabase.raw_sql_count(
            "SELECT COUNT(*) FROM video_results vr WHERE vr.task_id = %s AND vr.metadata->>'status' = 'failed'",
            [task_id]
        )

        results_sql = f"""
            SELECT vr.*,
                   COALESCE(
                       json_agg(
                           json_build_object(
                               'id', es.id, 'result_id', es.result_id,
                               'criteria', es.criteria, 'score', es.score,
                               'feedback', es.feedback, 'details', es.details,
                               'metric_code', es.metric_code, 'category', es.category,
                               'selection_reason', es.selection_reason
                           )
                       ) FILTER (WHERE es.id IS NOT NULL),
                       '[]'::json
                   ) AS evaluation_scores
            FROM video_results vr
            LEFT JOIN evaluation_scores es ON es.result_id = vr.id
            WHERE vr.task_id = %s{status_filter}
            GROUP BY vr.id
            ORDER BY vr.created_at ASC
            LIMIT %s OFFSET %s
        """
        params_query.extend([limit, offset])
        res = supabase.raw_sql(results_sql, params_query)

        result_ids = [r.get("id") for r in res.data if r.get("id")]
        redis_prog = get_all_progress_for_task(result_ids)
        results = []
        for row in res.data:
            vid = row.get("id")
            if vid and vid in redis_prog:
                row = dict(row)
                row["metadata"] = redis_prog[vid]
            elif vid and vid in _progress_cache:
                row = dict(row)
                row["metadata"] = _progress_cache[vid]
            results.append(row)

        stuck_count = supabase.raw_sql_count(
            "SELECT COUNT(*) FROM video_results vr WHERE vr.task_id = %s AND vr.metadata->>'status' IN ('pending', 'processing', 'queued')",
            [task_id]
        )

        return {
            "task": task,
            "results": results,
            "total": total,
            "failed_count": failed_count,
            "stuck_count": stuck_count,
            "offset": offset,
            "limit": limit,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/force-complete/{task_id}")
async def force_complete_task(task_id: str):
    """
    Force-stop a task:
    - Purge pending Celery video_analysis queue (so backlog won't keep firing)
    - Mark any pending/processing/queued videos as 'failed' (cancelled)
    - Mark the task itself as 'completed'
    Use this when NAS is down, backlog is huge, or failures prevent natural completion.
    """
    try:
        task_res = supabase.table("analysis_tasks").select("*").eq("id", task_id).execute()
        if not task_res.data:
            raise HTTPException(status_code=404, detail="Task not found")

        # Try to purge the Celery queue so backlog tasks don't keep running.
        # This drops the ENTIRE video_analysis queue; if you only have this task
        # running (common case), that's exactly what we want.
        purged = 0
        try:
            from api.celery_app import celery_app
            purged = celery_app.control.purge() or 0
            logger.info(f"[FORCE-COMPLETE] Purged {purged} pending Celery tasks")
        except Exception as e:
            logger.warning(f"[FORCE-COMPLETE] Celery purge failed (ignored): {e}")

        supabase.raw_sql(
            """
            UPDATE video_results
            SET metadata = jsonb_set(
                COALESCE(metadata, '{}'::jsonb),
                '{status}', '"failed"'
            ) || '{"error": "Cancelled by user (force-complete)", "progress": 100, "current_phase": "Cancelled"}'::jsonb
            WHERE task_id = %s
              AND metadata->>'status' IN ('pending', 'processing', 'queued')
            """,
            [task_id],
        )

        supabase.table("analysis_tasks").update({
            "status": "completed",
            "completed_at": "now()",
        }).eq("id", task_id).execute()

        return {
            "success": True,
            "message": "Task stopped",
            "celery_purged": purged,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/recover-stuck/{task_id}")
async def recover_stuck_videos(task_id: str, asr_model: str = "whisper"):
    """
    Recover zombie/orphaned videos:
    - 'processing' videos (stuck forever after crash) -> mark failed then re-submit
    - 'pending' videos (never picked up after crash) -> re-submit
    """
    try:
        task_res = supabase.table("analysis_tasks").select("*").eq("id", task_id).execute()
        if not task_res.data:
            raise HTTPException(status_code=404, detail="Task not found")

        stuck_sql = """
            SELECT id, video_name, metadata
            FROM video_results
            WHERE task_id = %s AND (metadata->>'status' = 'pending' OR metadata->>'status' = 'processing')
        """
        stuck_res = supabase.raw_sql(stuck_sql, [task_id])

        if not stuck_res.data:
            return {"recovered": 0, "message": "No stuck videos found"}

        supabase.table("analysis_tasks").update({
            "status": "processing",
            "completed_at": None,
        }).eq("id", task_id).execute()

        recovered = 0
        for video in stuck_res.data:
            video_result_id = video["id"]
            video_name = video["video_name"]
            metadata = video.get("metadata", {})
            video_path = metadata.get("path", "")
            is_nas = metadata.get("video_source") == "nas" or video_path.startswith("/volume")

            # Mark as "queued" immediately to prevent duplicate submissions
            supabase.table("video_results").update({
                "metadata": {
                    "path": video_path,
                    "status": "queued",
                    "progress": 0,
                    "current_phase": "Queued (Recovered)",
                    **({"video_source": "nas"} if is_nas else {}),
                }
            }).eq("id", video_result_id).execute()

            supabase.table("evaluation_scores").delete().eq("result_id", video_result_id).execute()

            source = "nas" if is_nas else "local"
            dispatch_video_task(task_id, video_result_id, video_path, video_name, {}, asr_model, source=source)
            recovered += 1

        return {
            "recovered": recovered,
            "task_id": task_id,
            "message": f"Recovered {recovered} stuck videos (re-submitted for analysis)",
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logger.error(f"Error recovering stuck videos: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/retry-failed/{task_id}")
async def retry_failed_videos(task_id: str, asr_model: str = "whisper"):
    """重新分析指定任务中所有失败的视频"""
    try:
        task_res = supabase.table("analysis_tasks").select("*").eq("id", task_id).execute()
        if not task_res.data:
            raise HTTPException(status_code=404, detail="Task not found")

        failed_sql = """
            SELECT id, video_name, metadata
            FROM video_results
            WHERE task_id = %s AND metadata->>'status' = 'failed'
        """
        failed_res = supabase.raw_sql(failed_sql, [task_id])

        if not failed_res.data:
            return {"retried": 0, "message": "No failed videos to retry"}

        supabase.table("analysis_tasks").update({
            "status": "processing",
            "completed_at": None,
        }).eq("id", task_id).execute()

        retried = 0
        for video in failed_res.data:
            video_result_id = video["id"]
            video_name = video["video_name"]
            metadata = video.get("metadata", {})
            video_path = metadata.get("path", "")
            is_nas = metadata.get("video_source") == "nas" or video_path.startswith("/volume")

            supabase.table("video_results").update({
                "metadata": {
                    "path": video_path,
                    "status": "queued",
                    "progress": 0,
                    "current_phase": "Queued (Retry)",
                    **({"video_source": "nas"} if is_nas else {}),
                }
            }).eq("id", video_result_id).execute()

            supabase.table("evaluation_scores").delete().eq("result_id", video_result_id).execute()

            source = "nas" if is_nas else "local"
            dispatch_video_task(task_id, video_result_id, video_path, video_name, {}, asr_model, source=source)
            retried += 1

        return {
            "retried": retried,
            "task_id": task_id,
            "message": f"Retrying {retried} failed videos",
        }

    except Exception as e:
        import traceback
        logger.error(f"Error retrying failed videos: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/stream")
async def stream_video(path: str):
    """
    Stream video file from local path.
    Security Warning: In production, validate path is within allowed directories.
    For this local tool, we assume paths are safe or user-provided.
    """
    logger.debug(f"Stream requested for path: {path}")
    
    # URL decoding is handled by FastAPI for query params, but double check if path looks encoded
    # If path contains % but os.path doesn't exist, maybe it needs extra decoding?
    # Usually FastAPI handles it.
    
    if not os.path.exists(path):
        logger.error(f"Video file not found at {path}")
        # Try decoding again just in case?
        import urllib.parse
        decoded_path = urllib.parse.unquote(path)
        if os.path.exists(decoded_path):
             logger.debug(f"Found file after manual decoding: {decoded_path}")
             path = decoded_path
        else:
             logger.error(f"Video file also not found at decoded path {decoded_path}")
             raise HTTPException(status_code=404, detail=f"Video file not found: {path}")
        
    # Check if it is a file
    if not os.path.isfile(path):
        raise HTTPException(status_code=400, detail="Path is not a file")

    # Basic range handling could be added here for better seeking support
    # For now, FileResponse handles simple serving well enough for browsers
    # If file is large, we might want StreamingResponse with range support.
    
    # Let's use FileResponse for simplicity as it supports Range requests automatically in Starlette/FastAPI
    mime_type = mimetypes.guess_type(path)[0] or "video/mp4"
    logger.debug(f"Serving video with mime type: {mime_type}")
    return FileResponse(path, media_type=mime_type)

@router.delete("/results/batch")
async def delete_results_batch(request: Request):
    """
    Batch delete video results.
    Expects a JSON body with {"ids": ["id1", "id2", ...]}
    """
    try:
        data = await request.json()
        ids = data.get("ids", [])
        if not ids:
             raise HTTPException(status_code=400, detail="No IDs provided")
             
        # Use Supabase in_ filter
        # "id", "in", (val1, val2) syntax or similar depending on client version
        # Supabase-py / postgrest-py syntax for IN is usually .in_("col", [vals])
        
        logger.info(f"Batch deleting results: {ids}")
        res = supabase.table("video_results").delete().in_("id", ids).execute()
        
        return {"status": "success", "deleted_count": len(res.data) if res.data else 0}
    except Exception as e:
        logger.error(f"Error batch deleting: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/tasks/batch")
async def delete_tasks_batch(request: Request):
    """
    Batch delete analysis tasks and all related rows (video_results +
    evaluation_scores). Done in one SQL statement using CTE to keep
    the operation atomic and independent of any FK CASCADE setup.
    Expects JSON body: {"ids": ["id1", "id2", ...]}
    """
    try:
        data = await request.json()
        ids = data.get("ids", [])
        if not ids:
            raise HTTPException(status_code=400, detail="No IDs provided")

        logger.info(f"Batch deleting tasks (with children): {ids}")

        # 1) evaluation_scores (grand-children) first
        supabase.raw_sql(
            """
            DELETE FROM evaluation_scores
            WHERE result_id IN (
                SELECT id FROM video_results WHERE task_id = ANY(%s)
            )
            """,
            [ids],
        )

        # 2) video_results (children)
        supabase.raw_sql(
            "DELETE FROM video_results WHERE task_id = ANY(%s)",
            [ids],
        )

        # 3) analysis_tasks (parents)
        res = supabase.raw_sql(
            "DELETE FROM analysis_tasks WHERE id = ANY(%s) RETURNING id",
            [ids],
        )
        deleted = len(res.data) if res.data else 0

        return {"status": "success", "deleted_count": deleted}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error batch deleting tasks: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/tasks")
async def get_tasks(offset: int = 0, limit: int = 20):
    try:
        total = supabase.table("analysis_tasks").count().execute().count
        res = (supabase.table("analysis_tasks")
               .select("*")
               .order("created_at", desc=True)
               .limit(limit)
               .offset(offset)
               .execute())
        return {"data": res.data, "total": total, "offset": offset, "limit": limit}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/asr-models")
async def get_asr_models():
    """Get list of available ASR models."""
    return {
        "models": [
            {"value": "whisper", "label": "Whisper (Medium)", "description": "OpenAI Whisper - Good accuracy, slower"},
            {"value": "moonshine", "label": "Moonshine (Small)", "description": "Fastest, good accuracy balance"},
            {"value": "funasr", "label": "FunASR (Paraformer-large)", "description": "Best Chinese accuracy, fast"}
        ],
        "default": "whisper"
    }

@router.get("/filter-options")
async def get_filter_options():
    """Return distinct values for brand_model, function_domain, system_version used in filters."""
    try:
        sql = """
            SELECT
                COALESCE(array_agg(DISTINCT brand_model) FILTER (WHERE brand_model IS NOT NULL AND brand_model != ''), '{}') AS brand_models,
                COALESCE(array_agg(DISTINCT function_domain) FILTER (WHERE function_domain IS NOT NULL AND function_domain != ''), '{}') AS function_domains,
                COALESCE(array_agg(DISTINCT system_version) FILTER (WHERE system_version IS NOT NULL AND system_version != ''), '{}') AS system_versions
            FROM video_results
        """
        res = supabase.raw_sql(sql, [])
        row = res.data[0] if res.data else {}
        return {
            "brand_models": sorted(row.get("brand_models", [])),
            "function_domains": sorted(row.get("function_domains", [])),
            "system_versions": sorted(row.get("system_versions", [])),
        }
    except Exception as e:
        logger.error(f"Error fetching filter options: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/all-results")
async def get_all_results(
    offset: int = 0,
    limit: int = 20,
    sort_by: str = "created_at",
    sort_order: str = "desc",
    vehicle_id: Optional[str] = None,
    function_domain: Optional[str] = None,
    brand_model: Optional[str] = None,
    system_version: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
):
    try:
        allowed_sort = {"created_at", "video_name", "case_id", "brand_model", "function_domain", "system_version"}
        if sort_by not in allowed_sort:
            sort_by = "created_at"
        direction = "DESC" if sort_order == "desc" else "ASC"

        where_parts = []
        params: list = []

        if vehicle_id:
            where_parts.append("vr.vehicle_id = %s")
            params.append(vehicle_id)
        if function_domain:
            where_parts.append("vr.function_domain = %s")
            params.append(function_domain)
        if brand_model:
            where_parts.append("vr.brand_model = %s")
            params.append(brand_model)
        if system_version:
            where_parts.append("vr.system_version = %s")
            params.append(system_version)
        if status:
            where_parts.append("vr.metadata->>'status' = %s")
            params.append(status)
        if search:
            where_parts.append("(vr.video_name ILIKE %s OR vr.transcript ILIKE %s)")
            params.extend([f"%{search}%", f"%{search}%"])

        where_clause = (" WHERE " + " AND ".join(where_parts)) if where_parts else ""

        count_sql = f"SELECT COUNT(*) FROM video_results vr{where_clause}"
        total = supabase.raw_sql_count(count_sql, params)

        data_sql = f"""
            SELECT vr.*,
                   COALESCE(
                       json_agg(
                           json_build_object(
                               'id', es.id, 'result_id', es.result_id,
                               'criteria', es.criteria, 'score', es.score,
                               'feedback', es.feedback, 'details', es.details,
                               'metric_code', es.metric_code, 'category', es.category,
                               'selection_reason', es.selection_reason
                           )
                       ) FILTER (WHERE es.id IS NOT NULL),
                       '[]'::json
                   ) AS evaluation_scores
            FROM video_results vr
            LEFT JOIN evaluation_scores es ON es.result_id = vr.id
            {where_clause}
            GROUP BY vr.id
            ORDER BY vr.{sort_by} {direction}
            LIMIT %s OFFSET %s
        """
        data_params = params + [limit, offset]
        res = supabase.raw_sql(data_sql, data_params)

        return {"data": res.data, "total": total, "offset": offset, "limit": limit}
    except Exception as e:
        logger.error(f"Error fetching all results: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/result/{result_id}")
async def update_result(result_id: str, request: Request):
    try:
        data = await request.json()
        
        # 1. Fetch current record
        current_res = supabase.table("video_results").select("*").eq("id", result_id).execute()
        if not current_res.data:
            raise HTTPException(status_code=404, detail="Result not found")
        current_record = current_res.data[0]
        
        # 2. Prepare update payload for video_results table
        update_payload = {}
        
        # Top-level fields
        if "video_name" in data:
            update_payload["video_name"] = data["video_name"]
        if "transcript" in data:
            update_payload["transcript"] = data["transcript"]
            
        # Metadata fields
        # We merge incoming metadata with existing metadata
        if "metadata" in data and isinstance(data["metadata"], dict):
            current_meta = current_record.get("metadata") or {}
            # Update current_meta with new values
            for k, v in data["metadata"].items():
                current_meta[k] = v
            update_payload["metadata"] = current_meta

        # 3. Execute update if there are changes
        if update_payload:
            supabase.table("video_results").update(update_payload).eq("id", result_id).execute()
            
        return {"status": "success", "updated_fields": list(update_payload.keys())}
    except Exception as e:
        logger.error(f"Error updating result {result_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/result/{result_id}")
async def delete_result(result_id: str):
    try:
        supabase.table("video_results").delete().eq("id", result_id).execute()
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
