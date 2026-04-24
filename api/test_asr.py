#!/usr/bin/env python3
"""
ASR Model Transcription Test Script

This script tests the audio extraction and transcription capabilities
of different ASR models without LLM evaluation.

Usage:
    python test_asr.py <video_path> [--model moonshine|whisper|funasr] [--output <output_path>]

Examples:
    python test_asr.py "C:/videos/test.mp4" --model moonshine
    python test_asr.py "C:/videos/test.mp4" --model funasr --output result.json
"""

import os
import sys
import json
import argparse
import time
from datetime import datetime

# Add project root to path
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_root)

from api.services.video_service import VideoService, ASRModel
from api.core.logger import logger


class ASRTester:
    """Standalone ASR transcription tester."""

    def __init__(self, asr_model: ASRModel = ASRModel.MOONSHINE):
        self.asr_model = asr_model
        self.video_service = VideoService(asr_model=asr_model)
        logger.info(f"ASRTester initialized with {asr_model.value.upper()}")

    def test_transcription(self, video_path: str, output_path: str = None) -> dict:
        """
        Test transcription for a single video file.

        Args:
            video_path: Path to the video file
            output_path: Optional path to save results

        Returns:
            Dictionary containing transcription results and metrics
        """
        results = {
            "video_path": video_path,
            "asr_model": self.asr_model.value,
            "timestamp": datetime.now().isoformat(),
            "metrics": {},
            "transcript": None,
            "error": None
        }

        try:
            # Check if video exists
            if not os.path.exists(video_path):
                raise FileNotFoundError(f"Video file not found: {video_path}")

            logger.info(f"Starting ASR test for: {video_path}")
            logger.info(f"Using ASR model: {self.asr_model.value.upper()}")

            # Step 1: Extract Audio
            logger.info("=" * 50)
            logger.info("Step 1: Extracting audio from video...")
            start_time = time.time()
            audio_path = self.video_service.extract_audio(video_path)
            audio_extract_time = time.time() - start_time
            results["metrics"]["audio_extract_time_sec"] = round(audio_extract_time, 3)
            logger.info(f"Audio extracted to: {audio_path}")
            logger.info(f"Audio extraction time: {audio_extract_time:.2f}s")

            # Step 2: Transcribe
            logger.info("=" * 50)
            logger.info("Step 2: Transcribing audio...")
            start_time = time.time()
            transcript_data = self.video_service.transcribe_audio(audio_path)
            transcription_time = time.time() - start_time
            results["metrics"]["transcription_time_sec"] = round(transcription_time, 3)
            logger.info(f"Transcription completed in: {transcription_time:.2f}s")

            # Compile results
            results["transcript"] = {
                "full_text": transcript_data.get("text", ""),
                "segments": transcript_data.get("segments", []),
                "language": transcript_data.get("language", "zh"),
                "segment_count": len(transcript_data.get("segments", []))
            }

            # Additional metrics
            results["metrics"]["total_duration_sec"] = round(
                audio_extract_time + transcription_time, 3
            )
            results["metrics"]["text_length"] = len(transcript_data.get("text", ""))
            results["metrics"]["words_count"] = len(transcript_data.get("text", "").split())

            # Calculate RTF (Real-Time Factor)
            # Try to get audio duration using moviepy
            try:
                from moviepy.audio.io.AudioFileClip import AudioFileClip
                audio = AudioFileClip(audio_path)
                audio_duration = audio.duration
                audio.close()
                if audio_duration > 0:
                    rtf = transcription_time / audio_duration
                    results["metrics"]["rtf"] = round(rtf, 4)
                    results["metrics"]["audio_duration_sec"] = round(audio_duration, 3)
                    logger.info(f"Audio duration: {audio_duration:.2f}s")
                    logger.info(f"RTF (Real-Time Factor): {rtf:.4f}")
            except Exception as e:
                logger.warning(f"Could not calculate RTF: {e}")

            # Save results if output path provided
            if output_path:
                with open(output_path, 'w', encoding='utf-8') as f:
                    json.dump(results, f, ensure_ascii=False, indent=2)
                logger.info(f"Results saved to: {output_path}")

            # Print summary
            logger.info("=" * 50)
            logger.info("TRANSCRIPTION SUMMARY")
            logger.info("=" * 50)
            logger.info(f"Full Text ({results['metrics']['text_length']} chars):")
            logger.info("-" * 50)
            logger.info(transcript_data.get("text", ""))
            logger.info("-" * 50)

            if transcript_data.get("segments"):
                logger.info("\nSegments with timestamps:")
                for i, seg in enumerate(transcript_data["segments"][:10]):  # Show first 10
                    logger.info(f"  [{i+1}] {seg['start']:.2f}s - {seg['end']:.2f}s: {seg['text']}")
                if len(transcript_data["segments"]) > 10:
                    logger.info(f"  ... and {len(transcript_data['segments']) - 10} more segments")

            logger.info("=" * 50)
            logger.info("METRICS")
            logger.info("=" * 50)
            for key, value in results["metrics"].items():
                logger.info(f"  {key}: {value}")

        except Exception as e:
            import traceback
            error_trace = traceback.format_exc()
            results["error"] = str(e)
            logger.error(f"Error during ASR test: {e}")
            logger.error(error_trace)

        return results


def main():
    parser = argparse.ArgumentParser(
        description="Test ASR transcription for a video file",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    python test_asr.py "C:/videos/test.mp4" --model moonshine
    python test_asr.py "C:/videos/test.mp4" --model funasr --output result.json
    python test_asr.py "C:/videos/test.mp4" --model whisper --output whisper_result.json
        """
    )

    parser.add_argument(
        "video_path",
        type=str,
        help="Path to the video file to test"
    )

    parser.add_argument(
        "--model",
        "-m",
        type=str,
        choices=["moonshine", "whisper", "funasr"],
        default="moonshine",
        help="ASR model to use (default: moonshine)"
    )

    parser.add_argument(
        "--output",
        "-o",
        type=str,
        default=None,
        help="Output file path for saving results (JSON format)"
    )

    parser.add_argument(
        "--no-log",
        action="store_true",
        help="Disable detailed logging"
    )

    args = parser.parse_args()

    # Configure logging
    if args.no_log:
        import logging
        logging.getLogger().setLevel(logging.WARNING)

    # Map model string to ASRModel enum
    model_map = {
        "moonshine": ASRModel.MOONSHINE,
        "whisper": ASRModel.WHISPER,
        "funasr": ASRModel.FUNASR
    }

    selected_model = model_map.get(args.model.lower(), ASRModel.MOONSHINE)

    # Run test
    tester = ASRTester(asr_model=selected_model)
    results = tester.test_transcription(args.video_path, args.output)

    # Exit with error code if transcription failed
    if results.get("error"):
        print(f"\nError: {results['error']}")
        sys.exit(1)
    else:
        print("\nTest completed successfully!")
        sys.exit(0)


if __name__ == "__main__":
    main()
