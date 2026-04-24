import os
import cv2
import numpy as np
import json
from typing import Optional
from api.core.logger import logger

class SmartFrameDetector:
    def __init__(self, diff_threshold: float = 0.3, min_gap: float = 0.5):
        self.diff_threshold = diff_threshold
        self.min_gap = min_gap

    def detect_ui_changes(self, video_path: str, sample_interval: float = 0.5) -> list[dict]:
        """
        快速 UI 变化检测 - 方案一
        返回: [{"time": 2.5, "diff": 0.85}, ...]
        """
        logger.info(f"Starting UI change detection for {video_path}")
        
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            logger.error(f"Cannot open video: {video_path}")
            return []
        
        fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration = total_frames / fps if fps > 0 else 0
        
        logger.info(f"Video: {duration:.2f}s, FPS: {fps:.2f}")
        
        change_points = []
        prev_gray = None
        frame_idx = 0
        skip_frames = int(fps * sample_interval)
        last_change_time = -999.0
        
        while frame_idx < total_frames:
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
            ret, frame = cap.read()
            
            if not ret:
                break
            
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            gray = cv2.resize(gray, (320, 240))  # 缩小以提高速度
            
            current_time = frame_idx / fps
            
            if prev_gray is not None:
                # 计算差异 (使用三种方法取平均)
                diff_brightness = np.mean(np.abs(gray.astype(float) - prev_gray.astype(float))) / 255.0
                
                # 边缘差异
                edges_prev = cv2.Canny(prev_gray, 50, 150)
                edges_curr = cv2.Canny(gray, 50, 150)
                diff_edge = np.mean(np.abs(edges_curr.astype(float) - edges_prev.astype(float))) / 255.0
                
                # 整体差异
                diff = (diff_brightness * 0.6 + diff_edge * 0.4)
                
                # 检查是否是有效变化点
                if diff > self.diff_threshold and (current_time - last_change_time) > self.min_gap:
                    change_points.append({
                        "time": round(current_time, 2),
                        "diff": round(diff, 3),
                        "frame_idx": frame_idx
                    })
                    last_change_time = current_time
                    logger.debug(f"Change detected at {current_time:.2f}s, diff={diff:.3f}")
            
            prev_gray = gray
            frame_idx += skip_frames
        
        cap.release()
        logger.info(f"Found {len(change_points)} change points")
        return change_points

    def find_key_frame(self, video_path: str, transcript_data: dict) -> Optional[float]:
        """
        混合方案: 结合 UI 变化和语音转写找到最佳关键帧
        返回: 最佳关键帧时间点 (秒)
        """
        # 1. 检测 UI 变化点
        change_points = self.detect_ui_changes(video_path)
        
        if not change_points:
            logger.warning("No UI changes detected, using default (duration - 3)")
            return None
        
        # 2. 从转写中找到用户提问结束的时间
        user_end_time = self._find_user_question_end_time(transcript_data)
        
        if user_end_time is None:
            # 如果无法识别用户问题，选择最大变化点
            best = max(change_points, key=lambda x: x["diff"])
            logger.info(f"No user question end time found, using max diff frame at {best['time']}s")
            return best["time"]
        
        # 3. 找到离用户提问结束时间最近的 UI 变化点
        # 这个变化点很可能就是车机开始响应的时刻
        best_match = None
        min_distance = float('inf')
        
        for cp in change_points:
            # 变化点应该在用户说完之后 (容忍一定延迟)
            if cp["time"] >= user_end_time - 0.5:
                distance = abs(cp["time"] - user_end_time)
                if distance < min_distance:
                    min_distance = distance
                    best_match = cp
        
        if best_match:
            logger.info(f"Key frame selected at {best_match['time']}s (user ended at {user_end_time}s)")
            return best_match["time"]
        
        # 4. 如果找不到合适的，选择第一个变化点
        first_change = change_points[0]
        logger.info(f"Using first change point at {first_change['time']}s")
        return first_change["time"]

    def _find_user_question_end_time(self, transcript_data: dict) -> Optional[float]:
        """
        从转写数据中找到用户提问结束的时间点
        策略:
        1. 找到最长的用户语句
        2. 或者找到语音特征变化点
        """
        segments = transcript_data.get("segments", [])
        
        if not segments:
            return None
        
        # 简单策略: 假设最后一个较长的片段是用户问题
        # 实际生产中可以用 VAD (语音活动检测) 来更准确地判断
        
        # 计算每段的长度
        for seg in segments:
            seg["duration"] = seg.get("end", 0) - seg.get("start", 0)
        
        # 找到最长的片段 (可能是用户问题)
        # 注意: 这个逻辑可以根据实际数据调整
        longest_segment = max(segments, key=lambda x: x.get("duration", 0))
        
        if longest_segment.get("duration", 0) > 1.0:  # 至少 1 秒
            end_time = longest_segment.get("end", 0)
            logger.debug(f"Longest segment ends at {end_time}s, treating as user question end")
            return end_time
        
        return None

    def get_frames_for_vlm(self, video_path: str, num_frames: int = 6) -> list[dict]:
        """
        提取候选帧用于 VLM 分析 - 方案三
        返回: [{"time": 1.5, "frame": numpy_array}, ...]
        """
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return []
        
        fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration = total_frames / fps if fps > 0 else 0
        
        # 均匀采样
        interval = duration / (num_frames + 1)
        frames = []
        
        for i in range(num_frames):
            target_time = interval * (i + 1)
            frame_idx = int(target_time * fps)
            
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
            ret, frame = cap.read()
            
            if ret:
                frames.append({
                    "time": round(target_time, 2),
                    "frame": frame,
                    "index": i
                })
        
        cap.release()
        return frames

    def capture_key_frame(self, video_path: str, transcript_data: dict = None, output_dir: str = None) -> str:
        """
        智能截取关键帧
        """
        if output_dir is None:
            output_dir = os.path.join(
                os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
                "public", "screenshots"
            )
        
        os.makedirs(output_dir, exist_ok=True)
        
        # 使用混合方案找到关键帧时间
        key_time = None
        
        if transcript_data:
            key_time = self.find_key_frame(video_path, transcript_data)
        
        # 如果上面方法失败，使用默认策略
        if key_time is None:
            cap = cv2.VideoCapture(video_path)
            duration = cap.get(cv2.CAP_PROP_FRAME_COUNT) / cap.get(cv2.CAP_PROP_FPS)
            cap.release()
            key_time = max(0, duration - 3.0)
            logger.info(f"Fallback: using {key_time}s (duration - 3)")
        
        # 截取该时间点的帧
        cap = cv2.VideoCapture(video_path)
        fps = cap.get(cv2.CAP_PROP_FPS)
        frame_idx = int(key_time * fps)
        
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ret, frame = cap.read()
        cap.release()
        
        if not ret:
            logger.error(f"Failed to capture frame at {key_time}s")
            return ""
        
        # 保存帧
        frame_filename = f"{os.path.basename(video_path)}_key_{int(key_time)}.jpg"
        output_path = os.path.join(output_dir, frame_filename)
        
        cv2.imwrite(output_path, frame)
        
        relative_path = f"/screenshots/{frame_filename}"
        logger.info(f"Key frame saved to {relative_path} (time={key_time:.2f}s)")
        
        return relative_path


smart_frame_detector = SmartFrameDetector()
