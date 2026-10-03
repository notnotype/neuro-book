# Round 299 - Preview Subject Create Guard

## 背景

继续从作者真实流程检查独立 `/world-engine.preview`：新建 Project、设置 schema 后，下一步常见动作是手动创建 subject。

主 Workbench 的 `WorldEngineSubjectCreator` 已经有必填项禁用和连续录入保护，但 Preview 的 `创建 Subject` 按钮只看 Project 是否已选，不看 `id / type / time` 是否为空。创建成功后还会把刚创建的 id 留在表单里，作者连续操作时容易重复点击同一个 id，撞 duplicate。

这不是后端边界问题，而是 Preview 作者路径的第一轮录入体验问题。

## 实际变更

- `WorldEnginePreviewActions.vue`
  - 新增 `canCreateSubject`。
  - `创建 Subject` 按钮现在要求 Project ready、非 busy、`subjectForm.id/type/time` 均非空才可点击。

- `world-engine.preview.vue`
  - `createSubject()` 函数入口也前置校验：
    - `subject id 不能为空`
    - `subject type 不能为空`
    - `subject time 不能为空`
  - 创建成功后清空 `subjectForm.id/name`，保留 `type/time`，方便连续录入同类型 subject。
  - `queryForm.subjectIds` 和 Mutation Builder 仍聚焦刚创建的 subject，写下一条 slice / 查询状态的上下文不丢。

- `world-engine-ide-entry.test.ts`
  - 增加静态契约断言，锁住 Preview 创建 subject 的必填校验、按钮禁用和连续录入清空行为。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

两项均通过。

## 与计划出入

- 本轮没有改后端；后端仍保留最终校验。
- 本轮没有自动浏览器验证，符合当前约定。
- 本轮只处理独立 Preview；主 Workbench 已有同类保护。
