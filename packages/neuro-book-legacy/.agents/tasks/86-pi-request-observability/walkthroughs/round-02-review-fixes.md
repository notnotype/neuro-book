# Round 02 — 链路走查修复

2026-07-05。对 round-01 交付做链路走查审查（turn / 自动 compaction / 手动 compact / config / 落盘逐链验证），主链路全部通顺，但发现并修复 2 个真实问题 + 1 处类型收敛 + 死配置清理。

## 审查发现与修复

### 1. sidecar 链路静默不记录（中，核心修复）

`runSidecarPass` 的内层 `runLoop` 调用没传 `piTrace` → frame 无设置 → `piTraceBinding` fallback `enabled:false` → sidecar 的每个 provider turn 都不落 trace。sidecar 跑完整 ReAct loop、真实烧 token，恰是最黑盒最需要可观测的部分。

修复（`neuro-agent-harness.ts`）：

- `SidecarRunContext` 加 `piTrace?: PiTraceSettings`；两处构造点补齐——prepareRun 阶段用 `preparedRun.piTrace`，settleRun 阶段（`completeInvocation`，config 在手）用新 helper `piTraceSettings(config)`；内层 `runLoop` 调用传 `piTrace: sidecarRun.piTrace`。
- **correlation.mode 语义定稿**：此前 `PiTraceCorrelation.mode` 声明了但从未被填。README 原 schema 设想的 invoke mode（"prompt"）不在 RunFrame 上（prepareRun 阶段就消费掉了），为标 mode 专门穿字段属于过度设计。改用现成信息：主 run 填 `caller.kind`（user/agent/sidecar/system），sidecar pass 内填 `sidecar:<passName>`（来自 `frame.activeSidecar`）。README schema 示例与 `pi-request-recorder.ts` 注释同步更新。

### 2. finalize 兜底路径误标 status:"ok"（小 bug）

`TraceCollector.finalize(undefined)`（pi 违反 "result() 不 reject / completeSimple 不 throw" 契约时的 catch 兜底）status 推导会算出 "ok"——写出一条零信息但标成功的记录，对 debug 工具是最坑的失真。

修复（`traced-provider.ts`）：message 缺失 → status 直接判 `"error"`；`finalize` 加 `fallbackError` 参数，两个 catch 调用点把异常文本传入 `response.errorMessage`（新 `errorText()` helper）。不为此路径写测试：faux provider 无法模拟契约违约，也不为测试导出内部类。

### 3. `PiTraceSettings` 类型收敛（防再犯）

`{enabled, capturePayload, maxRecords}` 三元组此前在 4 处内联重复（`RunFrame` / `PreparedRun` / `runLoop` input / config 摘取），本轮还要新增 2 处。统一改用 `traced-provider.ts` 已导出的 `PiTraceSettings`（`run-kernel-types.ts` import type，无循环依赖）；config → 三元组的摘取收敛进 harness 私有 helper `piTraceSettings(config)`，`prepareRun` / `piTraceBindingFromConfig` / settleRun sidecar 三处共用。

### 4. 死配置 `traceHealthCheck` 清理

health-check 划出范围后该字段无消费方。代码侧（`config/types.ts` + `normalizer.ts`）在本轮开始前已由用户手动删除；本轮清掉 round-01 文档里的残留引用。`PiTraceKind` 的 `"health-check"` 字面量按 round-01 决定保留备用。

### 审查中确认无问题的点（记录备查）

- prune 的 `.json` 后缀过滤不会误删 `index.jsonl`；`traces-seq.json` 在 traces 根不在 bucket 内。
- 全仓 `streamSimple|completeSimple` 扫描：绕过统一入口的生产调用点只剩 `model-settings.ts` health-check（已划出范围）。
- 低风险观察项固化为注释约定（`TraceCollector` 类注释）：collector 持 context/payload **引用**、序列化在串行队列中延后，调用方必须传新建 context 且事后不 mutate（现状 streamAssistant 与 compaction 均满足）。
- 孤儿 trace 目录（session 删除后 `traces/<sessionId>/` 残留）记入 README P1 TODO，随查看器一起做。

## 测试

- `harness-trace.test.ts` 新增 sidecar 集成测试：profile 带 `stage:"prepareRun"` + `outputFallback:"final_message_as_result"` 的 sidecar pass，faux 两条响应；断言同一 session bucket 里既有 `mode:"sidecar:ctx-load"` 记录也有 `mode:"user"` 主 turn 记录、correlation 正确、无 apiKey。这条测试封住本轮遗漏的盲区——以后改 runLoop 调用点忘传 piTrace 会红。
- `waitForTrace` helper 加 `minCount` 参数（等两条记录都落盘）。

## 验证

- `bunx vitest run server/agent/observability server/agent/harness/compaction.test.ts server/config` → **53 通过**（observability 9 含新增 sidecar 测试 + compaction 8 + config 36）。
- `bun run typecheck` → 干净无输出（此前既有的 Plot*.vue chapterPath 红灯也已不在）。

## 出入

- 计划中的「删除 traceHealthCheck」到执行时发现代码侧已被用户先行删除，本轮实际只清了文档残留。
- README 在本轮执行期间被并行更新（P1 Design 定稿、P0 TODO 勾选），文档同步从「全面重写 TODO」降为增量补充（sidecar 接入、finalize 修正、round-02 链接、孤儿目录 TODO、schema mode 示例）。
