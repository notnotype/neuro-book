# PLAN-A：核心 workflow API 与 harness 接入（主会话负责）

目标：把 nb-workflow 内核从 demo 服务提升为 harness 一等能力；定形对 agent 的 workflow API；交付拆书内置 workflow 作为验收样板。

## A1. WorkflowCatalog 存储（复刻 SkillCatalog）

- 目录：`<systemNbookRoot>/agent/workflows/<key>/` 与 `<userNbookRoot>/agent/workflows/<key>/`，用户同名目录整体覆盖。
- 每个 workflow 目录含：
  - `workflow.ts`：源码。导出 `default defineWorkflow({...})`（内核已有 def 形态：key/title/description/args/run）。
  - 元数据从 def 静态读取（用 `require("typescript")` 转译后取 default export 的 key/title/description/whenToUse；**F9：勿 ESM import typescript**）。不另设 WORKFLOW.md，避免双真相源。
- 新建 `server/agent/workflows/workflow-catalog.ts`：`list()/get(key)`，返回 `{key, title, description, whenToUse, source, path, def}`。带 mtime 缓存，用户改文件即失效。
- harness 构造器挂 `this.workflows`（与 `this.skills` 同层）。

## A2. WorkflowService 从 demo 提升

- `server/agent/workflow/workflow-demo-service.ts` 拆出正式 `WorkflowService`：
  - RunnerPort 组装不变（NeuroWorkflowSessionPort + HarnessAgentPort）；mock 通道仅 demo 场景保留。
  - run 注册来源改为 WorkflowCatalog + 内联脚本（见 A3）。
  - EventBuffer / buildRunVm 保留；`buildChart` 状态图为主视图。
  - run 状态仍内存态（run-as-session 持久化留 TODO，不阻塞验收）。
- 直聊互斥统一到 harness：workflow 占用的 session 在 harness 层拒绝并发直聊（Task 110 已知边界收口）。

## A3. `run_workflow` 工具（面 B）

`defineAgentTool({key: "run_workflow", approvalRequired: true, ...})`：

- 参数：
  ```ts
  {
      workflowKey?: string;      // 内置/用户 workflow；与 script 二选一
      script?: string;           // agent 随机应变写的内联 workflow 源码（TS）
      args?: JsonValue;          // 传给 workflow 的 args
      model?: string;            // "provider-id/model-id"，workflow 内 createAgent 的默认模型
  }
  ```
- `script` 路线：转译→注册为一次性 def→运行。沙盒化 V1 从简：no-fs/no-net 的模块加载白名单（只允许 wf API），完整沙盒记 TODO。
- **审批 UI**：approvalRequired 走既有审批流；审批卡片显示 workflowKey/description 或 script 摘要 + 目标模型。
- 模型校验：`model` 必须在「agent 可见模型清单」（PLAN-B）内，否则报错列出可选项。清单渲染进 prompt 由 B 完成；工具侧只做校验与解析（复用 `modelResolver` 的 `{modelKey}` 覆盖面）。
- **返回契约**（用户拍板：自定义返回 + 元数据）：
  ```ts
  // NeuroToolResult.details
  {
      runId: string;
      status: "completed" | "failed";
      result: JsonValue;                    // workflow return 值
      sessions: {sessionId: number; profileKey: string; title: string;
                 tokens?: {input: number; output: number}}[];  // 创建/触达的 session 元数据
      usage: {inputTokens: number; outputTokens: number};      // 汇总
      chartMermaid: string | null;          // 终态状态图（气泡静态兜底）
  }
  ```
  content 文本给一段人话摘要（状态 + result 摘要 + session 数 + token 数）。
- **执行期流式**：用 `onUpdate` 周期性推 partial details（runningNow + 最新 chartMermaid + 事件游标），前端气泡（PLAN-C）据此实时渲染；另暴露 `GET /api/agent/workflow/runs/:id` 供气泡轮询全量 RunVm（复用 demo runs 路由形态，路径迁到正式命名空间）。
- 工具描述保持短：能力一句话 + 「编写指南见 `reference/agent/workflow/`」（文档由 D 写）。

## A4. 用户主动触发

- HTTP：`POST /api/agent/workflow/runs {workflowKey, args, model?}`（从 demo runs.post 迁移收口），前端入口由 C 挂（最小版：workflow.preview 页切到正式 API 即算）。
- leader 主动调用：prompt 里的 WorkflowCatalog fragment（A5）+ `run_workflow` 工具即可，无需新机制。

## A5. Prompt 面（WorkflowCatalog fragment）

- `profile-dsl.ts` 加 `WorkflowCatalog()` fragment，仿 `SkillCatalog`：列 key/title/whenToUse，尾行指引「需要编写或运行 workflow 时，先读 reference 文档再动手」。挂进 leader profile。

## A6. token 用量采集

- HarnessAgentPort.invoke 后从 invocation result / session usage 读取本轮 token 数，累计到 run 级 `usage` 与 per-session tokens。若现有 result 无 usage 面，则在 harness invokeAgent 返回值补 usage 字段（顺带收益）。

## A7. 拆书内置 workflow（验收样板）

- `<system>/agent/workflows/split-book/workflow.ts`：把 demo split-book 场景改为真实版——真实 profile（章节摘要员/剧情分析员）、读真实 manuscript 路径、`wf.chart` 全程画图、返回结构化拆书结果。
- 验收：leader 对话中说「帮我拆这本书」→ leader 调 `run_workflow(workflowKey: "split-book")` → 审批 → 前端气泡看到状态图长出来 → 返回含 sessions/usage 元数据。

## A8. harness 遗留收口（Task 110 清单内、本模块顺带）

- `harness.createAgent` 补 `kind`/`tags` 透传；workflow 创建的 session 标 `kind:"workflow"`。
- waiting 穿透（`wf.ask` → 顶层用户）：V1 若量大可降级为「workflow 内不允许 ask，需要用户输入就失败并提示」，记录决策。

## 顺序

A1 → A2 → A3（含 A6）→ A5 → A7 → A4/A8 扫尾。每步 `bunx vitest run server/agent/workflow` + `bun run typecheck`。

## 开放决策（实施中报告用户）

- 内联 script 沙盒边界 V1 从简是否可接受（工具已挂审批门）。
- run-as-session 持久化本轮不做（重启丢 run 观测态，不丢 session 真相）。
