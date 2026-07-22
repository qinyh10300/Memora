# Memora

Memora 是一个面向个人与小团队的想法记忆库。用户快速记录带时间戳的想法，默认私有、按需共享；之后通过有权限边界、带原文引用的 AI 助手检索、回顾和总结这些想法。

## 当前状态

M0 至 M6.1 的本地第一版已经完成。项目已在 Apple Silicon 本机通过完整容器和浏览器验收。登录后只有一个极简暗黑 Chatbot：普通陈述会先追问“仅自己/共享团队”再保存，回顾问题默认只检索个人记录，明确点名同事或团队后才扩大授权范围，回答和报告都附带原始来源。分享、取消共享、补充和删除等低频动作也通过对话命令完成。没有配置 AI 模型时，记录、关键词检索、确定性证据回答和结构化报告仍可使用。

当前已确认：

- 首轮内测为一个四人工作区，使用四个预置账号。
- v0.1 只支持纯文本想法。
- 想法默认私有，用户可以主动共享给工作区。
- 想法采用追加式记录，不静默改写历史。
- AI 只能使用当前用户有权访问的记录，并为事实性结论提供原记录、作者和时间引用。
- 首个版本部署到单台公网服务器。
- 外部 AI 先通过可配置的兼容 API 接入，未来允许切换到本地模型。

## 文档入口

- [产品简报](docs/product/brief.md)
- [初始架构](docs/architecture/overview.md)
- [架构决策 ADR-0001](docs/adr/0001-initial-system-architecture.md)
- [当前执行计划](docs/plans/active/0001-foundation-and-first-vertical-slice.md)
- [Agent 协作规范](AGENTS.md)
- [执行计划规范](PLANS.md)
- [代码审查规范](docs/code-review.md)
- [开发环境与工程命令](docs/development.md)

## 技术基线

- Next.js App Router、React、TypeScript
- FastAPI、Pydantic、SQLAlchemy、Alembic
- PostgreSQL + pgvector
- pnpm 与 uv 锁定依赖
- Docker Compose + Caddy

## 快速开始

准备 Node.js 22、pnpm 11.9、Python 3.13、uv、Docker Compose、make 和 curl，然后执行：

```bash
make setup
make dev
```

默认入口为 `http://localhost:8080`。在另一个终端等待服务并检查 Web/API：

```bash
./scripts/wait-for-services.sh
make e2e
```

不启动容器时，可以运行完整的离线质量检查：

```bash
make check
```

真实密钥只写入已被 Git 忽略的 `.env`。仓库中的 `.env.example` 只提供变量名称和本地占位值。

## 下一步

本地第一版可交付给四位成员测试。M7 公网部署需要服务器 SSH、域名/DNS、生产账号密码和专用低额度 AI Key；获得这些外部条件后再执行 HTTPS、备份恢复、部署 smoke test 和真实供应商验证。
