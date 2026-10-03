# PLAN-D：Reference 文档与内置 workflow 库（子任务 agent）

目标：把 workflow 编写指南写成 reference 文档（渐进式加载：工具描述只留引用），并在拆书之外补充内置 workflow。

依赖：A 模块 API 定稿（`run_workflow` 参数、返回契约、WorkflowCatalog 目录约定、wf API 面）。

## D1. `reference/agent/workflow/` 文档组

- `README.md`：入口，何时用 workflow（vs 直接 spawn 子 agent）、目录约定（system/user 双根覆盖）、`run_workflow` 工具契约摘要。
- `authoring.md`：编写指南——`defineWorkflow` 结构、args 声明、`wf.createAgent`（含 model 指定，只能选 agent 可见模型清单）、`wf.invoke`、map/并发、返回值设计（自定义 result + 平台自动附 sessions/usage 元数据）、确定性红线（勿用 Date.now/随机数，重放依赖 fingerprint）。
- `chart.md`：`wf.chart` 可视化规范——**这是「workflow 要写得好」的关键**：
  - 零预置、只增不删、图随执行长出来；
  - `node/edge/enter/leave/move`、token 表并发线、sessionId 挂名字；
  - 构图口诀（起点一个 node；扇出 map 每项一 node 一 token；汇合建 merge node；同 session 分支两 node 同题注）；
  - 好/坏示例各一（好：拆书图；坏：无 chart 或只有一个 node）。
- 面向 agent 读者写：不假设读者有本对话上下文（提示词工程红线）。文风与既有 `reference/agent/*.md` 一致。
- 注册进 `reference/README.md` 与 `docs/modules` 索引。

## D2. 内置 workflow 补充（拆书由 A 交付，此处再选 1-2 个）

候选（按 Task 110 五场景的真实化优先级）：

- `write-review-loop`：写手初稿 → 评审 → 驳回/修订循环 → 定稿。展示循环 + 状态图 move 边序号。
- `parallel-brainstorm`：议题多角度并发问答 → 汇总去重。展示 map 并发 + token。

每个：`<system>/agent/workflows/<key>/workflow.ts`，真实 profile、完整 `wf.chart` 构图、whenToUse 写清触发场景（leader 据此选用）、结构化返回值。

## D3. Leader 引导

- 检查 A5 的 WorkflowCatalog fragment 文案：确认「先读 reference 再写 workflow」指引指向 D1 的实际路径。
- 若 leader profile 有 skill/工具使用总纲文档，补一行 workflow 使用纪律。

## 验证

- 每个内置 workflow 在 `/workflow.preview`（或正式入口）真跑一遍 mock/真实通道。
- `bun run typecheck`；文档交叉链接检查（勿留旧路径）。
