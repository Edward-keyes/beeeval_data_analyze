import requests
import json
import time

# ==================== Configuration ====================
# Update BASE_URL to change the backend server address
BASE_URL = "http://localhost:8000"
API_PREFIX = "/api/video"
# =======================================================

url = f"{BASE_URL}{API_PREFIX}/analyze"
payload = {
    "folder_path": "/Users/yangzhenyu/Desktop/银河视频",
    "video_names": ["银河 3039.mp4"]
}

try:
    print(f"Sending request to {url}...")
    response = requests.post(url, json=payload)
    print(f"Status Code: {response.status_code}")
    print(f"Response: {response.text}")

    if response.status_code == 200:
        task_id = response.json().get("task_id")
        print(f"Task ID: {task_id}")

        # Poll for results
        for i in range(10):
            time.sleep(2)
            res_url = f"{BASE_URL}{API_PREFIX}/results/{task_id}"
            res = requests.get(res_url)
            data = res.json()
            results = data.get("results", [])
            if results:
                status = results[0]["metadata"]["status"]
                print(f"Poll {i+1}: Status = {status}")
                if status == "failed":
                    print(f"Error: {results[0]['metadata'].get('error')}")
                    break
                if status == "completed":
                    print("Success!")
                    break
except Exception as e:
    print(f"Request failed: {e}")
