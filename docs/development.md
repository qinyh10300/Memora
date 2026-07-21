# Memora Development Guide

本文档说明 Memora 的本地开发、验证、配置和容器运行方式。产品与架构规则仍以 `docs/product/brief.md`、`docs/architecture/overview.md` 和 ADR 为准。

## Required tools

| Tool | Baseline | Purpose |
|---|---:|---|
| Node.js | 22 | Next.js 构建与运行 |
| pnpm | 11.9.0 | JavaScript workspace 与锁文件 |
| Python | 3.13 | FastAPI 与 worker |
| uv | 0.11+ | Python 环境、锁文件与命令 |
| Docker Compose | current `docker compose` plugin | PostgreSQL、完整环境与容器验证 |
| make | 3.81+ | 稳定的仓库级命令入口 |
| curl | current | smoke test 与健康检查 |

Node 版本记录在 `.nvmrc`，Python 版本记录在 `.python-version`。pnpm 和 Python 依赖分别由 `pnpm-lock.yaml` 与 `apps/api/uv.lock` 固定。

### macOS container runtime

macOS 需要一个 Linux 虚拟机来运行容器。若不使用 Docker Desktop，推荐安装 Docker CLI、Compose、Buildx 和 Colima：

```bash
brew install colima docker docker-compose docker-buildx
colima start --runtime docker --vm-type vz --cpu 4 --memory 8 --disk 60
docker run --rm hello-world
```

Homebrew 安装的 CLI 插件位于 `/opt/homebrew/lib/docker/cli-plugins`。确保 `~/.docker/config.json` 的现有 JSON 中合并以下配置；不要直接覆盖已有的 registry、credential helper 或其他设置：

```json
{
  "cliPluginsExtraDirs": ["/opt/homebrew/lib/docker/cli-plugins"]
}
```

日常可用以下命令管理轻量虚拟机。`colima stop` 会停止运行时但保留镜像和数据；下次 `colima start` 可继续使用。

```bash
colima status
colima start
colima stop
```

Apple Silicon 本机已在 2026-07-21 使用 4 CPU、8 GiB 内存和 60 GiB 磁盘完成完整 Compose 构建与 smoke test。Linux 服务器直接使用 Docker Engine，不需要 Colima。

## First-time setup

```bash
make setup
```

该命令执行三件事：

1. 如果本地不存在 `.env`，从 `.env.example` 复制一个占位配置。
2. 使用 `pnpm install --frozen-lockfile` 安装 Web 依赖。
3. 使用 `uv sync --frozen` 创建 API 虚拟环境并安装锁定依赖。

命令不会覆盖已有 `.env`。本地 `.env` 已被 Git 忽略，不应通过补丁、提交或聊天传递真实 Key。

## Full environment with Docker

```bash
make dev
```

`make dev` 在前台显示服务日志。需要让环境在后台持续运行时，可以执行：

```bash
docker compose up --detach --build
```

Compose 按以下顺序启动：

1. PostgreSQL/pgvector 通过健康检查。
2. `migrate` 一次性服务执行 Alembic 到 `head`。
3. API 和 worker 启动；API 的 `/ready` 验证数据库连接。
4. Web 启动并通过 `/health`。
5. Caddy 在默认端口 `8080` 暴露 Web，并将 `/api/*` 去除前缀后转发给 FastAPI。

验证运行环境：

```bash
./scripts/wait-for-services.sh
make e2e
```

停止或观察环境：

```bash
make logs
make down
```

默认本地地址：

- Web：`http://localhost:8080`
- Web liveness：`http://localhost:8080/health`
- API liveness：`http://localhost:8080/api/health`
- API readiness：`http://localhost:8080/api/ready`
- API 文档：`http://localhost:8080/api/docs`

首次启动会幂等创建以下本地测试账号：

| 显示名 | 邮箱 | 本地初始密码 |
|---|---|---|
| Alex | `alex@memora.local` | `memora-local-alex` |
| Blair | `blair@memora.local` | `memora-local-blair` |
| Casey | `casey@memora.local` | `memora-local-casey` |
| Devon | `devon@memora.local` | `memora-local-devon` |

这些是提交到仓库的非生产开发凭据，只能用于本机。公网部署前必须通过 `SEED_USER_1_*` 到 `SEED_USER_4_*` 环境变量覆盖邮箱、显示名和每个账号的独立初始密码；生产 seed 会拒绝上述 `memora-local-*` 密码。seed 是幂等的，不会在每次启动时覆盖已有账号密码。

本地与单台 Linux 服务器使用同一份 `compose.yaml` 和镜像构建方式，环境差异只通过 `.env` 注入。服务器部署时必须替换数据库密码、会话密钥、AI 配置和 `CADDY_SITE_ADDRESS`，并在 M7 完成 HTTPS、备份恢复和部署 smoke test 后才视为可公开测试。

## Native hot-reload development

需要更快的代码反馈时，只用容器启动数据库：

```bash
make db
```

分别在两个终端运行：

```bash
make api-dev
make web-dev
```

Web 通过同源 `/api` 和由 OpenAPI 生成的类型化客户端调用后端；`next.config.ts` 在原生热更新模式下把该路径代理到 `API_BASE_URL`（默认 `http://localhost:8000`）。不能把服务端密钥暴露为 `NEXT_PUBLIC_*` 变量。

## Quality commands

| Command | Checks |
|---|---|
| `make format` | 使用 Prettier 和 Ruff 写入统一格式 |
| `make format-check` | 只读检查前后端格式 |
| `make lint` | ESLint 与 Ruff |
| `make typecheck` | TypeScript 与严格 MyPy |
| `make test` | Vitest 与 Pytest |
| `make contract` | 从 FastAPI 重新生成 OpenAPI JSON |
| `make contract-check` | 在临时文件生成契约并检测漂移 |
| `make build` | Next.js 生产构建 |
| `make check` | 格式、lint、类型、测试、契约与构建总检查 |
| `make compose-check` | Docker Compose 语义配置检查 |
| `make e2e` | 对已运行环境执行登录、默认私有、授权搜索、分享、取消共享、worker 降级和删除的可清理 smoke test |

`make check` 不需要真实 AI Key，也不会调用外部模型。真实供应商契约测试单独标记，不能混入默认离线 CI。

## Retrieval and embedding worker

记录创建会在同一个事务中写入 `memory_embeddings` 投影和 `EMBED_MEMORY` job，但 API 不等待外部模型。worker 通过 PostgreSQL 行锁领取任务，外部调用发生在数据库事务之外，并对可重试错误执行有上限的指数退避。

处理状态含义如下：

| Status | Meaning | Operator action |
|---|---|---|
| `PENDING` | 等待 worker 领取或重试 | 通常无需操作 |
| `WAITING_CONFIGURATION` | 未配置 embedding Key 或模型 | 写入 `.env` 并在页面重试，或继续使用关键词检索 |
| `COMPLETED` | 向量已经可用于同模型、同维度的语义召回 | 无 |
| `FAILED` | 已达到重试上限或遇到不可重试供应商错误 | 检查脱敏错误码和配置后在页面重试 |

需要启用语义检索时，在本地 `.env` 设置 `AI_EMBEDDING_BASE_URL`、`AI_EMBEDDING_API_KEY` 和 `AI_EMBEDDING_MODEL`，然后重建或重启 API 与 worker：

```bash
docker compose up --detach --build api worker
```

聊天与 embedding 配置互不隐式复用。worker 日志只记录 job/memory ID、模型、状态、尝试次数和用量，不记录正文、向量、Key 或完整供应商响应。搜索使用 POST JSON，因此搜索内容也不会出现在 URL 访问日志中。

## API contract workflow

`packages/api-contract/openapi.json` 是生成产物，不能手工修改。

修改 API 后执行：

```bash
make contract
make contract-check
```

OpenAPI 差异应与 API 实现一起审查。`make contract` 会同时更新 JSON 和 `packages/api-contract/schema.d.ts`，Web 通过 `openapi-fetch` 消费生成类型；不要手工维护第二套请求模型。

## Environment and secrets

`.env.example` 将聊天和 embedding 配置分开，即使初始都指向云雾兼容入口，也不能假设两者永久使用同一模型或供应商。

生产服务器至少要替换：

- `POSTGRES_PASSWORD`
- `SESSION_SECRET`
- `CADDY_SITE_ADDRESS`
- `HTTP_PORT` 和 `HTTPS_PORT`
- `AI_CHAT_API_KEY`、`AI_CHAT_MODEL`
- `AI_EMBEDDING_API_KEY`、`AI_EMBEDDING_MODEL`

生产环境设置 `APP_ENV=production` 后，API 会拒绝默认会话密钥。不要将 AI Key 放入 Web 构建参数、客户端变量、日志或 CI 的普通输出。

## CI

`.github/workflows/ci.yml` 包含两个阶段：

1. `quality` 安装锁定依赖并执行 `make check`。
2. `containers` 构建完整 Compose 环境、运行迁移、等待健康状态并执行 smoke test。

容器阶段失败时会输出最后 200 行日志并清理 volume。CI 不读取生产 Key，M1 环境使用空 AI 配置也应健康运行。

## Common failures

### Localhost returns 502 behind a system proxy

某些系统代理会接管终端中的 `localhost` 请求，表现为容器健康但普通 `curl` 返回 502。仓库的 `make e2e` 已显式绕过代理；手工检查时使用：

```bash
curl --noproxy '*' http://localhost:8080/health
curl --noproxy '*' http://localhost:8080/api/ready
```

也可以在本机代理配置中将 `localhost` 和 `127.0.0.1` 加入绕过列表。不要因此修改容器内的服务地址或生产代理规则。

### pnpm blocks dependency build scripts

仓库只允许 `sharp` 和 `unrs-resolver` 执行安装脚本，配置位于 `pnpm-workspace.yaml`。不要用全局开关允许所有依赖脚本；新增依赖确实需要脚本时，先审查包和用途，再精确加入 allow list。

### API reports 503 on `/ready`

检查 PostgreSQL 健康状态、`DATABASE_URL` 和迁移日志：

```bash
docker compose ps
docker compose logs db migrate api
```

`/health` 只说明 API 进程存活，`/ready` 才表示数据库依赖可用。

### OpenAPI contract drift

执行 `make contract`，审查生成差异。如果差异不是预期行为，先修正 API，而不是直接接受 JSON 变化。
