# Round 288: 连续推演 Subject 语境保持

## Context

Round 287 处理了自定义 schema 下内置示例世界入口误导的问题。继续沿着真实作者推演路径检查时，下一处卡点出现在 `写入并继续下一步`。

`ming-ding-zhi-shi-2` 这类 schema 中，角色 subject 可能没有自己的 `events` 字段，Slice Composer 会把默认 mutation 回退到 `world.events listAppend`。这让第一条 slice 可以顺利保存，但保存并继续时，旧逻辑会把“上一条 mutation 的实际 subject”当作下一步上下文，于是作者原本在推演 `player`，下一步却被带到 `world` 语境。

## Changes

- `WorldEngineMutationEditor.vue`
  - 保存时计算 `contextSubjectId`。
  - 如果上一条 mutation 正好是“当前 selected subject 的默认 fallback mutation”，连续写入会保留 selected subject 作为下一步上下文。
  - 下一步草稿用 `contextSubjectId` 生成默认 mutation，继续保持 textarea 与 Builder 同步。
  - `saved` 事件 payload 增加 `contextSubjectId`。
- `WorldEngineWorkbenchDialog.vue`
  - `handleSliceComposerSaved()` 在 `continueAfterSave` 时用 `payload.contextSubjectId` 更新 `focusedSubjectId`，不再直接使用最后一条 mutation 的实际 subject。
- `world-engine-ide-entry.test.ts`
  - 补父子组件事件契约静态断言，避免连续写入上下文再次退回 last mutation subject。

## Validation

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

两项均通过。本轮未自动执行浏览器验证。

## Plan Diff

计划目标是继续推进“推演几步切片”的真实用户流。实际只收敛了连续保存后的 subject 语境保持；没有改后端 API、没有改变 subject 过滤策略，也没有自动做浏览器验收。
