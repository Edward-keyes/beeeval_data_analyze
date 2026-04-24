#!/usr/bin/env python3
"""Test script for video analysis API - with proxy disabled."""

import requests
import time
import json
import os

# Disable all proxy settings
os.environ['HTTP_PROXY'] = ''
os.environ['HTTPS_PROXY'] = ''
os.environ['NO_PROXY'] = 'localhost,127.0.0.1'

BASE_URL = "http://localhost:8001"

def test_analysis():
    # Test video path - use simple filename to avoid encoding issues
    folder_path = r"C:\测试视频"
    video_names = ["福特.mp4"]
    # Use whisper since funasr has model registration issues
    asr_model = "whisper"

    print("=" * 60)
    print("Testing Video Analysis API")
    print("=" * 60)

    # Step 1: Start analysis
    print("\n[1] Starting analysis...")

    # Create session without proxy
    session = requests.Session()
    session.trust_env = False  # Don't use system proxy

    response = session.post(
        f"{BASE_URL}/api/video/analyze",
        json={
            "folder_path": folder_path,
            "video_names": video_names,
            "asr_model": asr_model
        },
        timeout=30
    )

    if response.status_code != 200:
        print(f"ERROR: {response.status_code}")
        print(response.text)
        return

    result = response.json()
    task_id = result.get("task_id")
    print(f"Task ID: {task_id}")
    print(f"Status: {result.get('status')}")

    # Step 2: Poll for status
    print("\n[2] Polling for status (every 1s)...")

    while True:
        status_response = session.get(f"{BASE_URL}/api/video/status/{task_id}", timeout=60)
        if status_response.status_code != 200:
            print(f"ERROR fetching status: {status_response.status_code}")
            break

        status_data = status_response.json()
        task = status_data.get("task", {})
        videos = status_data.get("videos", [])

        print(f"\n  Task Status: {task.get('status')} ({task.get('completed_videos')}/{task.get('total_videos')})")

        for video in videos:
            metadata = video.get("metadata", {})
            progress = metadata.get("progress", 0)
            phase = metadata.get("current_phase", "Unknown")
            status = metadata.get("status", "unknown")
            print(f"  - {video.get('video_name')}:")
            print(f"      Progress: {progress}% | Phase: {phase} | Status: {status}")

            if status == "failed":
                print(f"      Error: {metadata.get('error', 'Unknown error')}")

        if task.get("status") == "completed" or status == "failed":
            print("\n[3] Task completed!")
            break

        time.sleep(1)

    # Step 3: Fetch final results
    print("\n[3] Fetching final results...")
    results_response = session.get(f"{BASE_URL}/api/video/results/{task_id}", timeout=30)

    if results_response.status_code == 200:
        results = results_response.json()
        print(json.dumps(results, indent=2, ensure_ascii=False))
    else:
        print(f"ERROR fetching results: {results_response.status_code}")

    print("\n" + "=" * 60)
    print("Test Complete")
    print("=" * 60)

if __name__ == "__main__":
    test_analysis()
