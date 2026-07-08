from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path
from typing import Any

import whisper
from fastapi import HTTPException, UploadFile, status
from fastapi.concurrency import run_in_threadpool

MAX_AUDIO_SECONDS = 30
WHISPER_MODEL_NAME = "base"

_model = None


def get_whisper_model():
    global _model

    if _model is None:
        _model = whisper.load_model(WHISPER_MODEL_NAME)

    return _model


def preload_whisper_model() -> None:
    get_whisper_model()


def get_audio_duration_seconds(wav_path: Path) -> float:
    result = run_audio_command(
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
        text=True,
    )

    try:
        return float(result.stdout.strip())
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or unsupported audio file",
        ) from exc


def convert_to_wav(input_path: Path, output_path: Path) -> None:
    run_audio_command(
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

        return await run_in_threadpool(transcribe_audio_file, input_path, wav_path)
    finally:
        input_path.unlink(missing_ok=True)
        wav_path.unlink(missing_ok=True)


def run_audio_command(args: list[str], text: bool = False) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(
            args,
            check=True,
            capture_output=True,
            text=text,
        )
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="ffmpeg/ffprobe not installed on server",
        ) from exc
    except subprocess.CalledProcessError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or unsupported audio file",
        ) from exc


def transcribe_audio_file(input_path: Path, wav_path: Path) -> dict[str, Any]:
    input_duration = get_audio_duration_seconds(input_path)

    if input_duration > MAX_AUDIO_SECONDS:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Audio must be 30 seconds or shorter",
        )

    convert_to_wav(input_path, wav_path)
    duration_seconds = get_audio_duration_seconds(wav_path)

    model = get_whisper_model()
    result = model.transcribe(str(wav_path))

    return {
        "transcript": str(result.get("text", "")).strip(),
        "duration_seconds": duration_seconds,
        "language": result.get("language"),
    }
