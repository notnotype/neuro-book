# Round 306 - Mutation Empty Draft Append

## 背景

Round 305 把独立 Preview 的多 mutation 单条编辑能力接上后，继续按作者真实路径复查，发现一个紧接着会撞到的闭环问题：

1. 作者在 Builder 里删除最后一条 mutation。
2. textarea 变成 `[]`，提示“保存前请先添加新的 mutation”。
3. 作者点击“追加”想补回一条 mutation。
4. 旧逻辑复用 `parseMutationJson("[]")`，因为提交契约要求 mutations 非空，于是直接报 `mutations 必须是非空数组`。

这不是后端畸形输入，而是正常编辑路径里的临时空草稿。

## 实际变更

- `app/utils/world-engine-preview.ts`
  - 新增 `parseMutationListJson()`，用于编辑器内部解析 mutations 列表，允许 `[]`。
  - `parseMutationJson()` 继续调用列表解析后额外拒绝空数组，保持提交前非空契约。

- `app/pages/world-engine.preview.vue`
  - Preview Builder 的“追加”改用 `parseMutationListJson()` 读取当前列表。
  - 删除最后一条后可直接追加新 mutation。

- `app/components/novel-ide/world-engine/WorldEngineMutationEditor.vue`
  - 主 IDE Slice Composer 的“追加”同步改用 `parseMutationListJson()`。
  - 主界面和独立 Preview 的编辑体验保持一致。

- `app/utils/world-engine-preview.test.ts`
  - 增加窄行为断言：`parseMutationJson("[]")` 仍拒绝，`parseMutationListJson("[]")` 接受。

## 验证

- `bunx vitest run app/utils/world-engine-preview.test.ts`
- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`

两项均通过。

## 与计划出入

- 本轮没有放松真实保存 / API / 后端契约。
- 本轮没有新增浏览器验证，符合当前约定。
- 本轮没有运行全量 `bun run typecheck`；上一轮已确认当前 typecheck 被无关 Agent pending approval / resolution 类型漂移阻塞。
