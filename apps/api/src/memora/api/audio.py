from __future__ import annotations

from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from memora.ai.openai_compatible import build_speech_to_text
from memora.ai.ports import AIProviderError
from memora.audit.models import AuditEvent
from memora.database import DatabaseSession
from memora.identity.dependencies import CurrentPrincipal
from memora.settings import Settings, get_settings

router = APIRouter(prefix="/audio", tags=["audio"])

MIN_AUDIO_BYTES = 32
MAX_TRANSCRIPT_CHARS = 12_000
SUPPORTED_AUDIO_TYPES = {
    "audio/m4a": "voice.m4a",
    "audio/mp4": "voice.mp4",
    "audio/mpeg": "voice.mp3",
    "audio/ogg": "voice.ogg",
    "audio/wav": "voice.wav",
    "audio/webm": "voice.webm",
    "audio/x-m4a": "voice.m4a",
    "audio/x-wav": "voice.wav",
}


class SpeechTranscriptionResponse(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TRANSCRIPT_CHARS)
    model: str = Field(min_length=1, max_length=160)


def _valid_audio_signature(content: bytes, media_type: str) -> bool:
    if media_type == "audio/webm":
        return content.startswith(b"\x1a\x45\xdf\xa3")
    if media_type == "audio/ogg":
        return content.startswith(b"OggS")
    if media_type in {"audio/mp4", "audio/m4a", "audio/x-m4a"}:
        return len(content) >= 12 and content[4:8] == b"ftyp"
    if media_type == "audio/mpeg":
        return content.startswith(b"ID3") or (
            len(content) >= 2 and content[0] == 0xFF and content[1] & 0xE0 == 0xE0
        )
    if media_type in {"audio/wav", "audio/x-wav"}:
        return content.startswith(b"RIFF") and content[8:12] == b"WAVE"
    return False


async def _read_limited_audio(request: Request, maximum_bytes: int) -> bytes:
    declared_length = request.headers.get("content-length")
    if declared_length:
        try:
            if int(declared_length) > maximum_bytes:
                raise HTTPException(
                    status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                    detail="录音文件过大",
                )
        except ValueError as error:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Content-Length 无效",
            ) from error

    content = bytearray()
    async for chunk in request.stream():
        content.extend(chunk)
        if len(content) > maximum_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail="录音文件过大",
            )
    return bytes(content)


@router.post(
    "/transcriptions",
    response_model=SpeechTranscriptionResponse,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                media_type: {"schema": {"type": "string", "format": "binary"}}
                for media_type in SUPPORTED_AUDIO_TYPES
            },
        }
    },
)
async def transcribe_audio(
    request: Request,
    principal: CurrentPrincipal,
    database: DatabaseSession,
    settings: Annotated[Settings, Depends(get_settings)],
) -> SpeechTranscriptionResponse:
    media_type = request.headers.get("content-type", "").partition(";")[0].strip().lower()
    filename = SUPPORTED_AUDIO_TYPES.get(media_type)
    if filename is None:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="不支持这种录音格式",
        )

    audio = await _read_limited_audio(request, settings.ai_speech_max_audio_bytes)
    if len(audio) < MIN_AUDIO_BYTES or not _valid_audio_signature(audio, media_type):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="录音内容无效",
        )

    speech_to_text = build_speech_to_text(settings)
    if speech_to_text is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="语音输入尚未配置",
        )

    if not request.app.state.ai_rate_limiter.consume(f"speech:{principal.user_id}"):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="语音转写请求过于频繁，请稍后重试",
        )

    # Authentication has read from the session. Close that transaction before the
    # potentially slow external provider request.
    database.commit()
    try:
        result = speech_to_text.transcribe(
            audio,
            filename=filename,
            media_type=media_type,
            language=settings.ai_speech_language.strip() or None,
        )
    except AIProviderError as error:
        provider_status = (
            status.HTTP_429_TOO_MANY_REQUESTS
            if error.code == "rate_limited"
            else status.HTTP_503_SERVICE_UNAVAILABLE
        )
        raise HTTPException(
            status_code=provider_status,
            detail="语音转写暂时不可用，请稍后重试",
        ) from error

    transcript = result.text.strip()
    if not transcript or len(transcript) > MAX_TRANSCRIPT_CHARS:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="语音转写结果无效",
        )

    database.add(
        AuditEvent(
            workspace_id=principal.workspace_id,
            actor_id=principal.user_id,
            action="AUDIO_TRANSCRIBED",
            resource_type="AUDIO_TRANSCRIPTION",
            resource_id=uuid4(),
            model=result.model,
            input_tokens=result.usage.input_tokens,
            output_tokens=result.usage.output_tokens,
        )
    )
    database.commit()
    return SpeechTranscriptionResponse(text=transcript, model=result.model)
