# Round 278: Edit Slice Builder Sync

## Context

继续检查“创建 subject 后推演几步 slice，并覆盖常用操作”的编辑路径。当前作者可以通过顶栏 `编辑 Slice` 或 Composer 内 `载入所选 Slice` 把当前 slice 载入编辑表单；textarea 会替换成该 slice 的 mutations。

问题是右侧 Mutation Builder 仍停在载入前的新建默认值。作者看到 textarea 已是当前 slice，很容易以为 Builder 也已经对齐，然后直接点 `替换所选`，结果会把旧默认 mutation 写入当前 slice。

## Changes

- `WorldEngineMutationEditor.vue`
  - `forceLoadSelectedSlice()` 在写入 slice 表单与 `mutationLoadIndex = "0"` 后，如果当前 slice 有 mutations，会静默执行 `loadMutationToBuilder(0, true)`。
  - 这样 `textarea`、mutation 选择器和 Builder 表单在进入编辑模式时默认指向同一条 mutation。

- `world-engine-ide-entry.test.ts`
  - 补充编辑 slice 载入后 Builder 自动同步第一条 mutation 的静态契约。

## Verification

均通过：

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

## Browser

本轮不自动执行浏览器验证。后续授权浏览器验收时，可覆盖：选中一条已有 slice，点击 `编辑 Slice` 后，textarea 和 Builder 应同时显示该 slice 的第一条 mutation；不需要再额外点击 Builder 的 `载入`。

## Result

实际结果与本轮目标一致：没有改变后端 editSlice 语义，也没有扩展 Builder 功能；只修正常用编辑入口的 UI 状态对齐，降低误替换 mutation 的风险。
