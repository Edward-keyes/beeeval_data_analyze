import os
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
import os
from typing import Optional, List
from api.core.logger import log_buffer, logger

router = APIRouter(prefix="/api/system", tags=["system"])

class LogEntry(BaseModel):
    time: str
    level: str
    module: str
    function: str
    message: str
    line: int
    exception: Optional[str] = None

class LogsResponse(BaseModel):
    logs: List[LogEntry]
    total: int

@router.get("/logs", response_model=LogsResponse)
async def get_logs(
    level: Optional[str] = None,
    search: Optional[str] = None,
    page: int = 1,
    page_size: int = 50
):
    """
    Retrieve logs from memory buffer.
    Supports filtering by level and text search.
    """
    try:
        # Convert deque to list
        logs = list(log_buffer)
        
        # Filter
        filtered_logs = logs
        
        if level:
            level = level.upper()
            filtered_logs = [l for l in filtered_logs if l["level"] == level]
            
        if search:
            search_lower = search.lower()
            filtered_logs = [l for l in filtered_logs if search_lower in l["message"].lower() or search_lower in l["module"].lower()]
            
        # Sort by time desc (newest first)
        filtered_logs.reverse()
        
        # Pagination
        start = (page - 1) * page_size
        end = start + page_size
        result_logs = filtered_logs[start:end]
        
        return {
            "logs": result_logs,
            "total": len(filtered_logs)
        }
    except Exception as e:
        logger.error(f"Error retrieving logs: {e}")
        raise HTTPException(status_code=500, detail=str(e))

class ListDirRequest(BaseModel):
    path: Optional[str] = None

@router.post("/list-dirs")
async def list_directories(request: ListDirRequest):
    """
    List subdirectories for a given path.
    If path is None, start from root (drive letters on Windows or / on Unix).
    """
    try:
        # Get path from request
        target_path = request.path

        # If no path provided, start from root
        # On Windows, show drive letters; on Unix, start from /
        if not target_path:
            import platform
            if platform.system() == "Windows":
                # Return drive letters as the starting point
                import string
                drives = []
                for letter in string.ascii_uppercase:
                    drive_path = f"{letter}:\\"
                    if os.path.exists(drive_path):
                        drives.append({"name": f"{letter}:\\", "path": drive_path, "type": "drive"})
                return {"current_path": "My Computer", "directories": drives}
            else:
                target_path = "/"
            
        # Ensure path is absolute
        target_path = os.path.abspath(target_path)

        # Security check: ensure we can read it
        if not os.path.exists(target_path):
            # If path doesn't exist, try falling back to root
            import platform
            if platform.system() == "Windows":
                target_path = "C:\\"
            else:
                target_path = "/"

        if not os.path.isdir(target_path):
            return {"current_path": target_path, "directories": [], "error": "Not a directory"}

        items = []

        # Add parent directory entry
        # On Windows, if we're at a drive root (e.g., D:\), parent should go back to drive list
        parent_path = os.path.dirname(target_path)
        is_drive_root = len(target_path) == 3 and target_path[1] == ':' and target_path[2] == '\\'  # e.g., D:\

        if is_drive_root:
            # Going up from drive root returns to "My Computer" (drive list)
            items.append({"name": "..", "path": "", "type": "root"})
        elif parent_path and parent_path != target_path:
            items.append({"name": "..", "path": parent_path, "type": "dir"})

        try:
            with os.scandir(target_path) as entries:
                for entry in entries:
                    if entry.is_dir() and not entry.name.startswith('.'):
                        items.append({
                            "name": entry.name,
                            "path": entry.path,
                            "type": "dir"
                        })
        except PermissionError:
            return {"current_path": target_path, "directories": [], "error": "Permission denied"}
        
        # Sort by name
        items.sort(key=lambda x: x["name"])
        
        return {
            "current_path": target_path,
            "directories": items
        }
    except Exception as e:
        logger.error(f"Error listing directories: {e}")
        raise HTTPException(status_code=500, detail=str(e))
