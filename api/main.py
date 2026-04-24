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

from api.routers import video, system, chat, translation, rag, nas

load_dotenv()

app = FastAPI(title="BeeEVAL API", description="Backend for BeeEVAL Video Analysis Tool")

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "*"],
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
