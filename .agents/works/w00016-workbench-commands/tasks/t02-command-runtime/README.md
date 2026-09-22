---
schema: nbook.task/v2
taskId: t02-command-runtime
---

# 命令运行时：共享上下文、注册表与最小键位

## 目标

在 `.worktree/w00003-neurobook-ui-foundation-migration` 实现命令系统纯逻辑底座与 Lab 宿主最小接线。详细合同以本会话计划 §2、§3 为准（`local://workbench-command-foundation-plan.md`，恢复用）。

## 范围

1. 新增 `packages/neuro-book/app/utils/workbench/context-keys.ts`：`ContextKey`（既有四个 + `editor-focus/quick-open-visible/agent-panel-open/editor-active/editor-writable/editor-line-navigation`）、`ContextValues`、`WhenPredicate`、`validateWhen`、`evaluateContextWhen`；`Object.hasOwn` 登记判定，缺失已登记键=false，requires 为 all-of；原因文案见计划 §2。
2. 改造 `app/utils/workbench/descriptors.ts`：`ViewWhen` 引用 `ContextKey`；`evaluateWhen` 映射共享结果；`whenProblems` 调共享校验；删除本地 `REQUIREMENT_CHECKS/VIEW_REQUIREMENT_KEYS/ViewRequirementKey`。authority 表不迁移；`components/workbench-spike/` 私有同名类型不动。`descriptors.test.ts` 中两处钉整句文案的断言改写为行为断言（未知键失败、缺键 false），不钉新措辞。
3. 新增 `app/utils/workbench/commands.ts`：完整接口与行为见计划 §2（`CommandResult`、九个失败码、`createCommandRegistry`、注册/幂等/冲突/别名/释放语义、执行顺序、agent 暴露与只读、确认快照与 stale-target、单次审计、`isCommandEnabled` 语义）。严格校验用 `typebox` 的 `Value.Check/Value.Errors`，不做 Convert/default；无参 schema `Type.Object({}, {additionalProperties:false})`，省略 args 归一 `{}`，null 不归一。
4. 新增 `app/utils/workbench/keymap.ts`：`parseKeybinding` 与 `createKeymapDispatcher`（返回 `{handle, dispose}`，onDidChange 重建、dispose 幂等）；单键组合、精确修饰位匹配、Mod 平台映射；同键冲突两环境均不启用后来者并报告一次；不符合的键不拦截、命中后 `preventDefault+stopImmediatePropagation`。
5. 新增 `app/composables/useWorkbenchCommands.ts`：`provideWorkbenchCommands`/`useWorkbenchCommands`，InjectionKey + release 模式（参照 `useWorkbenchChrome.ts`）；host 持有 registry/context/agentMode/revision 及计划 §6 的 `palette`、`activeEditor`、`editorRevision`、`recentCommandIds`、`allocateEditorGeneration` 骨架（step 5 前先建立接口与释放）。
6. LabShell 最小接线：setup 调 provider（`development:import.meta.dev`），卸载释放；暂不注册具体命令、不加命令 tab（t05 补齐）。
7. 测试：`context-keys.test.ts`、`commands.test.ts`、`keymap.test.ts`、`useWorkbenchCommands.test.ts`，覆盖矩阵见计划 §验证（注册/释放/冲突/别名、when 三面、args 严格性、隔离、审计路径、宿主隔离与卸载）。

## 验证

```bash
bun run --cwd packages/neuro-book test -- app/utils/workbench app/composables/useWorkbenchCommands.test.ts
bun run --cwd packages/neuro-book typecheck
```

## 边界

- 不注册六个业务命令（t03/t05）；不做 QuickInput/palette UI；不迁移 L2/L3 代码；不引入第三方命令框架。

## 依赖

t01（规范）；与 t04 并行但不同包。
