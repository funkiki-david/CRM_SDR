# === SDR CRM 后端 Dockerfile ===
# 基于 Python 3.12 精简版

FROM python:3.12-slim

# 设置工作目录
WORKDIR /app

# 安装系统依赖（PostgreSQL 客户端库编译需要）
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev && \
    rm -rf /var/lib/apt/lists/*

# 先复制依赖文件，利用 Docker 缓存（依赖不变时不重新安装）
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制所有代码
COPY . .

# 启动 FastAPI 服务（--reload 开启热更新，代码改动自动重启）
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
