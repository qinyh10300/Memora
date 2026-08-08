from __future__ import annotations

import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage
from threading import Lock
from typing import Literal, Protocol

from memora.settings import Settings

VerificationCodePurpose = Literal["REGISTER", "LOGIN"]


class VerificationCodeDeliveryError(RuntimeError):
    pass


class VerificationCodeSender(Protocol):
    @property
    def available(self) -> bool: ...

    def send(self, *, email: str, code: str, purpose: VerificationCodePurpose) -> None: ...


class DisabledVerificationCodeSender:
    @property
    def available(self) -> bool:
        return False

    def send(self, *, email: str, code: str, purpose: VerificationCodePurpose) -> None:
        del email, code, purpose
        raise VerificationCodeDeliveryError("邮箱验证码服务尚未配置")


@dataclass(frozen=True)
class DeliveredVerificationCode:
    email: str
    code: str
    purpose: VerificationCodePurpose


class InMemoryVerificationCodeSender:
    """Test-only sender. Codes stay in process memory and never enter logs or API responses."""

    def __init__(self) -> None:
        self._messages: list[DeliveredVerificationCode] = []
        self._lock = Lock()

    @property
    def available(self) -> bool:
        return True

    def send(self, *, email: str, code: str, purpose: VerificationCodePurpose) -> None:
        with self._lock:
            self._messages.append(
                DeliveredVerificationCode(email=email, code=code, purpose=purpose)
            )

    def latest_code(self, *, email: str, purpose: VerificationCodePurpose) -> str | None:
        with self._lock:
            for message in reversed(self._messages):
                if message.email == email and message.purpose == purpose:
                    return message.code
        return None

    def delivered_count(self, *, email: str, purpose: VerificationCodePurpose) -> int:
        with self._lock:
            return sum(
                message.email == email and message.purpose == purpose for message in self._messages
            )


class SmtpVerificationCodeSender:
    def __init__(self, settings: Settings) -> None:
        self._host = settings.email_smtp_host
        self._port = settings.email_smtp_port
        self._username = settings.email_smtp_username
        self._password = settings.email_smtp_password.get_secret_value()
        self._from_email = settings.email_smtp_from_email
        self._starttls = settings.email_smtp_starttls
        self._use_ssl = settings.email_smtp_use_ssl
        self._timeout = settings.email_smtp_timeout_seconds
        self._ttl_minutes = max(1, (settings.email_verification_code_ttl_seconds + 59) // 60)

    @property
    def available(self) -> bool:
        return True

    def send(self, *, email: str, code: str, purpose: VerificationCodePurpose) -> None:
        action = "注册" if purpose == "REGISTER" else "登录"
        message = EmailMessage()
        message["Subject"] = f"Memora {action}验证码"
        message["From"] = self._from_email
        message["To"] = email
        message.set_content(
            f"你的 Memora {action}验证码是：{code}\n\n"
            f"验证码将在 {self._ttl_minutes} 分钟内失效，请勿转发给任何人。\n"
            "如果不是你发起的请求，可以忽略这封邮件。"
        )

        try:
            context = ssl.create_default_context()
            client_context: smtplib.SMTP
            if self._use_ssl:
                client_context = smtplib.SMTP_SSL(
                    self._host,
                    self._port,
                    timeout=self._timeout,
                    context=context,
                )
            else:
                client_context = smtplib.SMTP(
                    self._host,
                    self._port,
                    timeout=self._timeout,
                )
            with client_context as client:
                if self._starttls:
                    client.starttls(context=context)
                if self._username:
                    client.login(self._username, self._password)
                client.send_message(message)
        except (OSError, smtplib.SMTPException) as error:
            raise VerificationCodeDeliveryError("验证码邮件发送失败") from error


def build_verification_code_sender(settings: Settings) -> VerificationCodeSender:
    if settings.app_env == "test":
        return InMemoryVerificationCodeSender()
    if not settings.email_verification_enabled:
        return DisabledVerificationCodeSender()
    return SmtpVerificationCodeSender(settings)
