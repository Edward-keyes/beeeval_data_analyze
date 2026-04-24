"""
Celery application instance.
Broker and result backend both use Redis.
"""
from celery import Celery
from api.core.config import settings

celery_app = Celery(
    "beeeval",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.REDIS_URL,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Shanghai",
    enable_utc=False,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_default_queue="video_analysis",
    task_routes={
        "api.tasks.video_tasks.*": {"queue": "video_analysis"},
    },
)

celery_app.conf.update(
    include=["api.tasks.video_tasks"],
)
