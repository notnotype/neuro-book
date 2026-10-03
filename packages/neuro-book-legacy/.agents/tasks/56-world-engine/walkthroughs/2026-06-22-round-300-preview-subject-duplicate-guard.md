# Round 300 - Preview Subject Duplicate Guard

## 背景

Round 299 让独立 `/world-engine.preview` 的创建 subject 支持必填项前置校验和连续录入。但继续沿作者路径检查时发现另一个日常误操作：

作者点击左侧已有 subject 时，Preview 会把该 subject 载入查询 / 创建表单，方便查看状态和写 slice。但此时 `创建 Subject` 仍可能可点，作者很容易把已有 id 再提交一次，撞后端 duplicate。

这不是后端边界问题，而是同一个表单同时承担“创建草稿”和“当前 subject 上下文”时的入口歧义。

## 实际变更

- `WorldEnginePreviewActions.vue`
  - 新增 `subjectIdAlreadyExists`。
  - `canCreateSubject` 现在要求当前 id 不在已加载 subjects 中。
  - 当前 id 已存在时，在按钮上方显示提示：该 subject 已存在；点击左侧 subject 是载入查询上下文，新建 subject 需要填写新 id。

- `world-engine.preview.vue`
  - `createSubject()` 函数入口也检查 `subjects.value` 中是否已有同 id。
  - 已存在时直接显示 `subject <id> 已存在，请填写新的 id`，不再请求后端。

- `world-engine-ide-entry.test.ts`
  - 增加静态契约断言，确认按钮禁用、提示文案和函数入口重复 id 拦截存在。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

两项均通过。

## 与计划出入

- 本轮没有改后端；后端 duplicate 校验仍作为最终保护。
- 本轮没有自动浏览器验证，符合当前约定。
