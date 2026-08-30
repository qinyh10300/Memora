# Chat voice input

Status: completed

Owner: product team and coding agent

Last updated: 2026-08-30

## Outcome

用户可以在 Chatbot 输入框旁点击麦克风录音，停止后由服务端将音频转成文字并回填输入框；
用户仍需自行确认或修改文字并点击发送。原始录音不写入 Memora 数据库或资产库。

## Context and evidence

- 产品规则：`docs/product/brief.md` 的默认私有、显式保存和外部 AI 调用边界。
- 架构规则：`docs/architecture/overview.md` 的 OpenAPI 契约与可替换 AI provider ports。
- 当前代码：`CaptureWorkspace` 管理输入框，FastAPI 生成 OpenAPI，AI adapter 通过 `ai/ports.py` 隔离。
- 官方接口：OpenAI Audio Transcriptions 使用 multipart form-data，支持 WebM 并返回转写文本。

## Scope

### In scope

- Chatbot 输入框麦克风按钮、录音/停止/转写状态和错误反馈。
- 受认证保护的音频转写 API，限制媒体类型与文件大小。
- 可替换 `SpeechToTextPort` 和 OpenAI-compatible multipart adapter。
- 未配置、权限拒绝、空录音、上游失败与超时降级。
- OpenAPI 契约、Web/API 自动化测试和产品/架构文档。

### Non-goals

- 实时语音对话、流式字幕、说话人分离或 Chatbot 回答朗读。
- 永久保存录音、把录音作为记忆附件或自动发送转写文字。

## Assumptions and open questions

- [x] 第一版默认自动识别语言，运维可用 `AI_SPEECH_LANGUAGE=zh` 固定中文提示。
- [x] 录音停止后一次性转写，不引入 Realtime API。
- [x] 原始音频只在请求内存中短暂存在，不写入数据库或对象存储。
- [ ] 当前开发环境的 OpenAI-compatible 服务是否支持 `/v1/audio/transcriptions`；不支持时界面显示未配置/不可用，不影响文字聊天。

## Design and boundaries

浏览器使用 `getUserMedia` 与 `MediaRecorder` 采集音频，只在用户主动点击后请求麦克风权限。
停止录音后把 Blob 作为原始二进制请求提交给同源 API。API 先完成会话认证、媒体类型、文件
签名与大小校验，再调用 `SpeechToTextPort`。adapter 负责供应商 multipart HTTP 契约、超时和错误归一化，不读取业务数据。
响应只返回转写文字与模型标识；前端追加到当前输入框，不自动触发 Chatbot。

## Milestones

- [x] M1 — 完成受保护的转写端口、adapter、配置与 API；验证：API 单元/契约测试。
- [x] M2 — 完成录音控件和回填交互；验证：Web 组件测试覆盖开始、停止、成功和失败。
- [x] M3 — 完成契约生成、全量检查和运行时 smoke test；验证：`make check` 与 API/Web 集成测试。

## Acceptance criteria

- [x] 用户主动开始和停止录音，录音时有明确视觉状态。
- [x] 转写成功后文字进入输入框且不会自动发送。
- [x] 麦克风拒绝、浏览器不支持、空录音、超限、未配置和上游失败均可恢复。
- [x] 原始音频和完整转写不进入日志、数据库或资产存储。
- [x] 文字聊天、图片/PDF 附件和取消/重试路径不回归。

## Verification

- 自动化检查：Web/API 单元测试、OpenAPI 漂移、类型、lint、格式与构建。
- 集成验证：未配置 adapter 的确定性 503；fake adapter 的认证、格式、大小和成功响应。
- 手工验证：支持录音的浏览器中开始、停止、回填、编辑和发送。
- 安全验证：未认证拒绝；日志和持久化不包含音频正文。

## Rollout and recovery

该变更不包含数据库迁移。未配置 STT 时仅禁用/降级语音输入，文字聊天保持可用。回滚 Web/API
镜像即可恢复旧界面；新增配置可以保留为空。

## Progress log

- 2026-08-30：用户确认实现语音输入；选择录音后转写并回填的第一版。

## Decision log

- 2026-08-30：采用服务端 STT 而非仅依赖浏览器 `SpeechRecognition`；原因是需要跨浏览器可控的供应商、错误和隐私边界。
- 2026-08-30：不自动发送转写结果；原因是语音识别可能出错，用户必须有机会确认内容。

## Completion summary

已交付浏览器录音控件、只回填不自动发送的转写交互、独立 `SpeechToTextPort`、受认证和限流
保护的原始音频 API、OpenAI-compatible multipart adapter，以及媒体类型、文件签名和大小边界。
原始音频不落库，审计只保留模型与用量元数据。OpenAPI 客户端、产品/架构/开发配置文档已同步。

验证证据：`make check` 成功；Web 124 项、API 207 项测试通过；PostgreSQL 授权检索评估、
OpenAPI 漂移检查和生产构建通过。当前未配置真实 STT Key，因此供应商账号对
`/audio/transcriptions` 和所选模型的实际兼容性仍需在部署环境用最低权限 Key 验证。
