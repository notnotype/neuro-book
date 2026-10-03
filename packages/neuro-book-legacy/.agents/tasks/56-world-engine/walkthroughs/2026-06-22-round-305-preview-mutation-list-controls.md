# Round 305 - Preview Mutation List Controls

## 背景

上一轮已经把独立 `/world-engine.preview` 的创建、写入和查询入口补上基础护栏。继续按作者真实路径审查时，新的卡点出现在第一条多 subject slice：Mutation Builder 只能追加或替换全部，作者如果想调整第二条 mutation、复制相似 mutation、删除其中一条或改变顺序，只能直接手改 JSON。

主 Workbench 已经有成熟的 mutation 列表控制和动作按钮，底层 `world-engine-preview` util 也已经提供插入、替换、复制、删除、移动和索引夹取函数，所以本轮只把这些现有能力接到独立 Preview。

## 实际变更

- `world-engine.preview.vue`
  - 新增 `mutationLoadIndex`、`mutationLoadOptions`、`canUseSelectedMutation`。
  - 新增从 mutations JSON 载入所选 mutation 到 Builder 的能力。
  - 新增替换所选、插入其后、复制所选、删除所选、上移 / 下移所选 mutation。
  - 手写 JSON 导致列表变短时自动夹取 selection。
  - 切换 Project 时重置 mutation selection。

- `WorldEnginePreviewActions.vue`
  - 把 mutation selection props 和单条编辑事件转发给 Preview Builder。

- `WorldEnginePreviewMutationBuilder.vue`
  - 复用 `WorldEngineMutationListControls`。
  - 复用 `WorldEngineMutationActionButtons`。
  - 保留原有 schema-aware subject / attr / op / value 输入、object 护栏与 `collectionRemove` 当前状态候选。

- `world-engine-ide-entry.test.ts`
  - 增加 Preview mutation 单条编辑接线的静态契约断言。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`：通过。
- `bun run typecheck`：未通过，但剩余错误不在本轮 World Engine 修改范围内，集中在 Agent `pendingApproval/pendingApprovals`、`pendingResolution/pendingResolutions` 类型漂移，以及相关 approval DTO 形状不一致。

## 与计划出入

- 本轮没有修改后端、API、schema 或 Agent tool。
- 本轮没有新增行为测试；现有 mutation 列表 util 已有覆盖，本轮只补 Preview 接线静态契约。
- 本轮没有自动浏览器验证，符合当前约定。
