"""
视频名称解析工具
从视频名称中提取结构化信息：用例 ID、品牌车型、系统版本、功能域

命名规则：{用例 ID}-{品牌车型}-{系统版本}-{功能域}-{场景描述}-{序号}.mp4
例如：1002-理想 i8-v8.0.1-车控域-NULL-1.mp4
"""

import os
import re
from typing import Optional, Dict
from api.core.logger import logger


class VideoNameParser:
    """视频名称解析器"""

    # 6 段格式：{用例 ID}-{品牌车型}-{系统版本}-{功能域}-{场景描述}-{序号}.mp4
    PATTERN_6 = re.compile(r'^(\d+)-(.*?)-(v?\d+\.\d+\.?\d*)-(.*?)-(.+?)-(\d+)\.mp4$')
    # 5 段格式：{用例 ID}-{品牌车型}-{系统版本}-{功能域}-{质量标记}.mp4  （NAS 常见）
    PATTERN_5 = re.compile(r'^(\d+)-(.*?)-(v?\d+\.\d+\.?\d*)-(.*?)-(.+?)\.mp4$')

    @classmethod
    def parse(cls, video_name: str) -> Dict[str, Optional[str]]:
        """
        解析视频名称，提取结构化信息。
        支持 6 段格式（含序号）和 5 段格式（NAS，含质量标记）。
        """
        result = {
            "case_id": None,
            "brand_model": None,
            "system_version": None,
            "function_domain": None,
            "scenario": None,
            "sequence": None,
            "quality_tag": None,
            "parsed": False
        }

        if not video_name:
            return result

        ext = os.path.splitext(video_name)[1].lower()
        if ext not in ('.mp4', '.mov', '.avi', '.mkv', '.webm'):
            logger.debug(f"Not a video file: {video_name}")
            return result

        name_without_ext = video_name[:-(len(ext))]

        # 先尝试 6 段格式
        match = cls.PATTERN_6.match(name_without_ext + ".mp4")
        if match:
            result.update({
                "case_id": match.group(1),
                "brand_model": match.group(2),
                "system_version": match.group(3),
                "function_domain": match.group(4),
                "scenario": match.group(5),
                "sequence": match.group(6),
                "parsed": True,
            })
            logger.debug(f"Parsed (6-seg): {video_name} -> {result}")
            return result

        # 再尝试 5 段格式（NAS）
        match = cls.PATTERN_5.match(name_without_ext + ".mp4")
        if match:
            result.update({
                "case_id": match.group(1),
                "brand_model": match.group(2),
                "system_version": match.group(3),
                "function_domain": match.group(4),
                "quality_tag": match.group(5),
                "parsed": True,
            })
            logger.debug(f"Parsed (5-seg): {video_name} -> {result}")
            return result

        # 最后回退：按横杠分割
        parts = name_without_ext.split('-', 3)
        if len(parts) >= 4:
            result.update({
                "case_id": parts[0],
                "brand_model": parts[1],
                "system_version": parts[2],
                "function_domain": parts[3].split('-')[0] if '-' in parts[3] else parts[3],
                "parsed": True,
            })
            logger.debug(f"Parsed (fallback): {video_name} -> {result}")
        else:
            logger.warning(f"Failed to parse video name: {video_name}")

        return result

    @classmethod
    def extract_case_id(cls, video_name: str) -> Optional[str]:
        """只提取用例 ID"""
        result = cls.parse(video_name)
        return result.get("case_id")

    @classmethod
    def extract_brand_model(cls, video_name: str) -> Optional[str]:
        """只提取品牌车型"""
        result = cls.parse(video_name)
        return result.get("brand_model")

    @classmethod
    def extract_system_version(cls, video_name: str) -> Optional[str]:
        """只提取系统版本"""
        result = cls.parse(video_name)
        return result.get("system_version")

    @classmethod
    def extract_function_domain(cls, video_name: str) -> Optional[str]:
        """只提取功能域"""
        result = cls.parse(video_name)
        return result.get("function_domain")


# 便捷函数
def parse_video_name(video_name: str) -> Dict[str, Optional[str]]:
    """解析视频名称"""
    return VideoNameParser.parse(video_name)


# 测试
if __name__ == "__main__":
    test_names = [
        "1002-理想 i8-v8.0.1-车控域-NULL-1.mp4",
        "2005-小鹏 P7-v9.2.0-智驾域-高速 NGP-2.mp4",
        "3010-蔚来 ET7-v7.5.3-座舱域-语音交互 -3.mp4",
        "test-video.mp4",  # 不符合格式
    ]

    for name in test_names:
        result = VideoNameParser.parse(name)
        print(f"{name}:")
        print(f"  用例 ID: {result['case_id']}")
        print(f"  品牌车型：{result['brand_model']}")
        print(f"  系统版本：{result['system_version']}")
        print(f"  功能域：{result['function_domain']}")
        print(f"  解析成功：{result['parsed']}")
        print()
