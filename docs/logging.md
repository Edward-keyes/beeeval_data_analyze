
# Logging Module Documentation

## Overview
The BeeEVAL system uses a centralized logging module built on top of `loguru`. It provides structured logging, file persistence with rotation, and an in-memory buffer for real-time API access.

## Features
- **Multi-level Logging**: Supports DEBUG, INFO, WARNING, ERROR, CRITICAL.
- **Console Output**: Colored output for development.
- **File Persistence**: Logs are saved to `logs/beeeval.log`.
  - Rotation: Every 10 MB.
  - Retention: 7 days.
- **In-Memory Buffer**: Stores the last 1000 log entries for API retrieval.
- **API Access**: `/api/system/logs` endpoint to fetch, filter, and search logs.

## Usage

### In Code
Import the `logger` from `api.core.logger`:

```python
from api.core.logger import logger

logger.debug("This is a debug message")
logger.info("Processing video: video.mp4")
logger.warning("Something looks wrong")
logger.error("An error occurred", exc_info=True) # exc_info is handled automatically by loguru catch or explicit exception logging
```

### API Endpoint
**GET /api/system/logs**

Parameters:
- `level` (optional): Filter by log level (e.g., "ERROR", "INFO").
- `search` (optional): Search for a string in the log message.
- `page` (optional): Page number (default: 1).
- `page_size` (optional): Logs per page (default: 50).

Response:
```json
{
  "total": 150,
  "page": 1,
  "page_size": 50,
  "logs": [
    "2023-10-27 10:00:00.123 | INFO     | api.main:startup:15 - Application startup",
    ...
  ]
}
```

## Configuration
Configuration is located in `api/core/logger.py`.
- **Log File Path**: `logs/beeeval.log`
- **Rotation**: `10 MB`
- **Retention**: `7 days`
- **Buffer Size**: `1000` entries

## Troubleshooting
If logs are not appearing:
1. Check `logs/beeeval.log` file permissions.
2. Ensure `LOG_LEVEL` environment variable is set correctly (default is DEBUG).
3. Check if the `logs/` directory exists (it is created automatically).
