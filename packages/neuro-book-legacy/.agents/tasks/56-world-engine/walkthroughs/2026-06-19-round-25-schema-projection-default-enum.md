# Round 25 - schema 投影 default / enum 补齐

## 背景

本轮继续做 World Engine 的代码审查。`getWorldSchema` 是 Agent 和 Preview 写 mutation 前读取的“地图”。此前投影只返回 `name / kind / type / desc`，缺少 schema 中已经存在的 `enum` 与 `default`。

风险：

- Agent 面对 `type: enum` 的属性时不知道合法候选值，容易写出后端拒绝的 value。
- Preview 的 Mutation Builder 只能为 enum 生成空字符串，用户第一次点击就可能得到非法 mutation。
- schema 已经声明了 default，但工具/UI 不使用，浪费了项目配置里的有效信息。

## 本轮计划

1. `getWorldSchema` 的 attr 投影补充 `enum` 与 `default`。
2. Preview 的默认 mutation 生成优先使用 `default`，没有 default 时 enum 使用第一个候选值。
3. 补测试覆盖后端投影与 Preview 默认值推导。

## 实现

- 更新 `server/world-engine/types.ts`：
  - `WorldSchemaProjection.subjectTypes[].attrs[]` 增加 `enum?: JsonValue[]` 与 `default?: JsonValue`。
- 更新 `server/world-engine/schema-loader.ts`：
  - `flattenAttrs()` 在投影 attr 时保留 `enum` 与 `default`。
- 更新 `app/utils/world-engine-preview.ts`：
  - `WorldPreviewSchemaAttr` 增加 `enum/default`。
  - `defaultMutationForPreviewAttr()` 的 value 推导优先使用 schema default。
  - enum 属性无 default 时使用第一个 enum 候选值。
- 更新 `app/pages/world-engine.preview.vue`：
  - schema 投影改用 `shallowRef`。原因是 `default` 使用递归 `JsonValue` 类型，放进 Vue 深层 `ref` 会触发类型递归展开过深；schema 是整块替换的只读投影，不需要深层响应式。

## 验证

- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts app/utils/world-engine-preview.test.ts`
  - 4 个测试文件通过。
  - 33 个测试用例通过。
- `bun run typecheck`
  - 通过。

## 与计划的出入

本轮原计划审查 schema 投影，实际发现并修复了两个相关问题：

- 投影缺少 `enum/default`，会直接影响 Agent/Preview 生成合法 mutation。
- 增加递归 `JsonValue` 字段后，Preview 页面需要把 schema 从深层 `ref` 改为 `shallowRef`，否则 Vue 类型系统会在 computed 推导时爆栈。

仍未自动做浏览器验证。项目指令要求不要自动浏览器验证；后续需用户确认后再打开 `/world-engine.preview` 做真实页面验收。

## 后续

- 浏览器验证时重点确认：Schema 面板里 enum/default 投影能正常加载，Mutation Builder 点击 enum attr 时能生成合法默认 value。
- 更完整的正式 UI 后续应把 enum 显示为下拉选择，而不是只填默认 JSON value。
