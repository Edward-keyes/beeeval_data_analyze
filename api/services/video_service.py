import os
from moviepy.video.io.VideoFileClip import VideoFileClip
from api.core.config import settings
from api.core.logger import logger
from api.services.smart_frame_detector import smart_frame_detector
from enum import Enum


class ASRModel(str, Enum):
    """ASR model selection."""
    WHISPER = "whisper"
    MOONSHINE = "moonshine"
    FUNASR = "funasr"


class MoonshineService:
    """Moonshine ASR service for speech-to-text transcription."""

    def __init__(self):
        logger.info("Initializing Moonshine service...")
        self.model_path = settings.MOONSHINE_MODEL_PATH
        self.model_arch = settings.MOONSHINE_MODEL_ARCH
        self._transcriber = None
        logger.info("Moonshine service initialized.")

    @property
    def transcriber(self):
        """Lazy load the transcriber to avoid import errors if not used."""
        if self._transcriber is None:
            try:
                from moonshine_voice import Transcriber
                from moonshine_voice.moonshine_api import ModelArch
                logger.info(f"Loading Moonshine model from {self.model_path}...")
                self._transcriber = Transcriber(
                    model_path=self.model_path,
                    model_arch=ModelArch(self.model_arch)
                )
                logger.info("Moonshine model loaded.")
            except ImportError as e:
                logger.error(f"Failed to import moonshine_voice: {e}")
                logger.error("Please install moonshine-voice: pip install moonshine-voice")
                raise
            except Exception as e:
                logger.error(f"Failed to load Moonshine model: {e}")
                raise
        return self._transcriber

    def _convert_audio_to_wav(self, audio_path: str) -> str:
        """Convert audio file to WAV format required by Moonshine."""
        try:
            import ffmpeg
            wav_path = os.path.splitext(audio_path)[0] + ".wav"

            # Convert to mono 16kHz WAV (optimal for Moonshine)
            (
                ffmpeg.input(audio_path)
                .output(wav_path, ar=16000, ac=1)
                .overwrite_output()
                .run(capture_stdout=True, capture_stderr=True)
            )
            logger.debug(f"Converted audio to WAV: {wav_path}")
            return wav_path
        except Exception as e:
            logger.error(f"Error converting audio to WAV: {e}")
            # Fallback: just rename the file
            wav_path = os.path.splitext(audio_path)[0] + ".wav"
            import shutil
            shutil.copy(audio_path, wav_path)
            return wav_path

    def transcribe_audio(self, audio_path: str, language: str = "zh") -> dict:
        """
        Transcribes audio file to text using Moonshine.
        Returns result in Whisper-compatible format.
        """
        try:
            logger.debug(f"Transcribing audio file: {audio_path} (language: {language})")

            # Convert to WAV format required by Moonshine
            wav_path = self._convert_audio_to_wav(audio_path)

            # Read WAV file and convert to audio data array
            import wave
            import struct
            logger.debug(f"Reading WAV file and converting to audio data array")

            with wave.open(wav_path, 'rb') as wf:
                sample_rate = wf.getframerate()
                n_frames = wf.getnframes()
                raw_data = wf.readframes(n_frames)

                # Convert PCM bytes to float array (-1.0 to 1.0)
                # Moonshine expects 16-bit PCM
                audio_data = []
                for i in range(0, len(raw_data), 2):
                    # Unpack as signed 16-bit integer
                    sample = struct.unpack('<h', raw_data[i:i+2])[0]
                    # Convert to float in range [-1.0, 1.0]
                    audio_data.append(sample / 32768.0)

            logger.debug(f"Read {len(audio_data)} samples from WAV file, sample_rate={sample_rate}")

            # Use Moonshine to transcribe
            transcript = self.transcriber.transcribe_without_streaming(audio_data, sample_rate=sample_rate)
            logger.debug(f"Moonshine transcription completed")

            # Convert Moonshine transcript to Whisper-compatible format
            segments = []
            full_text_parts = []

            for line in transcript.lines:
                start_time = line.start_time
                duration = line.duration
                text = line.text.strip()

                if text:
                    segments.append({
                        "start": start_time,
                        "end": start_time + duration,
                        "text": text
                    })
                    full_text_parts.append(text)

            result = {
                "text": " ".join(full_text_parts),
                "segments": segments,
                "language": language
            }

            logger.debug(f"Transcription complete. Segments: {len(segments)}, Text length: {len(result['text'])}")

            # Cleanup WAV file
            if os.path.exists(wav_path) and wav_path != audio_path:
                os.remove(wav_path)
                logger.debug(f"Cleaned up temp WAV file: {wav_path}")

            return result

        except Exception as e:
            logger.error(f"Error transcribing audio with Moonshine: {e}")
            import traceback
            logger.error(traceback.format_exc())
            raise


class FunASRService:
    """FunASR (Paraformer) service for Chinese speech-to-text transcription."""

    def __init__(self):
        logger.info("Initializing FunASR service...")
        self._model = None
        logger.info("FunASR service initialized.")

    @property
    def model(self):
        """Lazy load the FunASR model to avoid import errors if not used."""
        if self._model is None:
            try:
                from funasr import AutoModel
                logger.info("Loading FunASR Paraformer model...")

                # Using Paraformer-large with VAD and punctuation.
                # NOTE: FunASR 1.x renamed the ModelScope namespace from
                # 'damo/...' to 'iic/...'. Old 'damo/' IDs are no longer
                # registered in the hub map and will raise "not registered".
                self._model = AutoModel(
                    model="iic/speech_paraformer-large-vad-punc_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
                    vad_model="iic/speech_fsmn_vad_zh-cn-16k-common-pytorch",
                    punc_model="iic/punc_ct-transformer_zh-cn-common-vocab272727-pytorch",
                    device="cpu",
                )
                logger.info("FunASR model loaded successfully.")
            except ImportError as e:
                logger.error(f"Failed to import funasr: {e}")
                logger.error("Please install: pip install funasr>=1.1.0 modelscope>=1.9.0")
                raise
            except Exception as e:
                logger.error(f"Failed to load FunASR model: {e}")
                raise
        return self._model

    def _convert_audio_to_wav(self, audio_path: str) -> str:
        """Convert audio file to WAV format required by FunASR (16kHz mono)."""
        try:
            import ffmpeg
            wav_path = os.path.splitext(audio_path)[0] + ".wav"

            # Convert to mono 16kHz WAV (optimal for FunASR Paraformer)
            (
                ffmpeg.input(audio_path)
                .output(wav_path, ar=16000, ac=1)
                .overwrite_output()
                .run(capture_stdout=True, capture_stderr=True)
            )
            logger.debug(f"Converted audio to WAV: {wav_path}")
            return wav_path
        except Exception as e:
            logger.error(f"Error converting audio to WAV: {e}")
            # Fallback: just copy the file
            wav_path = os.path.splitext(audio_path)[0] + ".wav"
            import shutil
            shutil.copy(audio_path, wav_path)
            return wav_path

    def transcribe_audio(self, audio_path: str, language: str = "zh") -> dict:
        """
        Transcribes audio file to text using FunASR Paraformer.
        Returns result in Whisper-compatible format for backward compatibility.
        """
        try:
            logger.debug(f"Transcribing audio file: {audio_path} (language: {language})")

            # Convert to WAV format required by FunASR (16kHz mono)
            wav_path = self._convert_audio_to_wav(audio_path)

            logger.debug(f"Starting FunASR transcription...")

            # Use FunASR to transcribe
            result = self.model.generate(
                input=[wav_path],
                batch_size_s=300,
                return_chunk_results=False
            )

            logger.debug(f"FunASR transcription completed: {result}")

            # Parse FunASR result and convert to Whisper-compatible format
            segments = []
            full_text_parts = []

            if result and len(result) > 0:
                first_result = result[0]
                full_text = first_result.get('text', '')
                timestamps = first_result.get('timestamp', [])

                if timestamps and len(timestamps) > 0:
                    text_parts = full_text.split()
                    for i, ts in enumerate(timestamps):
                        start_sec = ts[0] / 1000.0
                        end_sec = ts[1] / 1000.0
                        text = text_parts[i] if i < len(text_parts) else ""

                        if text.strip():
                            segments.append({
                                "start": start_sec,
                                "end": end_sec,
                                "text": text
                            })
                            full_text_parts.append(text)
                else:
                    segments.append({
                        "start": 0,
                        "end": 0,
                        "text": full_text
                    })
                    full_text_parts.append(full_text)

            if not segments and full_text.strip():
                segments.append({
                    "start": 0,
                    "end": 0,
                    "text": full_text
                })

            final_result = {
                "text": full_text if full_text else " ".join(full_text_parts),
                "segments": segments,
                "language": language
            }

            logger.debug(f"Transcription complete. Segments: {len(segments)}, Text length: {len(final_result['text'])}")

            # Cleanup WAV file
            if os.path.exists(wav_path) and wav_path != audio_path:
                os.remove(wav_path)
                logger.debug(f"Cleaned up temp WAV file: {wav_path}")

            return final_result

        except Exception as e:
            logger.error(f"Error transcribing audio with FunASR: {e}")
            import traceback
            logger.error(traceback.format_exc())
            raise


class WhisperService:
    """Whisper ASR service for speech-to-text transcription (legacy support)."""

    def __init__(self):
        logger.info("Initializing Whisper service...")
        self._model = None
        logger.info("Whisper service initialized.")

    @property
    def model(self):
        """Lazy load the Whisper model."""
        if self._model is None:
            try:
                import whisper
                logger.info("Loading Whisper medium model...")
                self._model = whisper.load_model("medium")
                logger.info("Whisper model loaded.")
            except ImportError as e:
                logger.error(f"Failed to import whisper: {e}")
                logger.error("Please install: pip install openai-whisper")
                raise
            except Exception as e:
                logger.error(f"Failed to load Whisper model: {e}")
                raise
        return self._model

    def _convert_audio_to_wav(self, audio_path: str) -> str:
        """Convert audio file to WAV format."""
        try:
            import ffmpeg
            wav_path = os.path.splitext(audio_path)[0] + ".wav"
            (
                ffmpeg.input(audio_path)
                .output(wav_path, ar=16000, ac=1)
                .overwrite_output()
                .run(capture_stdout=True, capture_stderr=True)
            )
            logger.debug(f"Converted audio to WAV: {wav_path}")
            return wav_path
        except Exception as e:
            logger.error(f"Error converting audio to WAV: {e}")
            wav_path = os.path.splitext(audio_path)[0] + ".wav"
            import shutil
            shutil.copy(audio_path, wav_path)
            return wav_path

    def transcribe_audio(self, audio_path: str, language: str = "zh") -> dict:
        """
        Transcribes audio file to text using Whisper.
        Returns result in Whisper-native format.
        """
        try:
            logger.debug(f"Transcribing audio file: {audio_path} (language: {language})")

            # Convert to WAV format
            wav_path = self._convert_audio_to_wav(audio_path)

            logger.debug(f"Starting Whisper transcription...")

            # Use Whisper to transcribe
            result = self.model.transcribe(wav_path, language=language if language != "zh" else "chinese")

            logger.debug(f"Whisper transcription completed")

            # Convert to standard format
            segments = []
            for seg in result.get('segments', []):
                segments.append({
                    "start": seg['start'],
                    "end": seg['end'],
                    "text": seg['text'].strip()
                })

            final_result = {
                "text": result.get('text', '').strip(),
                "segments": segments,
                "language": language
            }

            logger.debug(f"Transcription complete. Segments: {len(segments)}, Text length: {len(final_result['text'])}")

            # Cleanup WAV file
            if os.path.exists(wav_path) and wav_path != audio_path:
                os.remove(wav_path)
                logger.debug(f"Cleaned up temp WAV file: {wav_path}")

            return final_result

        except Exception as e:
            logger.error(f"Error transcribing audio with Whisper: {e}")
            import traceback
            logger.error(traceback.format_exc())
            raise


class VideoService:
    """Video processing service with configurable ASR backend."""

    def __init__(self, asr_model: ASRModel = ASRModel.FUNASR):
        self.asr_model = asr_model
        self._asr_service = None
        self._init_asr_service()
        logger.info(f"VideoService initialized with {asr_model.value.upper()} ASR.")

    def _init_asr_service(self):
        """Initialize the appropriate ASR service based on model selection."""
        if self.asr_model == ASRModel.MOONSHINE:
            self._asr_service = MoonshineService()
        elif self.asr_model == ASRModel.FUNASR:
            self._asr_service = FunASRService()
        else:  # WHISPER
            self._asr_service = WhisperService()

    @property
    def asr_service(self):
        """Get the current ASR service."""
        return self._asr_service

    def extract_audio(self, video_path: str) -> str:
        """Extracts audio from video and saves it as a temporary file."""
        try:
            logger.debug(f"Initializing VideoFileClip for {video_path}")
            video = VideoFileClip(video_path)

            # Sanitize filename for temp audio
            import re
            safe_basename = re.sub(r'[^\w\-_\.]', '_', os.path.basename(video_path))
            audio_path = os.path.join(settings.TEMP_DIR, f"{safe_basename}.mp3")

            logger.debug(f"Writing audio to {audio_path}")
            if video.audio is None:
                logger.warning("No audio track found in video")
                raise ValueError("No audio track found in video")

            video.audio.write_audiofile(audio_path, logger=None)
            video.close()
            return audio_path
        except Exception as e:
            logger.error(f"Error extracting audio: {e}")
            import traceback
            logger.error(traceback.format_exc())
            raise

    def transcribe_audio(self, audio_path: str, language: str = "zh") -> dict:
        """
        Transcribes audio file to text using the configured ASR.
        Returns result in Whisper-compatible format for backward compatibility.
        """
        return self._asr_service.transcribe_audio(audio_path, language)

    def capture_frame(self, video_path: str, time_pos: float = None, transcript_data: dict = None) -> str:
        """
        Captures a frame from the video.
        Uses smart detection if transcript_data is provided.
        """
        try:
            video = VideoFileClip(video_path)
            duration = video.duration

            if time_pos is not None:
                pass
            elif transcript_data:
                logger.info("Using smart key frame detection based on transcript")
                key_time = smart_frame_detector.find_key_frame(video_path, transcript_data)
                if key_time:
                    time_pos = key_time
                    logger.info(f"Smart detection selected frame at {time_pos:.2f}s")
                else:
                    time_pos = max(0, duration - 3.0)
                    logger.info("Smart detection failed, fallback to duration-3s")
            else:
                time_pos = max(0, duration - 3.0)

            if time_pos > duration:
                time_pos = duration - 0.1
            if time_pos < 0:
                time_pos = 0

            frame_filename = f"{os.path.basename(video_path)}_{int(time_pos)}.jpg"

            output_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "public", "screenshots")
            if not os.path.exists(output_dir):
                os.makedirs(output_dir)

            output_path = os.path.join(output_dir, frame_filename)
            video.save_frame(output_path, t=time_pos)
            video.close()

            return f"/screenshots/{frame_filename}"
        except Exception as e:
            logger.error(f"Error capturing frame: {e}")
            return ""


# Create global instance with default ASR model (can be overridden per-request)
video_service = VideoService()
