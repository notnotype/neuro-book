# Round 407: World Subject Bootstrap

## 背景

Round 406 临时 Project 浏览器验收发现一个真实作者流卡点：schema 里有 `world` type 和 `world.events`，但 Project 尚未创建 `world` subject 时，作者会自然尝试写 `world.events`，最后得到 `subject 不存在：world`。

这不是后端边界问题，而是 Workbench 引导问题：界面展示了未实例化 subject type 的 schema shortcut，却没有显式告诉作者需要先创建对应 subject。

## 本轮目标

- 不自动创建 `world` subject，避免打开 Workbench 或同步主体系统时静默写 Project SQLite。
- 给作者一个显式创建 `world` subject 的入口。
- 禁止 schema shortcut 在找不到同类型 subject 时回退到其它 subject。

## 实现

- `WorldEngineWorkbenchDialog.vue`
  - 新增 `canCreateWorldSubject` 判断：schema 声明 `world` type 且当前不存在 id 为 `world` 的 World Engine subject。
  - 左栏新增 `world-subject-bootstrap-panel`，显示初始化时间和 `创建 world subject` 按钮。
  - 空状态新增 `create-world-subject` action，内置示例不可用且可创建 world 时直接给主画布按钮。
  - `createWorldSubject()` 调用现有 `POST /api/projects/world-engine/subjects`：
    - `id: "world"`
    - `type: "world"`
    - `name: "世界"`
    - `time: schema.calendar.examples[0] ?? selectedSlice.time`
  - 成功后选中 / 聚焦 `world`，刷新 timeline/state，并记录 API 返回 issues。
  - 文案明确该动作只创建 World Engine subject，不写 `simulation/subjects` 六文件。

- `WorldEngineMutationEditor.vue`
  - `subjectIdForSchemaType()` 只返回真实存在的同类型 subject id。
  - schema shortcut 找不到同类型 subject 时会禁用，并用 title 提示 `当前 Project 还没有 ${typeName} subject`。
  - 如果仍触发 `fillMutation()`，会显示错误，不再回退到第一个 subject 或 `world`。

- `world-engine-ide-entry.test.ts`
  - 增加静态契约，钉住显式创建入口和 shortcut 不回退行为。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
  - 通过：1 file，3 tests。
- `bun run typecheck`
  - 仍失败于既有无关 `server/agent/tools/control-tools.test.ts` 类型漂移：
    - `UserInputFormSpec | Promise<UserInputFormSpec | null>` 的 `.form`
    - `ImageContent | TextContent` 的 `.text`
  - 未出现 World Engine / Workbench 新错误。

## 与计划出入

- 原本 Round 406 后还在“自动创建 / 引导创建 / 隐藏 shortcut”之间待决策。
- 本轮实际采用组合方案：
  - 不自动创建。
  - 显式引导创建 `world` subject。
  - 禁用未实例化 type 的 schema shortcut。

## 后续

- 还未启动浏览器复验。后续可用临时 Project 验证：
  - 同步 `player` 后左栏出现 `world subject` panel。
  - 点击 `创建 world subject` 后 Composer schema shortcut 可使用 `world.events`。
  - 继续写 `world.events` 不再报 `subject 不存在：world`。
