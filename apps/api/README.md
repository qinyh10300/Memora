# Memora API

FastAPI 模块化后端与后台 worker 的工程骨架。

## 本地命令

在 `apps/api` 目录执行：

```bash
uv sync --frozen
uv run uvicorn memora.main:app --reload
uv run memora-worker --once
uv run pytest
```

API 默认提供：

- `GET /health`：进程存活检查，不依赖数据库连接。
- `GET /ready`：就绪检查，会验证数据库连接。
- `GET /docs`：由 OpenAPI 生成的交互式文档。

业务模块将在后续里程碑按 `docs/architecture/overview.md` 的边界加入。
