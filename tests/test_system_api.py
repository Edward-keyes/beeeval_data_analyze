
from fastapi.testclient import TestClient
from api.main import app
from api.core.logger import logger

client = TestClient(app)

def test_get_logs():
    # Generate some logs
    logger.info("API Test Log 1")
    logger.warning("API Test Log 2")
    
    response = client.get("/api/system/logs")
    assert response.status_code == 200
    data = response.json()
    assert "logs" in data
    assert "total" in data
    assert len(data["logs"]) > 0
    
def test_filter_logs_by_level():
    logger.error("Unique Error Log")
    
    response = client.get("/api/system/logs?level=ERROR")
    assert response.status_code == 200
    data = response.json()
    
    # Check that all returned logs are ERROR level
    for log in data["logs"]:
        assert log["level"] == "ERROR"

def test_search_logs():
    unique_string = "SuperUniqueSearchTerm"
    logger.info(f"This is a {unique_string}")
    
    response = client.get(f"/api/system/logs?search={unique_string}")
    assert response.status_code == 200
    data = response.json()
    
    assert len(data["logs"]) >= 1
    # Check that search term is in message or module
    found = False
    for log in data["logs"]:
        if unique_string in log["message"]:
            found = True
            break
    assert found

def test_pagination():
    # Ensure we have enough logs
    for i in range(25):
        logger.info(f"Pagination Log {i}")
        
    response = client.get("/api/system/logs?page=1&page_size=10")
    assert response.status_code == 200
    data = response.json()
    assert len(data["logs"]) == 10
    
    response = client.get("/api/system/logs?page=2&page_size=10")
    assert response.status_code == 200
    data_page_2 = response.json()
    assert len(data_page_2["logs"]) == 10
    
    # Ensure pages are different
    assert data["logs"] != data_page_2["logs"]
