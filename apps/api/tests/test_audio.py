from collections.abc import Iterator
from typing import cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import select
from sqlalchemy.orm import Session

from memora.ai.ports import AIProviderError, ModelUsage, SpeechTranscriptionResult
from memora.audit.models import AuditEvent
from memora.database import Base
from memora.identity.dependencies import SESSION_COOKIE_NAME
from memora.identity.seed import seed_database
from memora.main import create_app
from memora.settings import Settings


class CaptureSpeechToText:
    model_id = "speech-model-v1"

    def __init__(self) -> None:
        self.request: tuple[bytes, str, str, str | None] | None = None

    def transcribe(
        self,
        audio: bytes,
        *,
        filename: str,
        media_type: str,
        language: str | None = None,
    ) -> SpeechTranscriptionResult:
        self.request = (audio, filename, media_type, language)
        return SpeechTranscriptionResult(
            text="  帮我整理今天的会议重点。  ",
            model=self.model_id,
            usage=ModelUsage(input_tokens=11, output_tokens=7),
        )


@pytest.fixture
def audio_client() -> Iterator[TestClient]:
    settings = Settings(
        app_env="test",
        database_url="sqlite+pysqlite:///:memory:",
        session_secret="audio-test-secret-not-for-production",
        ai_speech_api_key=SecretStr("test-key"),
        ai_speech_model="speech-model-v1",
        ai_speech_language="zh",
        ai_speech_max_audio_bytes=1024,
    )
    app = create_app(settings)
    with TestClient(app) as client:
        Base.metadata.create_all(app.state.engine)
        seed_database(app.state.engine, settings)
        yield client


def _login(client: TestClient) -> dict[str, str]:
    response = client.post(
        "/auth/login",
        json={"email": "alex@memora.local", "password": "memora-local-alex"},
    )
    assert response.status_code == 200
    token = response.cookies.get(SESSION_COOKIE_NAME)
    assert token
    return {"Cookie": f"{SESSION_COOKIE_NAME}={token}"}


def _webm_audio(size: int = 64) -> bytes:
    return b"\x1a\x45\xdf\xa3" + b"\x00" * (size - 4)


def test_audio_transcription_requires_authentication(audio_client: TestClient) -> None:
    response = audio_client.post(
        "/audio/transcriptions",
        content=_webm_audio(),
        headers={"Content-Type": "audio/webm"},
    )

    assert response.status_code == 401


def test_audio_transcription_forwards_valid_audio_and_audits_metadata_only(
    audio_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = _login(audio_client)
    speech_to_text = CaptureSpeechToText()
    monkeypatch.setattr(
        "memora.api.audio.build_speech_to_text",
        lambda _settings: speech_to_text,
    )
    audio = _webm_audio()

    response = audio_client.post(
        "/audio/transcriptions",
        content=audio,
        headers={**headers, "Content-Type": "audio/webm;codecs=opus"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "text": "帮我整理今天的会议重点。",
        "model": "speech-model-v1",
    }
    assert speech_to_text.request == (audio, "voice.webm", "audio/webm", "zh")

    engine = cast(FastAPI, audio_client.app).state.engine
    with Session(engine) as database:
        event = database.scalar(select(AuditEvent).where(AuditEvent.action == "AUDIO_TRANSCRIBED"))
    assert event is not None
    assert event.resource_type == "AUDIO_TRANSCRIPTION"
    assert event.model == "speech-model-v1"
    assert (event.input_tokens, event.output_tokens) == (11, 7)


@pytest.mark.parametrize(
    ("media_type", "content", "expected_status"),
    [
        ("application/octet-stream", _webm_audio(), 415),
        ("audio/webm", b"not-a-valid-webm-recording" * 2, 422),
        ("audio/webm", _webm_audio(1025), 413),
    ],
)
def test_audio_transcription_rejects_unsupported_invalid_or_oversized_content(
    audio_client: TestClient,
    media_type: str,
    content: bytes,
    expected_status: int,
) -> None:
    response = audio_client.post(
        "/audio/transcriptions",
        content=content,
        headers={**_login(audio_client), "Content-Type": media_type},
    )

    assert response.status_code == expected_status


def test_audio_transcription_handles_missing_configuration_and_provider_failure(
    audio_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = _login(audio_client)
    monkeypatch.setattr("memora.api.audio.build_speech_to_text", lambda _settings: None)
    unconfigured = audio_client.post(
        "/audio/transcriptions",
        content=_webm_audio(),
        headers={**headers, "Content-Type": "audio/webm"},
    )
    assert unconfigured.status_code == 503
    assert unconfigured.json() == {"detail": "语音输入尚未配置"}

    class FailingSpeechToText(CaptureSpeechToText):
        def transcribe(
            self,
            audio: bytes,
            *,
            filename: str,
            media_type: str,
            language: str | None = None,
        ) -> SpeechTranscriptionResult:
            raise AIProviderError("provider_unavailable", retryable=True)

    monkeypatch.setattr(
        "memora.api.audio.build_speech_to_text",
        lambda _settings: FailingSpeechToText(),
    )
    unavailable = audio_client.post(
        "/audio/transcriptions",
        content=_webm_audio(),
        headers={**headers, "Content-Type": "audio/webm"},
    )
    assert unavailable.status_code == 503
    assert unavailable.json() == {"detail": "语音转写暂时不可用，请稍后重试"}
