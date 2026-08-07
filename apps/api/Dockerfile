FROM python:3.13-slim AS runtime

ARG UV_VERSION=0.11.6

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV UV_COMPILE_BYTECODE=1
ENV UV_LINK_MODE=copy

RUN apt-get update \
    && apt-get install --no-install-recommends --yes \
        poppler-utils \
        tesseract-ocr \
        tesseract-ocr-chi-sim \
        tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir "uv==${UV_VERSION}" \
    && groupadd --system --gid 1001 memora \
    && useradd --system --uid 1001 --gid memora --create-home memora

WORKDIR /app

COPY apps/api/pyproject.toml apps/api/uv.lock apps/api/README.md ./
RUN uv sync --frozen --no-dev --no-install-project

COPY apps/api/src ./src
COPY apps/api/alembic.ini ./alembic.ini
COPY apps/api/migrations ./migrations

RUN uv sync --frozen --no-dev \
    && chown -R memora:memora /app

USER memora

EXPOSE 8000

CMD ["uv", "run", "--no-sync", "uvicorn", "memora.main:app", "--host", "0.0.0.0", "--port", "8000"]
