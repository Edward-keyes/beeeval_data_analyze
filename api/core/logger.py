import sys
import os
from loguru import logger
from collections import deque

# Configure logging paths
LOG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "logs")
if not os.path.exists(LOG_DIR):
    os.makedirs(LOG_DIR)

LOG_FILE = os.path.join(LOG_DIR, "beeeval.log")

# In-memory buffer for real-time API access (last 1000 lines)
# We use a deque to store log records
log_buffer = deque(maxlen=1000)

def memory_sink(message):
    """Custom sink to store logs in memory."""
    try:
        record = message.record
        log_entry = {
            "time": record["time"].strftime("%Y-%m-%d %H:%M:%S.%f")[:-3],
            "level": record["level"].name,
            "module": record["name"],
            "function": record["function"],
            "message": record["message"],
            "line": record["line"],
            "exception": str(record["exception"]) if record["exception"] else None
        }
        log_buffer.append(log_entry)
    except Exception as e:
        print(f"Error in memory sink: {e}")

# Configure Loguru
def configure_logging():
    logger.remove()  # Remove default handler
    
    # 1. Console Output (Colored)
    logger.add(
        sys.stderr,
        format="<green>{time:YYYY-MM-DD HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
        level="DEBUG",
        colorize=True
    )
    
    # 2. File Output (Rotation & Retention)
    logger.add(
        LOG_FILE,
        rotation="10 MB",  # Rotate when file reaches 10MB
        retention="7 days", # Keep logs for 7 days
        compression="zip", # Compress old logs
        format="{time:YYYY-MM-DD HH:mm:ss} | {level: <8} | {name}:{function}:{line} - {message}",
        level="INFO",
        enqueue=True # Async safe
    )
    
    # 3. Memory Sink for API
    logger.add(
        memory_sink,
        level="DEBUG",
        format="{message}" # Format doesn't matter much here as we parse the record directly
    )

    logger.info("Logging initialized")

# Initialize configuration
configure_logging()
