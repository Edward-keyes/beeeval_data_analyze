"""
Celery tasks for video analysis.
Runs in a separate worker process, completely isolated from the API server.
"""
import os
import json
import asyncio

from api.celery_app import celery_app
from api.core.logger import logger
from api.services.redis_service import set_progress, delete_progress


def _run_async(coro):
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _coerce_int_score(value, default: int = 0) -> int:
    """把 LLM 输出的分数强制转成 1-5 的整数。

    虽然 prompt 已经明确要求整数，但 LLM 偶尔会偷偷给出 4.5 / "4" / null
    这种值。这里做最后一道兜底：四舍五入 + clamp 到 [1, 5]，0 用作"无分"。
    """
    if value is None:
        return default
    try:
        v = float(value)
    except (TypeError, ValueError):
        return default
    if v <= 0:
        return default
    rounded = int(round(v))
    if rounded < 1:
        return 1
    if rounded > 5:
        return 5
    return rounded


def _check_task_complete_on_failure(task_id: str):
    """
    When a video fails, check if the task as a whole is now finished
    (i.e. all videos are either completed, failed, or in a terminal state).
    If so, mark the task as completed.
    """
    try:
        from api.services.supabase_client import supabase
        total_res = supabase.raw_sql_count(
            "SELECT COUNT(*) FROM video_results WHERE task_id = %s", [task_id]
        )
        terminal_res = supabase.raw_sql_count(
            "SELECT COUNT(*) FROM video_results WHERE task_id = %s "
            "AND metadata->>'status' IN ('completed', 'failed')",
            [task_id],
        )
        if total_res > 0 and terminal_res >= total_res:
            supabase.table("analysis_tasks").update(
                {"status": "completed", "completed_at": "now()"}
            ).eq("id", task_id).execute()
            logger.info(f"[WORKER] Task {task_id} marked completed (with failures).")
    except Exception as e:
        logger.error(f"Error checking task completion: {e}")


@celery_app.task(bind=True, name="api.tasks.video_tasks.analyze_video", max_retries=1, acks_late=True)
def analyze_video(self, task_id: str, video_result_id: str, video_path: str, video_name: str, config: dict, asr_model: str = "whisper", source: str = "local"):
    """
    Celery task wrapper around process_video.
    Runs in worker process with its own event loop.
    Progress is written to Redis instead of in-memory cache.
    """
    from api.services.video_service import ASRModel, VideoService
    from api.services.llm_service import llm_service
    from api.services.supabase_client import supabase
    from api.services.nas_service import nas_service

    nas_temp_path = None

    def update_progress(phase: str, progress: int):
        try:
            logger.info(f"[WORKER] {video_name}: {phase} ({progress}%)")
            set_progress(video_result_id, {
                "status": "processing",
                "progress": progress,
                "current_phase": phase,
                "path": video_path,
            })
        except Exception as e:
            logger.error(f"Error updating progress: {e}")

    async def _process():
        nonlocal nas_temp_path
        try:
            try:
                selected_asr = ASRModel(asr_model.lower())
            except ValueError:
                selected_asr = ASRModel.FUNASR

            per_request_video_service = VideoService(asr_model=selected_asr)
            logger.info(f"[WORKER] Starting {video_name} with {asr_model.upper()} (source={source})")
            update_progress("Initializing Analysis", 5)

            actual_path = video_path
            if source == "nas":
                update_progress("Downloading from NAS", 5)
                nas_temp_path = await nas_service.download_to_temp(video_path)
                actual_path = nas_temp_path
                update_progress("NAS Download Complete", 8)

            update_progress("Extracting Audio from Video", 10)
            audio_path = per_request_video_service.extract_audio(actual_path)
            update_progress("Audio Extraction Complete", 20)

            update_progress(f"Transcribing Audio ({asr_model.upper()} ASR)", 30)
            transcript_data = per_request_video_service.transcribe_audio(audio_path)
            transcript_text = transcript_data["text"]
            update_progress("Transcription Complete", 45)

            if not transcript_text.strip():
                transcript_data = {"segments": [], "text": "(No speech detected)"}
                transcript_text = transcript_data["text"]

            screenshot_path = ""
            screenshot_abs_path = ""
            try:
                update_progress("Capturing System Screenshot", 50)
                rel_path = per_request_video_service.capture_frame(actual_path, transcript_data=transcript_data)
                screenshot_path = rel_path
                if rel_path:
                    project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
                    screenshot_abs_path = os.path.join(project_root, "public", rel_path.lstrip('/'))
                    update_progress("Screenshot Captured", 55)
            except Exception as e:
                logger.error(f"Error capturing screenshot: {e}")

            update_progress("Sending to LLM for AI Analysis", 60)
            criteria = config.get("evaluation_criteria", ["accuracy", "response_time", "user_experience"])
            evaluation_json = await llm_service.evaluate_video(transcript_data, criteria, image_path=screenshot_abs_path)

            evaluation_data = None
            llm_error = None
            try:
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
                else:
                    evaluation_data = eval_parsed
            except json.JSONDecodeError as e:
                llm_error = f"Failed to parse LLM response: {e}"

            if llm_error:
                logger.error(f"LLM analysis failed: {llm_error}")
                supabase.table("video_results").update({
                    "transcript": transcript_text,
                    "metadata": {"path": video_path, "status": "failed", "error": f"LLM: {llm_error}", "progress": 60, "current_phase": "LLM Analysis Failed"}
                }).eq("id", video_result_id).execute()
                _check_task_complete_on_failure(task_id)
                delete_progress(video_result_id)
                return

            update_progress("LLM Analysis Complete", 80)

            if not evaluation_json or evaluation_json.strip() == "{}":
                raise Exception("LLM analysis failed to produce results")

            if "```json" in evaluation_json:
                evaluation_json = evaluation_json.split("```json")[1].split("```")[0].strip()
            elif "```" in evaluation_json:
                evaluation_json = evaluation_json.split("```")[1].split("```")[0].strip()
            evaluation_data = json.loads(evaluation_json)

            if isinstance(evaluation_data, dict) and "cases" in evaluation_data:
                cases = evaluation_data.get("cases", [])
                if cases:
                    first_case = cases[0]
                    evaluation_data["user_question"] = first_case.get("user_question", "")
                    evaluation_data["system_response"] = first_case.get("system_response", "")
                    # 整数化兜底：哪怕 LLM 偷偷返回 4.5 也强制转成 5（详见 _coerce_int_score）。
                    evaluation_data["response_quality_score"] = _coerce_int_score(
                        first_case.get("response_quality_score")
                    )
                    evaluation_data["latency_ms"] = first_case.get("latency_ms", 0)
                    evaluation_data["summary"] = first_case.get("summary", "")
                    all_metrics = []
                    for case in cases:
                        for metric in case.get("matched_metrics", []):
                            all_metrics.append({
                                "criteria": metric.get("metric_name", ""),
                                "metric_code": metric.get("metric_code", ""),
                                "category": metric.get("category", ""),
                                "score": _coerce_int_score(metric.get("score")),
                                "feedback": metric.get("feedback", ""),
                                "selection_reason": metric.get("selection_reason", ""),
                            })
                    evaluation_data["evaluations"] = all_metrics
                else:
                    evaluation_data = {"user_question": "", "system_response": "", "evaluations": []}
            elif isinstance(evaluation_data, dict) and "user_question" in evaluation_data:
                if "evaluations" not in evaluation_data:
                    evaluation_data["evaluations"] = []
            elif isinstance(evaluation_data, list):
                if len(evaluation_data) > 0 and isinstance(evaluation_data[0], dict):
                    if "user_question" in evaluation_data[0] or "evaluations" in evaluation_data[0]:
                        evaluation_data = evaluation_data[0]
                    else:
                        evaluation_data = {"evaluations": evaluation_data}
                else:
                    evaluation_data = {}
            else:
                evaluation_data = {"user_question": "", "system_response": "", "evaluations": []}

            update_progress("Saving Results to Database", 90)

            final_metadata = {
                "path": video_path,
                "status": "completed",
                "progress": 100,
                "current_phase": "Completed",
                "user_question": evaluation_data.get("user_question", ""),
                "system_response": evaluation_data.get("system_response", ""),
                "response_quality_score": _coerce_int_score(
                    evaluation_data.get("response_quality_score")
                ),
                "latency_ms": evaluation_data.get("latency_ms", 0),
                "summary": evaluation_data.get("summary", ""),
                "screenshot_path": screenshot_path,
                "cases": evaluation_data.get("cases", []),
                "evaluations": evaluation_data.get("evaluations", []),
            }

            supabase.table("video_results").update({
                "transcript": transcript_text,
                "metadata": final_metadata,
            }).eq("id", video_result_id).execute()

            evaluations = evaluation_data.get("evaluations", [])
            score_entries = []
            for ev in evaluations:
                entry = {"result_id": video_result_id, "criteria": ev.get("criteria"), "score": ev.get("score"), "feedback": ev.get("feedback")}
                if "metric_code" in ev:
                    entry["metric_code"] = ev["metric_code"]
                if "category" in ev:
                    entry["category"] = ev["category"]
                if "selection_reason" in ev:
                    entry["selection_reason"] = ev["selection_reason"]
                score_entries.append(entry)

            if score_entries:
                supabase.table("evaluation_scores").insert(score_entries).execute()

            ct = supabase.table("analysis_tasks").select("completed_videos, total_videos").eq("id", task_id).execute().data[0]
            new_completed = ct["completed_videos"] + 1
            task_update = {"completed_videos": new_completed}
            supabase.table("analysis_tasks").update(task_update).eq("id", task_id).execute()

            _check_task_complete_on_failure(task_id)
            delete_progress(video_result_id)
            logger.info(f"[WORKER] Completed {video_name}")

        except Exception as e:
            import traceback
            logger.error(f"[WORKER] Error processing {video_name}: {e}\n{traceback.format_exc()}")
            supabase.table("video_results").update({
                "metadata": {"path": video_path, "status": "failed", "error": str(e), "progress": 100, "current_phase": "Failed"}
            }).eq("id", video_result_id).execute()
            _check_task_complete_on_failure(task_id)
            delete_progress(video_result_id)
        finally:
            if nas_temp_path:
                await nas_service.cleanup_temp(nas_temp_path)

    _run_async(_process())
