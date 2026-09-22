---
schema: nbook.task/v2
taskId: t03-code-editor-commands
role: tasker
---

# CodeEditorView 行导航能力与编辑命令

## 目标

让真实 Monaco 编辑器成为命令宿主样板：暴露行导航能力，注册四条编辑命令，按钮与命令同入口。详细合同见计划 §4（`local://workbench-command-foundation-plan.md`）。

## 范围

1. `app/components/editor-workbench/editor-view.types.ts`：`TextEditorHandle`/`EditorViewHandle` 增加可选 `navigation?: EditorLineNavigation`（`getLineCount`/`revealLine`）；`CommandEditorBinding` 类型同文件导出。
2. `MonacoCodeEditor.vue`：defineExpose 增加 navigation；未就绪/disposed 失败；`Number.isSafeInteger(line)` 且 `1<=line<=model.getLineCount()`，拒绝不 clamp；成功 `setPosition({lineNumber,column:1})`、`revealLineInCenter`、`focus()`；空正文一行。
3. `CodeEditorView.vue`：`ready()` 透传 core navigation，不 import 注册表。
4. 新增 `app/utils/workbench/editor-commands.ts`：`registerEditorCommands(registry, getActive)` 注册四条命令（focus/undo/redo/go-to-line），when/effect/expose/参数表见计划 §4；执行时取当前句柄；undo/redo 前后 flush；go-to-line 用 `matchesEditorDocument` 检查 target，不匹配 stale-target；中途失败回滚。
5. `app/i18n/locales/zh-CN.ts` / `en-US.ts`：`workbenchCommands` 字典（四条命令 + 两个 category），英文 description 按计划 §4。
6. `CodeEditorViewFixture.vue`：按钮统一走 registry（disabled 同源）；注册生命周期绑定 ready identity（新 ready 注册新 descriptor、ready(null)/换代先释放）；generation 用 host `allocateEditorGeneration`；旧回调带捕获 generation 校验；控制栏加“命令面板”“模拟调用模式”“以 agent 执行撤销”。场景新增 `command-navigation`（60 行 plaintext）与 `commands-unavailable`；`fixtures/index.ts` 同步。
7. 测试：`editor-commands.test.ts`（注册/释放/stale-target/只读阻断/flush 调用）；CodeEditorView ready-before-update 既有测试保持。

## 验证

```bash
bun run --cwd packages/neuro-book test -- app/utils/workbench/editor-commands.test.ts app/components/editor-workbench
bun run --cwd packages/neuro-book typecheck
```

## 边界

- 不改 `load-monaco-editor.ts` 的 worker 映射；不引入符号导航；不动 Markdown/mock 句柄的合法「无 navigation」状态。

## 依赖

t02（commands.ts / host）。
