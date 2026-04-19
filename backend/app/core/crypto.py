"""
密码加密工具 — 存储第三方服务密码（如 SMTP）时用 Fernet 加密
Password encryption utility — Fernet-based for storing SMTP passwords etc.

Key source:
  1. 优先用 EMAIL_ENCRYPTION_KEY env var（生产环境必须设置）
  2. 回退到从 SECRET_KEY 派生（开发/测试可用，但切换 SECRET_KEY 会导致旧密码无法解密）

⚠️ 切勿把加密密钥提交到 git。.env 已在 .gitignore 里。
"""

import base64
import hashlib
import os
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings


@lru_cache(maxsize=1)
def _get_fernet() -> Fernet:
    """延迟初始化 Fernet 实例 — 密钥优先从 env 读，否则派生自 SECRET_KEY"""
    explicit = os.getenv("EMAIL_ENCRYPTION_KEY")
    if explicit:
        # 用户提供的 key 必须是 urlsafe-base64 编码的 32 字节
        return Fernet(explicit.encode())

    # 回退：从 SECRET_KEY 确定性派生（SHA-256 → 32 bytes → urlsafe base64）
    digest = hashlib.sha256(settings.SECRET_KEY.encode()).digest()
    key = base64.urlsafe_b64encode(digest)
    return Fernet(key)


def encrypt_password(plaintext: str) -> str:
    """明文 → 加密 token（ASCII 字符串，可直接存 DB）"""
    if not plaintext:
        return ""
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt_password(token: str) -> str:
    """加密 token → 明文。密钥轮换/token 损坏时抛 InvalidToken"""
    if not token:
        return ""
    try:
        return _get_fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        # 密钥变了导致解密失败 —— 记录但不抛错，让调用方识别"需要用户重新输入密码"
        raise ValueError("Password decryption failed — key may have rotated")
