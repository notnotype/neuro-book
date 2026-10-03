# Round 303 - Preview Demo Schema Guard

## 背景

主 Workbench 已经会在自定义 schema 不适配内置示例世界时禁用“一键示例世界”。但独立 `/world-engine.preview` 的“创建示例世界”按钮仍只看 Project / schema 是否存在。

对于 `ming-ding-zhi-shi-2` 这类自定义 schema，内置示例依赖的 `character.events` 等字段并不存在。作者刚设置好项目 schema 后，如果在 Preview 点“创建示例世界”，会点下后才看到 schema 不匹配错误。

## 实际变更

- `world-engine.preview.vue`
  - 新增 `previewDemoSchemaError`，复用 `validatePreviewDemoSchema(schemaTypes, subjects)`。
  - 新增 `canSeedDemoWorld`，只有 Project ready、schema 已加载且 demo schema 校验通过时才允许点击。
  - 新增 `demoWorldButtonTitle`，schema 不适配时把原因挂到按钮 title。
  - `seedDemoWorld()` 函数入口继续使用同一个 `previewDemoSchemaError`，保留事件绕过按钮时的保护。

- `WorldEnginePreviewProjectPanel.vue`
  - 接收 `canSeedDemoWorld` 与 `demoWorldButtonTitle`。
  - “创建示例世界”按钮在 schema 不适配时禁用，并显示 title 原因。

- `world-engine-ide-entry.test.ts`
  - 增加静态契约断言，确认 Preview 示例世界入口有 schema guard。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

两项均通过。

## 与计划出入

- 本轮没有改变内置示例世界数据，也没有扩展示例世界适配自定义 schema。
- 本轮没有自动浏览器验证，符合当前约定。
