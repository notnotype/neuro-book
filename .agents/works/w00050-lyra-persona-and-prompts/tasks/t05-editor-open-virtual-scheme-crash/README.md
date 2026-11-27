---
schema: nbook.task/v2
taskId: t05-editor-open-virtual-scheme-crash
status: done
updated: 2026-11-27
---

# 修复点击对话文件改动打开 profile:// 等非工作区方案时编辑器抛错卡死

## 目标与范围

修复点击 Agent 对话底部的文件改动标签（`.agent-file-changes__chip`）打开 `profile://memory/master.md` 等非工作区方案文件时，`nbook.editor.open` 抛出异常并导致整个编辑器卡死、无法切换标签页的 Bug。

### 复现现象与报错

当 Agent 修改 `profile://memory/master.md` 后，用户点击对话消息底部的 `.agent-file-changes__chip` 按钮，编辑器未打开文件，控制台报错：
- `[error] commands.run-failed: 命令 nbook.editor.open 执行时抛出异常`
- `[Vue warn]: Unhandled error during execution of component update at <NestedGrid> ... at <WorkbenchSurface>`
- 此后整个工作台编辑器无法切换任何标签页。

### 已查明的根因链条

1. [`packages/nb-agent-ui/src/vue/stream/AgentFileChanges.vue`](../../../../../packages/nb-agent-ui/src/vue/stream/AgentFileChanges.vue) 点击 `.agent-file-changes__chip` 时直接触发 `emit('open', file.path)`（传入 `profile://memory/master.md`）。
2. [`packages/neuro-book/src/plugins/agent/web/plugin.ts`](../../../../../packages/neuro-book/src/plugins/agent/web/plugin.ts) 的 `openAddress` 直接调用 `commands.execute("nbook.editor.open", {address, mode: "permanent"})`。
3. [`packages/neuro-book/src/plugins/editor/web/area.ts`](../../../../../packages/neuro-book/src/plugins/editor/web/area.ts) 的 `open(address, given)` **未在入口处校验 `parseResource(address)`**，直接调用 `groups.open(address, ...)` 将 `address: "profile://memory/master.md"` 作为活动标签推入了响应式 `groups` 状态。
4. 随后在 `options.opened?.(address)` 及 Vue 组件树更新渲染该活动标签（`referenceOf(tab)` → `documents.open(tab.address)` → [`packages/neuro-book/src/plugins/editor/web/documents/address.ts`](../../../../../packages/neuro-book/src/plugins/editor/web/documents/address.ts) 的 `resourceOf(address)`）时，`parseResource(address)`（[`packages/neuro-book/src/plugins/files/shared/resource.ts`](../../../../../packages/neuro-book/src/plugins/files/shared/resource.ts)，仅认 `SCHEMES = ["project", "user"]`）返回 `{ok: false, code: "unknown-scheme", detail: "没有方案 profile://"}`，`resourceOf` 直接抛出 `RangeError: 没有方案 profile://`。
5. 由于含非法地址的 Tab 已被塞入 `groups` 成为活动标签，后续每次切换标签或触发 `WorkbenchSurface` / `NestedGrid` 更新都会再次调用 `resourceOf(tab.address)` 抛错，导致整个编辑器彻底锁死。

### 修复要点

1. **编辑器入口防线（阻断崩溃）**：`editor/web/area.ts` 的 `open()` 在推入 `groups` 前必须校验 `parseResource(address)`；遇到不支持的方案或非法地址时直接返回 `{ok: false, reason: ...}`，绝不将非法地址写入 `groups` 污染响应式状态。
2. **支持从对话改动打开 `profile://` / `session://` 文件**：在 `agent/web/plugin.ts` 的 `openAddress` 或文件/编辑器层打通 `profile://`（展开为 `profiles://<profileKey>/...`）的查看/编辑能力，或对编辑器不支持打开的虚拟方案给出明确提示。

合同：涉及 `packages/neuro-book/src/plugins/editor/web/area.ts`、`packages/neuro-book/src/plugins/agent/web/plugin.ts` 及配套回归测试。

## 当前状态

2026-11-27 由 [w00058 t01](../../../w00058-agent-resources-in-workbench/tasks/t01-resources-design/README.md) 接手：

- 修复要点 1 已完成并合入 master（`d95b0daea`、`8af62d6bc`）：`area.ts` 的 `open()` 在入口拒绝浏览器认不出的地址并说明原因，对话里点到这类地址时弹出原因；`area.test.ts` 有对应用例。
- 修复要点 2（能打开 `profile://`、`session://` 的文件）并入 w00058 t01 的计划：实现浏览器访问已注册方案后，从对话里打开写入当时的全局地址。

本 Task 不再单独推进。
