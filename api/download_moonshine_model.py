#!/usr/bin/env python3
"""
Moonshine ASR Model Download Script

This script helps you download the Moonshine model for your preferred language.
Run this after installing moonshine-voice to set up the models.

Usage:
    python download_moonshine_model.py

Supported languages:
    - en (English)
    - zh (Chinese/Mandarin)
    - es (Spanish)
    - ja (Japanese)
    - ko (Korean)
    - vi (Vietnamese)
    - uk (Ukrainian)
    - ar (Arabic)

Model architecture:
    - 0 (Tiny): Fastest, smallest accuracy
    - 1 (Small): Best speed/accuracy balance (default)
    - 2 (Medium): Highest accuracy, slower
"""

import os
import sys
import subprocess

# Model size name to architecture number mapping
SIZE_TO_ARCH = {
    "tiny": 0,
    "small": 1,
    "medium": 2
}

def download_model(language: str = "zh", model_size: str = "small"):
    """Download Moonshine model for specified language."""

    # Convert size name to architecture number
    model_arch = SIZE_TO_ARCH.get(model_size.lower(), 1)

    print(f"Downloading Moonshine {model_size} (arch={model_arch}) model for {language}...")
    print("=" * 50)

    try:
        # Run the official Moonshine download command
        cmd = [
            sys.executable,
            "-m",
            "moonshine_voice.download",
            "--language",
            language,
            "--model-arch",
            str(model_arch)
        ]

        result = subprocess.run(cmd, capture_output=True, text=True, check=False)

        if result.stdout:
            print(result.stdout)

        if result.stderr:
            print("Notes from downloader:")
            print(result.stderr)

        if result.returncode != 0:
            print(f"\nCommand exited with code {result.returncode}")
            print("\nPossible issues:")
            print("1. Check if the language 'zh' is supported by your moonshine-voice version")
            print("2. Try listing available models first")
            print("\nTrying alternative download method...")

            # Try downloading without specifying language (default)
            alt_cmd = [
                sys.executable,
                "-m",
                "moonshine_voice.download",
                "--model-arch",
                str(model_arch)
            ]
            print(f"\nTrying default language download: {alt_cmd}")
            alt_result = subprocess.run(alt_cmd, capture_output=True, text=True, check=False)
            if alt_result.stdout:
                print(alt_result.stdout)
            if alt_result.stderr:
                print(alt_result.stderr)
            return

        print("=" * 50)
        print("Download complete!")
        print("\nNext steps:")
        print("1. Copy the model path from the output above")
        print("2. Update MOONSHINE_MODEL_PATH in your .env file")
        print("3. Set MOONSHINE_MODEL_ARCH (0=Tiny, 1=Small, 2=Medium)")
        print("4. Restart the API server")

    except Exception as e:
        print(f"Error downloading model: {e}")
        print("\nMake sure you have installed moonshine-voice:")
        print("  pip install moonshine-voice")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="Download Moonshine ASR model",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )

    parser.add_argument(
        "--language",
        "-l",
        type=str,
        default="zh",
        help="Language code (default: zh for Chinese)"
    )

    parser.add_argument(
        "--size",
        "-s",
        type=str,
        default="small",
        choices=["tiny", "small", "medium"],
        help="Model size (default: small)"
    )

    args = parser.parse_args()

    download_model(args.language, args.size)
