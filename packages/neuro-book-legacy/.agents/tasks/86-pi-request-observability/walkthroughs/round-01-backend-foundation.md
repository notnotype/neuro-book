# Round 01 — 后端可观测地基 (P0)

2026-07-03。按 `/goal Pi Request Observability P0` 推进。本轮交付 recorder + 统一入口透明代理 + config 开关 + **turn 与 compaction 两个调用点**接入 + 真实 provider smoke。model-settings（health-check）2026-07-05 正式划出范围不记录，详见出入。

## 已交付

### 通用 writer：`server/agent/observability/pi-request-recorder.ts`
- `PiRequestRecorder`：只认 pi 事实 + 开放 `correlation`。
- 存储 `traces/<bucket>/<seq>.json`（bucket = sessionId 或 `_system`）+ 每 bucket `index.jsonl` 汇总行；全局 `traces-seq.json` 计数器（镜像 `session-repo` 的 `session-seq.json`）。
- 每 bucket retention（`maxRecords`），删最旧并把 index 收敛到保留集。
- 串行写队列（`tail` promise 链）避免 seq/prune/index 并发交错；`record()` best-effort（失败只 `appLogger.warn`，不抛）；`flush()` 供测试/优雅关闭。
- 类型：`PiTraceRecord` / `PiTraceDraft` / `PiTraceCorrelation` / `PiTraceRequest` / `PiTraceResponse` / `PiTraceTiming` / `PiTraceIndexEntry`。

### 统一入口透明代理：`server/agent/observability/traced-provider.ts`
- `tracedStreamSimple` / `tracedCompleteSimple`：关闭时返回原始流不套壳（零开销）；开启时委托式 pass-through（caller 拉 wrapper → wrapper 拉 original，单消费链）。
- `finalize` 挂 `original.result()`（error/abort 也 resolve 成最终 message），不依赖 caller 是否消费/abort → 错误+abort 兜底可靠，且与 provider 的 `onResponse` 在错误路径是否触发无关。
- TTFT 在首个非 `start` 事件打点（仅被迭代的 turn 有效）。
- **字段白名单**：只存 `context`（pi 规范化）+ `payload`（onPayload 原生）+ model/reasoning + 响应健康度；`onPayload/onResponse` 链式保留调用方原有回调；**绝不**碰 `options.apiKey/headers/metadata`。

### Config：`observability.piTrace.*`
- `server/config/types.ts`：`EffectiveConfig.observability` + `ObservabilityConfig` / `PiTraceConfig`；`StoredGlobalConfig.observability?` 允许 `.nbook/config.json` 覆盖。
- `server/config/normalizer.ts`：`DEFAULT_PI_TRACE`（enabled=true、maxRecords=100、capturePayload=true）+ `normalizeObservability()`，在 `createDefaultEffectiveConfig()` 与 `resolveEffectiveConfig()` 装配。（`traceHealthCheck` 字段随 health-check 划出范围一并删除，见 round-02。）
- 第一版只做 global 覆盖 + 默认值，不铺开编辑器 UI（P1 再做）。

### 主 turn 链路接入
- `RunFrame`（`run-kernel-types.ts`）+ `CreateRunFrameInput`（`run-frame-state.ts`）+ `runLoop` input + `PreparedRun` 各加可选 `piTrace {enabled, capturePayload, maxRecords}`。
- `prepareRun`（config 在手处）从 `config.observability.piTrace` 解析 `piTrace`，随 `preparedRun` → `runLoop` → `createRunFrame` 流到 `RunFrame`（不每请求读盘）。
- `executeTurn` 用 `piTraceBinding(frame)` 组装 binding（kind:"turn" + sessionId/invocationId/profileKey/turnIndex），传入 `streamAssistant`；`streamAssistant` 改用 `tracedStreamSimple`。
- harness 构造函数持有 `this.piTraceRecorder`（绑定 `repo.rootWorkspace`）。

### compaction 链路接入
- `compaction.ts`：`compactIfNeeded` → `appendCompaction` → `generateCompactionSummary` 各加可选 `trace?: PiTraceBinding`；`generateCompactionSummary` 有 trace 时用 `tracedCompleteSimple`，否则原 `completeSimple`（可选参数，既有 compaction 测试不传 trace 仍通过）。
- harness `piTraceBinding(frame, kind)` 参数化；新增 `piTraceBindingFromConfig(config, correlation)`（无 frame 时用）。
- 自动 compaction（`neuro-agent-harness.ts:3468`）传 `piTraceBinding(frame, "compaction")`；手动 `/compact`（`5144`）传 `piTraceBindingFromConfig(config, {kind:"compaction", sessionId, invocationId, profileKey})`。

## 验证

- `bunx vitest run server/agent/observability server/agent/harness/compaction.test.ts server/agent/harness/neuro-agent-harness-payload.test.ts server/config` → **59 通过**（observability 8 + compaction 8 + payload 7 + config 36）。
  - observability：recorder 落盘/每 session retention/`_system`/并发 seq；透明代理 vs 原始流事件等价、关闭不落记录、未迭代只 result() 也落记录；**harness→trace 集成**（真实 `invokeAgent` 落一条 kind=turn 记录，correlation.sessionId/invocationId 正确，无 apiKey）。
  - compaction 8 全通过，证实加 `trace?` 可选参数未回归。
- `bun run typecheck` → 我触碰的服务端文件（observability/harness/compaction/config/run-frame-state/run-kernel-types）**无 error**。既有无关红灯：`app/components/novel-ide/plot/**.vue` 的 `chapterPath`。
- **真实 provider smoke**（`scripts/smoke/smoke-agent.ts`，root `.agent/agent-smoke/<stamp>/`）：写出真实 trace `traces/1/1.json`——`kind=turn`、`profileKey=leader.default`、`provider=xiaomi-token-plan-cn`、`api=openai-completions`、`model=mimo-v2.5-pro`、`baseUrl` 均捕获，`context` 捕获。本次 provider 网关（`fufu.iqach.top`）29ms fast-fail → `status=error`、`httpStatus=undefined`（印证 Round1 错误路径 onResponse 被跳过的结论），**trace 仍记录了失败**（finalize-on-error 在真实 provider 上生效）。记录内**无 apiKey/authorization**（白名单在真实数据上成立）。唯一未由真实成功请求确认的是 `payload` 捕获（本次请求发送前即失败），但由 pi 源码保证（各 provider 发送前必调 onPayload）。smoke 脚本自身在 invoke 之后因既有 `result.events` 陈旧字段崩溃，与本任务无关。

## 绕道 / 出入

- **黑盒 `neuro-agent-harness.black-box.test.ts` 的 "Idle + prompt" / "Idle + continue" 超时失败是既有问题，非本次引入。** 用 `git stash` 掉本次 tracked 改动后在 baseline 上复跑，同样超时失败（profile API 从 `allowedToolKeys` 迁到 `tools` 使这些测试陈旧 + task-02 记录的后台任务串扰）。本任务不修它们。
- **model-settings（`model-settings.ts:451`，health-check）正式划出范围，不记录**（2026-07-05 用户决定）。理由：它是设置页「检查模型连接」按钮的配置期探针请求，不是真实写作/agent 的 token 消耗，可观测价值最低；且 `runPiModelSmokeCheck` 是纯 config-time util，无 session/recorder 句柄，接入需在 util 内加载 config + 定 health-check 的 traces root，不成比例。goal 原列的第 3 个调用点就此关闭；实际覆盖 = turn + compaction。`PiTraceKind` 仍保留 `"health-check"` 备用，但无调用方。

## 下一步

- P1：前端查看器（列表读 `index.jsonl`、详情、trace↔session 跳转、按 invocationId 分组）。
- 结束任务时同步 `PROJECT-STATUS.md`。
