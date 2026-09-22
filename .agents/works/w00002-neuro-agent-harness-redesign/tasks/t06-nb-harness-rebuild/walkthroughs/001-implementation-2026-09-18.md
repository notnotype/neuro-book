# t06 实施记录：nb-harness / nb-session / nb-profile（2026-09-18）

按批准计划 `nb-harness-rebuild` 执行完毕。全部命令在本机（Windows x64、Bun 1.3.14）跑过，输出见下。

## 交付物

| 包 | 内容 | 测试 |
| --- | --- | --- |
| `packages/nb-session`（`@notnotype/nb-session`） | append-only 会话条目模型 + `SessionLog` 接口 + `createMemorySessionLog` / `createJsonlSessionLog`（JSONL 一行一条、重开续接 seq、中断尾检测与 `repair()` 截断、`sessionId`/`root` 校验） | 14 通过 |
| `packages/nb-profile`（`@notnotype/nb-profile`） | TSX profile DSL（`ProfilePrompt`/`System`/`HistorySet`/`AppendingSet`/`Message`/`AIMessage`/`ToolCall`/`ToolResult`/`Reminder`/`If`/`Fragment`）+ `renderProfile` + JSX 运行时（`jsx-runtime` 与 `jsx-dev-runtime`）+ `loadProfile` | 11 通过 |
| `packages/nb-harness`（`@notnotype/nb-harness`） | OMP 内核（`model.ts` 模型解析/环境 key/baseUrl 覆盖）、`harness.ts`（`Agent` 装配 + 事件→会话落盘 + 每轮 profile 渲染）、`plugins.ts`（插件缝）、`sse.ts` + `sse-writer.ts`、`text-budget.ts`、`tools/read.ts`、`tools/edit.ts`、`testing`（`scriptedStreamFn`） | 20 通过（含 2 条真实 DeepSeek 用例） |
| 文档 | `packages/nb-harness/docs/omp-capabilities.md`（OMP 能力上手报告）+ 包 `AGENTS.md` | — |

## 验证证据

```
packages/nb-session:  typecheck OK ; bun test → 14 pass 0 fail
packages/nb-profile:  typecheck OK ; bun test → 11 pass 0 fail
packages/nb-harness:  typecheck OK ; bun test → 20 pass 0 fail（含真实模型两条）

bun install                        → 21 packages installed（含 @oh-my-pi/pi-natives-win32-x64 172.2 MB）
workspace-workflows.test.ts        → 13 passed（新包已覆盖 code-baseline/product-platforms/矩阵）
agent-governance.test.ts           → 仅既有基线失败（Leader 顺序开发合同标记），无新增失败
bun run docs:check                 → {"failures":[],"checkedFiles":5507}
bun run governance:check           → 仅既有 2 项无关失败
矩阵复核（三个新包路径）            → 各自被选中
真实调用证据（临时脚本，已删）       → completeSimple 344ms、stopReason=stop、usage.input=21
```

## 实现中发现的、与计划不同的事实（已按事实实现）

1. **`read` 工具必须输出 `[path#tag]` 头并登记快照**：hashline 的模型侧锚点来自 read 输出（OMP 报错原文要求「re-read to copy a current [path#tag] header」）。因此 `createReadTool` 增加 `store?: EditStore`，把**展示过的行**登记进同一个 store 并把 `[path#tag]` 放在首行；`harness.ts` 让 read 与 edit 共用同一 `EditStore`。计划原文未含此点，属集成必需的补充。
2. **不要手动登记编辑后的快照**：实测连续两次编辑（第二次用第一次回显的新 tag）直接成功——引擎已自行记账；手动 `recordSnapshot` 反而可能污染 seen-line 集合。计划第 6 步「写入成功后必须把落盘内容登记回 store」据此**未实现**。
3. **写前拒绝的返回方式**：计划写「返回 `{written: ""}` 并把 isError 置真」。实测 writer 返回值会被引擎当作落盘内容记账，返回空串会污染快照，故改为在 writer 内抛内部 `WriteDeniedError`、由工具捕获并返回 `isError: true` 的可读文本（磁盘不变、无异常外泄）。
4. **`AgentPromptOptions` 没有 `signal`**：取消只能 `agent.abort()`；`turn(input, {signal})` 改为把 signal 挂到 `agent.abort()` 上并在 finally 移除监听。
5. **Bun 用 `jsx-dev-runtime`**：非 production 下 Bun 的 JSX 转换请求 `@notnotype/nb-profile/jsx-dev-runtime`，因此额外提供该子路径（含 `jsxDEV` 与 `JSX` 类型）。
6. **测试辅助的导入路径**是子路径：`@notnotype/neuro-book-test-support/tmp`（该包只有 `./paths`/`./tmp`/`./test-path`/`./vitest` 导出，没有根导出）。
7. **`Usage` 必填 `cost`**：`scriptedStreamFn` 的 usage 需补 `cost: {input, output, cacheRead, cacheWrite, total}`。
8. **`AssistantMessageEventStream` 的值导出**：从 pi-ai 根导入拿到的是 `export type`；测试替身改用 `@oh-my-pi/pi-ai/utils/event-stream` 的 `createAssistantMessageEventStream()`。

## 实测的 OMP 编辑语义（写入报告 `docs/omp-capabilities.md` 第 4 节）

- 入参形状 `{input: "<模式原文>"}`（`rawInput: false`）；`{patch: ...}` 被拒绝。
- apply 回显编辑后的 hashline 视图（含新 tag）。
- 未展示行守卫默认开：只看过第 1 行却改第 3 行 → 拒绝、磁盘不变。
- 伪造 tag → 拒绝 + 提示当前 hash；磁盘不变。
- 同 session 旧 tag + 文件外部漂移 → **重映射恢复**并附 warning（本项目按开发者决定接受该语义）。
- 五种模式（replace/patch/apply_patch/hashline/sloppy）由 Rust `crates/pi-edit` 实现，经 `pi-natives` 的 `EditSession` 暴露。

## 遗留

- `packages/neuro-agent-harness`（旧包）与 llmlint **未触碰**；将来把 llmlint 迁到 `nb-harness` 或让新包接管旧包目录，属另行批准的工作。
- 订阅登录（OMP `pi-ai` 的 oauth/auth-broker/auth-gateway）未接入，仅登记入口；域工具未接入，插件缝已就位。
- 未做：`vaultRoots`/`localSandboxRoot` 的实际策略、LSP 诊断转发、流式预览转发（`onPreview` 传 `null`）。
- 原生包体积对 CI 的影响尚无实测（本机 win32 安装 172.2 MB）——若 linux CI 安装超时，按计划假设 5 的退路处理。
