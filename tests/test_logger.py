
import pytest
from api.core.logger import logger, log_buffer

def test_logger_buffer():
    # Clear buffer first
    log_buffer.clear()
    
    # Log some messages
    logger.info("Test Info Message")
    logger.error("Test Error Message")
    logger.debug("Test Debug Message")
    
    # Check if messages are in buffer
    assert len(log_buffer) >= 3
    
    # Verify content
    logs = list(log_buffer)
    # log_buffer contains dicts
    assert any("Test Info Message" in log["message"] for log in logs)
    assert any("Test Error Message" in log["message"] for log in logs)
    
def test_logger_rotation():
    # This is harder to test without filling the buffer, but we can check if it's a deque
    from collections import deque
    assert isinstance(log_buffer, deque)
    assert log_buffer.maxlen == 1000
