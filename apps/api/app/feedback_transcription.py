from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path
from typing import Any

import whisper
from fastapi import HTTPException, UploadFile, status

MAX_AUDIO_SECONDS = 30
WHISPER_MODEL_NAME = "base"

_model = None


def get_whisper_model():
    global _model

    if _model is None:
        _model = whisper.load_model(WHISPER_MODEL_NAME)

    return _model


def get_audio_duration_seconds(wav_path: Path) -> float:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(wav_path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )

    return float(result.stdout.strip())


def convert_to_wav(input_path: Path, output_path: Path) -> None:
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(input_path),
            "-ar",
            "16000",
            "-ac",
            "1",
            str(output_path),
        ],
        check=True,
        capture_output=True,
    )


async def transcribe_upload(audio: UploadFile) -> dict[str, Any]:
    suffix = Path(audio.filename or "audio.webm").suffix or ".webm"

    input_file = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    wav_file = tempfile.NamedTemporaryFile(delete=False, suffix=".wav")
    input_path = Path(input_file.name)
    wav_path = Path(wav_file.name)
    input_file.close()
    wav_file.close()

    try:
        audio_bytes = await audio.read()
        input_path.write_bytes(audio_bytes)

        convert_to_wav(input_path, wav_path)
        duration_seconds = get_audio_duration_seconds(wav_path)

        if duration_seconds > MAX_AUDIO_SECONDS:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Audio must be 30 seconds or shorter",
            )

        model = get_whisper_model()
        result = model.transcribe(str(wav_path))

        return {
            "transcript": str(result.get("text", "")).strip(),
            "duration_seconds": duration_seconds,
            "language": result.get("language"),
        }
    finally:
        input_path.unlink(missing_ok=True)
        wav_path.unlink(missing_ok=True)