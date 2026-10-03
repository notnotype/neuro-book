# 2026-06-20 Inspector Slice Health

## Context

上一轮浏览器截图显示：默认选中 clean slice 时，右侧 Inspector 会先显示全局 `Review Queue`，但当前切片本身没有 issue。用户容易把“全局还有 open issue”理解成“当前切片有问题”。

本轮把 Inspector 的信息层级调整为：先说明当前 slice 的健康状态，再展示当前 slice issues，最后展示跨 slice 的全局 Review Queue。

## Changes

- `WorldEngineWorkbenchPreviewInspector` 新增 `SliceHealthSummary`。
- Inspector 在 metadata 后新增 `Slice Health` 摘要卡：
  - clean slice：显示 `当前切片 clean`、触及 subjects 数和 mutation 数。
  - open slice：显示 `当前切片需要 review`，并列出 `total / open / confirmed / ignored`。
  - done slice：显示 `当前切片 review done`。
- `Review Issues` 从全局 `Review Queue` 后移到前面，优先展示当前切片问题。
- `Review Queue` 保持原有 open-only / all 模式、上一个 / 下一个跳转和 triage progress，但作为跨切片队列放在当前切片问题之后。
- 目标契约测试补充 slice health 相关关键字符串。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`：通过，5 个测试全部通过。
- `bun run typecheck`：通过。
- 浏览器验证：
  - `GET http://localhost:3000/world-engine.workbench-preview` 返回 200。
  - Chrome DevTools Protocol 1366x900 默认 clean slice 截图通过：`当前切片 clean` 出现在 metadata 后，Review Queue 仍保留但语义变成全局队列。
  - Chrome DevTools Protocol 1366x900 open issue slice 截图通过：右侧顺序为 `当前切片需要 review` -> `Review Issues` -> `Review Queue`，当前 issue 的 `base-shifted` 可见，队列仍显示 `1 / 2`。

## Notes

- 本轮没有新增 mock API 字段，slice health 完全从当前 slice issues 与本地 triage 状态派生。
- 右侧面板纵向内容变多，但当前 clean / open 两种关键状态都能在 1366x900 首屏看到 health 摘要；State Snapshot 会自然下移，符合“先上下文、再状态检查”的检查流程。
