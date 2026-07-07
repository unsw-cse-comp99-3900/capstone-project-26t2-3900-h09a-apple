from pathlib import Path

import pytest
from fastapi import HTTPException

from app import feedback_transcription as transcription


class FakeUploadFile:
    filename = "feedback.webm"

    async def read(self):
        return b"fake-audio-bytes"


class FakeModel:
    def transcribe(self, wav_path: str):
        return {
            "text": " This is a test transcript. ",
            "language": "en",
        }


@pytest.fixture(autouse=True)
def reset_model_cache():
    transcription._model = None
    yield
    transcription._model = None


def test_get_whisper_model_loads_model_once(monkeypatch):
    calls = []

    def fake_load_model(model_name):
        calls.append(model_name)
        return FakeModel()

    monkeypatch.setattr(transcription.whisper, "load_model", fake_load_model)

    first = transcription.get_whisper_model()
    second = transcription.get_whisper_model()

    assert first is second
    assert calls == ["base"]


@pytest.mark.anyio
async def test_transcribe_upload_returns_transcript_and_deletes_temp_files(monkeypatch):
    deleted_paths = []

    monkeypatch.setattr(transcription, "convert_to_wav", lambda input_path, output_path: None)
    monkeypatch.setattr(transcription, "get_audio_duration_seconds", lambda wav_path: 10.0)
    monkeypatch.setattr(transcription, "get_whisper_model", lambda: FakeModel())

    original_unlink = Path.unlink

    def fake_unlink(self, missing_ok=False):
        deleted_paths.append(self)

    monkeypatch.setattr(Path, "unlink", fake_unlink)

    result = await transcription.transcribe_upload(FakeUploadFile())

    assert result == {
        "transcript": "This is a test transcript.",
        "duration_seconds": 10.0,
        "language": "en",
    }
    assert len(deleted_paths) == 2

    monkeypatch.setattr(Path, "unlink", original_unlink)


@pytest.mark.anyio
async def test_transcribe_upload_rejects_audio_longer_than_30_seconds(monkeypatch):
    monkeypatch.setattr(transcription, "convert_to_wav", lambda input_path, output_path: None)
    monkeypatch.setattr(transcription, "get_audio_duration_seconds", lambda wav_path: 31.0)

    with pytest.raises(HTTPException) as exc_info:
        await transcription.transcribe_upload(FakeUploadFile())

    assert exc_info.value.status_code == 413