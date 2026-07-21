SHELL := /bin/sh
.DEFAULT_GOAL := help

PNPM := pnpm
UV := uv
API_DIR := apps/api
COMPOSE := docker compose

.PHONY: help setup dev down logs db web-dev api-dev worker-once format format-check lint typecheck test build check contract contract-check compose-check e2e

help:
	@echo "Memora 工程命令"
	@echo "  make setup           安装锁定的前后端依赖并创建本地 .env"
	@echo "  make dev             构建并启动完整 Docker Compose 环境"
	@echo "  make down            停止完整环境"
	@echo "  make web-dev         直接启动 Next.js 热更新服务"
	@echo "  make api-dev         直接启动 FastAPI 热更新服务"
	@echo "  make check           运行格式、lint、类型、测试、契约和构建检查"
	@echo "  make compose-check   验证 Docker Compose 配置"
	@echo "  make e2e             验证已启动环境的私有、授权搜索、分享、worker 降级和删除路径"

setup:
	@test -f .env || cp .env.example .env
	$(PNPM) install --frozen-lockfile
	cd $(API_DIR) && $(UV) sync --frozen

dev:
	$(COMPOSE) up --build

down:
	$(COMPOSE) down --remove-orphans

logs:
	$(COMPOSE) logs --follow --tail=200

db:
	$(COMPOSE) up --detach db

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

test:
	$(PNPM) test
	cd $(API_DIR) && $(UV) run pytest

build:
	$(PNPM) build

contract:
	cd $(API_DIR) && $(UV) run memora-export-openapi
	$(PNPM) contract:client

contract-check:
	./scripts/check-openapi.sh

check: format-check lint typecheck test contract-check build

compose-check:
	$(COMPOSE) config --quiet

e2e:
	./scripts/e2e-smoke.sh
