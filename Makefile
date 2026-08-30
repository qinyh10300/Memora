SHELL := /bin/sh
.DEFAULT_GOAL := help

PNPM := pnpm
UV := uv
API_DIR := apps/api
COMPOSE := docker compose

.PHONY: help setup secret-permissions-check dev down logs db backup verify-backup verify-backup-policy recovery-drill rollback-drill switch-images performance-baseline web-dev api-dev worker-once format format-check lint typecheck web-test api-test test eval-retrieval retrieval-baseline eval-retrieval-postgres retrieval-postgres-baseline build check contract contract-check compose-check e2e browser-e2e

help:
	@echo "Memora 工程命令"
	@echo "  make setup           安装锁定的前后端依赖并创建本地 .env"
	@echo "  make secret-permissions-check  验证本地 .env 仅当前用户可读写"
	@echo "  make dev             构建并启动完整 Docker Compose 环境"
	@echo "  make down            停止完整环境"
	@echo "  make web-dev         直接启动 Next.js 热更新服务"
	@echo "  make api-dev         直接启动 FastAPI 热更新服务"
	@echo "  make check           运行格式、lint、类型、测试、契约和构建检查"
	@echo "  make web-test        仅运行 Web 自动化测试"
	@echo "  make api-test        仅运行 API 自动化测试"
	@echo "  make eval-retrieval  运行离线检索质量与权限评测门禁"
	@echo "  make eval-retrieval-postgres  在一次性 PostgreSQL 中验证 FTS、trigram 和迁移"
	@echo "  make compose-check   验证 Docker Compose 配置"
	@echo "  make e2e             验证个人 Markdown、修订、权限、降级和删除路径"
	@echo "  make browser-e2e     在隔离 Docker 环境运行真实浏览器主路径"
	@echo "  make backup          创建带校验和与保留策略的 PostgreSQL 备份"
	@echo "  make verify-backup BACKUP=...  在隔离数据库验证指定备份"
	@echo "  make verify-backup-policy BACKUP=...  验证备份分类、权限、校验和与离机门禁"
	@echo "  make recovery-drill  备份当前数据库并立即执行隔离恢复演练"
	@echo "  make rollback-drill BACKUP=...  用指定旧镜像执行隔离应用回滚演练"
	@echo "  make switch-images API_IMAGE=... WORKER_IMAGE=... WEB_IMAGE=...  切换承载服务镜像"
	@echo "  make performance-baseline  记录桌面、移动、API、检索与容器资源基线"

setup:
	@if [ ! -f .env ]; then install -m 600 .env.example .env; else chmod 600 .env; fi
	$(PNPM) install --frozen-lockfile
	cd $(API_DIR) && $(UV) sync --frozen

secret-permissions-check:
	@if [ -f .env ]; then \
		case "$$(uname -s)" in \
			Darwin) MODE=$$(stat -f '%Lp' .env) ;; \
			*) MODE=$$(stat -c '%a' .env) ;; \
		esac; \
		[ "$$MODE" = "600" ] || { echo ".env must have mode 600; run: chmod 600 .env" >&2; exit 1; }; \
	fi

dev: compose-check
	$(COMPOSE) up --build

down:
	$(COMPOSE) down --remove-orphans

logs:
	$(COMPOSE) logs --follow --tail=200

db:
	$(COMPOSE) up --detach db

backup:
	./scripts/db-backup.sh

verify-backup:
	@test -n "$(BACKUP)" || { echo "Usage: make verify-backup BACKUP=/absolute/path/to/archive.dump" >&2; exit 2; }
	./scripts/db-restore-verify.sh "$(BACKUP)"

verify-backup-policy:
	@test -n "$(BACKUP)" || { echo "Usage: make verify-backup-policy BACKUP=/absolute/path/to/archive.dump [OFFSITE=1]" >&2; exit 2; }
	@if [ "$(OFFSITE)" = "1" ]; then \
		./scripts/backup-policy-check.sh --offsite "$(BACKUP)"; \
	else \
		./scripts/backup-policy-check.sh "$(BACKUP)"; \
	fi

recovery-drill:
	@BACKUP_PATH=$$(./scripts/db-backup.sh); \
	./scripts/db-restore-verify.sh "$$BACKUP_PATH"

rollback-drill:
	@test -n "$(BACKUP)" || { echo "Usage: make rollback-drill BACKUP=/absolute/path/to/archive.dump" >&2; exit 2; }
	./scripts/application-rollback-drill.sh "$(BACKUP)"

switch-images:
	@test -n "$(API_IMAGE)" -a -n "$(WORKER_IMAGE)" -a -n "$(WEB_IMAGE)" || { echo "Usage: make switch-images API_IMAGE=... WORKER_IMAGE=... WEB_IMAGE=..." >&2; exit 2; }
	SWITCH_API_IMAGE="$(API_IMAGE)" SWITCH_WORKER_IMAGE="$(WORKER_IMAGE)" SWITCH_WEB_IMAGE="$(WEB_IMAGE)" ./scripts/application-image-switch.sh

performance-baseline:
	./scripts/performance-baseline.sh

web-dev:
	$(PNPM) web:dev

api-dev:
	cd $(API_DIR) && $(UV) run uvicorn memora.main:app --reload

worker-once:
	cd $(API_DIR) && $(UV) run memora-worker --once

format:
	$(PNPM) format
	cd $(API_DIR) && $(UV) run ruff format .

format-check:
	$(PNPM) format:check
	cd $(API_DIR) && $(UV) run ruff format --check .

lint:
	$(PNPM) lint
	cd $(API_DIR) && $(UV) run ruff check .

typecheck:
	$(PNPM) typecheck
	cd $(API_DIR) && $(UV) run mypy

web-test:
	$(PNPM) test

api-test:
	cd $(API_DIR) && $(UV) run pytest

test: web-test api-test

eval-retrieval:
	cd $(API_DIR) && $(UV) run python -m memora.retrieval.evaluation \
		--dataset evaluation/retrieval/v1.json \
		--thresholds evaluation/retrieval/thresholds-v1.json \
		--output ../../artifacts/retrieval-current.json \
		--enforce

retrieval-baseline:
	cd $(API_DIR) && $(UV) run python -m memora.retrieval.evaluation \
		--dataset evaluation/retrieval/v1.json \
		--thresholds evaluation/retrieval/thresholds-v1.json \
		--output ../../docs/evaluation/retrieval-baseline-v1.json \
		--enforce

eval-retrieval-postgres:
	./scripts/eval-retrieval-postgres.sh \
		--thresholds evaluation/retrieval/thresholds-postgres-v1.json \
		--output ../../artifacts/retrieval-postgres-current.json \
		--enforce

retrieval-postgres-baseline:
	./scripts/eval-retrieval-postgres.sh \
		--thresholds evaluation/retrieval/thresholds-postgres-v1.json \
		--output ../../docs/evaluation/retrieval-postgres-v1.json \
		--enforce

build:
	$(PNPM) build

contract:
	cd $(API_DIR) && $(UV) run memora-export-openapi
	$(PNPM) contract:client

contract-check:
	./scripts/check-openapi.sh

check: secret-permissions-check compose-check format-check lint typecheck test eval-retrieval eval-retrieval-postgres contract-check build

compose-check:
	python3 scripts/test-check-compose-security.py
	$(COMPOSE) config --quiet
	$(COMPOSE) config --format json | python3 scripts/check-compose-security.py

e2e:
	./scripts/api-e2e.sh

browser-e2e:
	./scripts/browser-e2e.sh
