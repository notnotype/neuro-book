# World Engine Workbench Redesign Current State Doc Sync

## Context

`docs/tasks/59-world-engine-workbench-redesign/README.md` 是 mock Workbench 设计任务的主说明，但当前实现已经由 `docs/tasks/61-world-engine-workbench-real-api` 把三栏设计接入真实主 IDE Workbench。

继续核对后发现 59 号 README 的 Current State / Decisions / Verification / TODO 仍保留旧快照：

- 独立 Preview 仍描述为包含 resettle。
- 主 IDE Workbench 仍描述为旧 `Timeline / Edit / State / Schema` tab 和右侧 Resettle。
- mock preview 仍描述为“后续接真实 API”。
- Verification 仍写“当前用户已允许自动浏览器验证”，与当前仓库指令“不要自动进行浏览器验证”冲突。
- `createSubject` 初始化切片语义仍是旧的“已有 instant 就 append”，缺少非空 default / 只追加 init slice / 非 init 冲突 409 的当前合同。

## Changes

- 将 59 号 README 的 Current State 改为当前事实：
  - `/world-engine.preview` 是无 re-settle 的 API 调试页。
  - `/world-engine.workbench-preview` 是 mock-only 设计沙盘。
  - `WorldEngineWorkbenchDialog` 已是接真实 API 的三栏 Workbench。
- 同步 `createSubject` 当前合同：
  - default 为空只注册 subject 身份。
  - default 非空才写 init mutation。
  - 同 instant 只会追加到 `kind=init` slice；非 init slice 返回 409。
- 更新 Decisions：
  - mock preview 继续作为设计沙盘。
  - 真实 Dialog 使用“保存到世界”并通过 `editSlice` 保存 metadata。
  - 复杂新建 / 整块编辑通过主 Dialog 内 Slice Composer 复用 schema-aware Mutation Builder。
- 更新 Verification / TODO：
  - 真实 API 接入契约归到 61 号任务。
  - 不自动执行浏览器验证；需要时由用户明确允许。
  - 后续重点保留为 State Snapshot 性能策略和真实 issue triage 持久化合同。

## Verification

- `rg -n "resettle|Resettle|后续接真实 API|当前用户已允许自动浏览器验证|三栏 \\+ tab|右侧 Inspector / Resettle|它不接真实 API|旧调试页|mock 阶段|接 API 时|真实接入前" docs/tasks/59-world-engine-workbench-redesign/README.md`

结果只剩历史 Implementation Walkthrough 中的 “mock 阶段按钮文案为应用到预览”，这是历史记录，不属于当前态误导。

## Result

实际结果与计划一致：只同步 59 号设计任务文档的当前态，不改代码、不改变 API、不自动执行浏览器验证。
