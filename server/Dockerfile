# OpenAI proxy（managed key 路線）容器
FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY openai_proxy.py .

# Fly.io / Render 等會注入 PORT；預設 8080
ENV PORT=8080
EXPOSE 8080

# OPENAI_API_KEY 與 APP_PROXY_TOKEN 由部署平台的 secret 注入，勿寫進 image
CMD ["python", "openai_proxy.py"]
