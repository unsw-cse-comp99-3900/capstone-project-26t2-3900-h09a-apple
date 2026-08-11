"""
Local Whisper transcription for short voice-feedback uploads.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import whisper
from fastapi import HTTPException, UploadFile, status
from fastapi.concurrency import run_in_threadpool

MAX_AUDIO_SECONDS = 60
WHISPER_MODEL_NAME = "base"

_model = None
_audio_tool_cache: dict[str, str] = {}


def get_whisper_model():
    global _model

    if _model is None:
        _model = whisper.load_model(WHISPER_MODEL_NAME)

    return _model


def preload_whisper_model() -> None:
    get_whisper_model()


def resolve_audio_tool(name: str) -> str:
    """Resolve ffmpeg/ffprobe even when uvicorn was started without updated PATH."""
    cached = _audio_tool_cache.get(name)
    if cached is not None:
        return cached

    env_key = f"{name.upper()}_PATH"
    env_path = os.environ.get(env_key)
    if env_path and Path(env_path).is_file():
        _audio_tool_cache[name] = env_path
        return env_path

    found = shutil.which(name)
    if found:
        _audio_tool_cache[name] = found
        return found

    winget_root = Path.home() / "AppData/Local/Microsoft/WinGet/Packages"
    if winget_root.is_dir():
        matches = sorted(winget_root.glob(f"Gyan.FFmpeg*/ffmpeg-*/bin/{name}.exe"))
        if matches:
            resolved = str(matches[-1])
            _audio_tool_cache[name] = resolved
            return resolved

    _audio_tool_cache[name] = name
    return name


def get_audio_duration_seconds(wav_path: Path) -> float:
    result = run_audio_command(
        [
            resolve_audio_tool("ffprobe"),
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
            resolve_audio_tool("ffmpeg"),
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
    audio_bytes = await audio.read()
    return await transcribe_audio_bytes(audio_bytes, suffix=suffix)


async def transcribe_audio_bytes(audio_bytes: bytes, *, suffix: str = ".webm") -> dict[str, Any]:
    if not audio_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Audio body is empty",
        )

    input_file = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    wav_file = tempfile.NamedTemporaryFile(delete=False, suffix=".wav")
    input_path = Path(input_file.name)
    wav_path = Path(wav_file.name)
    input_file.close()
    wav_file.close()

    try:
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
            detail=f"Audio must be {MAX_AUDIO_SECONDS} seconds or shorter",
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
