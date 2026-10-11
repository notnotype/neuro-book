# t17 实施计划：内核边界、用量估算与预览

## Context

- **为什么做**：t16 审查者列出四个未核实边界；预览是 Profile Spec 已提到、runtime 没给入口的缺口。
- **工作方式**：一个实现提交，每项先改 Spec 条目再改代码与测试；一次 omp 审查后一个处理提交。

## 关键设计

1. **`status` 缓存**：`SessionHandle` 内两份缓存都以 `log.entries` 的数组引用为键（日志每次追加换一个新的冻结数组，引用不变就是没有新条目）：回放状态（`pending`、`invocationId`）与上下文用量（还要看最近一次受理的模型与设置的身份）。不改状态机。
2. **用量估算**：`shouldCompact` 给出的 `contextTokens` 为 `null`（还没有助手消息报告用量）时，用 `new Tokenizer(model).countMessages(buildModelContext(entries))` 估算；`status.context.source` 为 `"reported"` 或 `"estimated"`。`Tokenizer` 是 OMP agent-core 的导出，已知分词器家族精确计数，未知的按字节除 4。
3. **`next()` 共用等待**：`Current.pendingNext` 保存挂起的 Promise；等待点未到时再调用返回同一个 Promise，结算后清空。此刻已在等待的立即分支照旧。
4. **目录入参**：`{config: HarnessConfig} | {store: ConfigStore}`，用 `"store" in input` 判断；运行时缺省传 `{store: deps.config}`。
5. **预览**：`accept` 拆成“检查”（输入、Profile、模型选择与能力、可见工具、审批模式、压缩设置）与“取凭据”两步；`preview` 只走检查。然后 `prepare`、`refresh`（model-call 数据源，与第一次请求前一致）、`renderSeeds("new-session")`（日志里还没有种子时）、`renderAppending`（有输入时）、`renderSystem`、`renderRequest({history: 回放上下文 + 种子 + 追加消息, invocationStart: 回放长度 + 种子数})`。返回 `{model, tools, system, seeds, appended, request, diagnostics}`。读的是调用那一刻的 `log.entries`，任何状态下可调用，不占用会话。

## 验收映射

| 条目 | 测试 |
|---|---|
| runtime 输出 5（缓存、估算） | `runtime.test.tsx` 场景 10：`source: "reported"`；新用例：模型报错后 `source: "estimated"`、同一日志状态下两次 `status` 的 `pending` 是同一个数组 |
| runtime 输出 6（共用等待） | `approval.test.tsx` 场景 11：等待点未到时 100 次 `next()` 得到同一个结果对象 |
| models 输入、输出 10 | `catalog.test.ts` 场景 5 改用 `{store}`、`{config}` |
| models 输出 5（`:memory:` 重开） | `credentials.test.ts` 场景 3（已有） |
| runtime 输出 17（预览） | `runtime.test.tsx` 场景 12；示例场景 1 先 preview 再 prompt |
