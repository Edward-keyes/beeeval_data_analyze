import os
import sys
# Import SSL patch FIRST
import api.core.ssl_patch

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from dotenv import load_dotenv
from api.core.logger import logger  # Initialize logger

# Add local bin to PATH for ffmpeg
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bin_dir = os.path.join(project_root, "bin")
os.environ["PATH"] = bin_dir + os.pathsep + os.environ["PATH"]

# Set IMAGEIO_FFMPEG_EXE explicitly for moviepy just in case
ffmpeg_path = os.path.join(bin_dir, "ffmpeg")
if os.path.exists(ffmpeg_path):
    os.environ["IMAGEIO_FFMPEG_EXE"] = ffmpeg_path
    os.environ["FFMPEG_BINARY"] = ffmpeg_path # Also set this for safety

from api.routers import video, system, chat, translation, rag, nas, aggregation

load_dotenv()

app = FastAPI(title="BeeEVAL API", description="Backend for BeeEVAL Video Analysis Tool")

# CORS：浏览器在「A 域页面里请求 B 域 API」时会先发 OPTIONS 并检查响应头。
# allow_origins 必须列出**官网/嵌入页的完整源**（含协议+域名+端口），不能用 * 与
# allow_credentials=True 同用。生产环境在 .env 里设 CORS_ORIGINS=逗号分隔的多个源。
def _cors_origins() -> list[str]:
    default = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
    extra = [x.strip() for x in (os.getenv("CORS_ORIGINS", "") or "").split(",") if x.strip()]
    seen: set[str] = set()
    out: list[str] = []
    for o in default + extra:
        if o not in seen:
            seen.add(o)
            out.append(o)
    return out


_cors = _cors_origins()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static screenshots
public_dir = os.path.join(project_root, "public")
if not os.path.exists(public_dir):
    os.makedirs(public_dir)
app.mount("/screenshots", StaticFiles(directory=os.path.join(public_dir, "screenshots")), name="screenshots")

app.include_router(video.router)
app.include_router(system.router)
app.include_router(chat.router)
app.include_router(translation.router)
app.include_router(rag.router)
app.include_router(nas.router)
app.include_router(aggregation.router)

@app.get("/")
async def root():
    return {"message": "BeeEVAL API is running"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

@app.get("/dr-bee")
async def dr_bee_page():
    html_path = os.path.join(public_dir, "dr-bee.html")
    return FileResponse(html_path, media_type="text/html")
