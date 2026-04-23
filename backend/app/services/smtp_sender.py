"""
SMTP 邮件发送服务 — 通用 SMTP/IMAP 邮箱（Hostinger、自定义域名等）
Generic SMTP sender for non-OAuth email accounts.

使用 aiosmtplib 异步发送。提供：
  - test_connection(): 登录验证凭据
  - send_mail(): 发送邮件

三种加密模式 encryption modes:
  - ssl      → 端口 465, 隐式 SSL/TLS
  - starttls → 端口 587, 先明文再升级为 TLS
  - none     → 端口 25, 不加密（几乎不用）
"""

from __future__ import annotations

from email.message import EmailMessage
from typing import Optional

import aiosmtplib


class SMTPError(Exception):
    """统一的 SMTP 错误类型，前端能拿到人类可读的 message"""


async def test_connection(
    *,
    host: str,
    port: int,
    username: str,
    password: str,
    encryption: str = "ssl",
    timeout: float = 15.0,
) -> None:
    """
    连接并登录 SMTP 服务器验证凭据。
    aiosmtplib 4.x: use_tls vs start_tls 两个独立参数
      - ssl:      use_tls=True（465 隐式 TLS）
      - starttls: start_tls=True（587 自动升级）—— 由 connect() 处理，不要手动 starttls()
    成功：无返回值。失败：抛 SMTPError(message)。
    """
    try:
        if encryption == "ssl":
            client = aiosmtplib.SMTP(hostname=host, port=port, use_tls=True, timeout=timeout)
        elif encryption == "starttls":
            client = aiosmtplib.SMTP(hostname=host, port=port, start_tls=True, timeout=timeout)
        else:
            client = aiosmtplib.SMTP(hostname=host, port=port, timeout=timeout)

        await client.connect()
        try:
            await client.login(username, password)
        finally:
            await client.quit()
    except aiosmtplib.SMTPAuthenticationError as e:
        raise SMTPError(f"认证失败（用户名/密码错误）: {e}")
    except aiosmtplib.SMTPConnectError as e:
        raise SMTPError(f"无法连接到服务器 {host}:{port}: {e}")
    except aiosmtplib.SMTPServerDisconnected as e:
        raise SMTPError(f"服务器断开连接: {e}")
    except TimeoutError:
        raise SMTPError(f"连接 {host}:{port} 超时（{timeout}s）")
    except Exception as e:
        raise SMTPError(f"SMTP 测试失败: {type(e).__name__}: {e}")


async def send_mail(
    *,
    host: str,
    port: int,
    username: str,
    password: str,
    encryption: str,
    from_email: str,
    from_name: Optional[str],
    to_email: str,
    subject: str,
    body: str,
    body_html: Optional[str] = None,
    timeout: float = 30.0,
) -> str:
    """
    发送邮件。返回 message-id (aiosmtplib 底层不直接返回，这里生成一个简易标识)。
    失败抛 SMTPError。
    """
    msg = EmailMessage()
    if from_name:
        msg["From"] = f"{from_name} <{from_email}>"
    else:
        msg["From"] = from_email
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(body)
    if body_html:
        msg.add_alternative(body_html, subtype="html")

    try:
        if encryption == "ssl":
            result = await aiosmtplib.send(
                msg,
                hostname=host, port=port,
                username=username, password=password,
                use_tls=True, timeout=timeout,
            )
        elif encryption == "starttls":
            result = await aiosmtplib.send(
                msg,
                hostname=host, port=port,
                username=username, password=password,
                start_tls=True, timeout=timeout,
            )
        else:
            result = await aiosmtplib.send(
                msg,
                hostname=host, port=port,
                username=username, password=password,
                timeout=timeout,
            )
    except aiosmtplib.SMTPAuthenticationError as e:
        raise SMTPError(f"SMTP 认证失败: {e}")
    except aiosmtplib.SMTPRecipientsRefused as e:
        raise SMTPError(f"收件人被拒绝 {to_email}: {e}")
    except aiosmtplib.SMTPSenderRefused as e:
        raise SMTPError(f"发件人被拒绝 {from_email}: {e}")
    except Exception as e:
        raise SMTPError(f"发送失败: {type(e).__name__}: {e}")

    # 返回简单的成功标记（aiosmtplib 成功时返回 (errors, response_str)）
    return str(result[1]) if result else "sent"
