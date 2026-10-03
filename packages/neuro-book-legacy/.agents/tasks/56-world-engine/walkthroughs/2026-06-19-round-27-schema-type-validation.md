# Round 27 - schema type/itemType 配置校验

## 背景

本轮继续审查 World Engine 的 schema loader。Round 26 已经把 `enum/default` 的结构边界提前到加载阶段，本轮检查更基础的 `type/itemType` 字段。

发现的问题：

- schema 设计文档只允许 `int / float / text / bool / enum / ref(<type>)`。
- 旧 loader 不校验 `type/itemType`，因此 `type: integer` 这类拼写错误会进入运行时。
- 运行时 `validateValue()` 对未知 type 没有明确校验分支，可能导致错误配置降低校验强度。
- `list/collection` 如果没有 `itemType`，后续元素类型也无法校验。

## 本轮计划

1. 在 schema loading 阶段校验 `type/itemType` 必须是已知值类型或合法 `ref(...)`。
2. 要求 `list/collection` 必须声明 `itemType`。
3. 要求 `type/itemType=enum` 时必须声明非空 `enum`。
4. 补测试覆盖坏配置提前失败。

## 实现

- 更新 `server/world-engine/schema-loader.ts`：
  - 新增 `VALUE_TYPES` 白名单：`int / float / text / bool / enum`。
  - 新增 `readValueType()` 校验 `type` 与 `itemType`。
  - `ref(...)` 只允许非空、无空白目标，如 `ref(location)`。
  - 新增 `assertAttrShape()`：
    - `list/collection` 必须声明 `itemType`。
    - `object` 不能同时声明 `fields` 和 `itemType`，避免固定结构与开放字典混用。
    - `enum` 类型必须声明非空 enum。
    - 非 enum 类型不能声明 enum。
- 更新 `server/world-engine/world-engine.facade.test.ts`：
  - 覆盖 `type: integer` 报错。
  - 覆盖 `kind: list` 缺少 `itemType` 报错。
  - 覆盖 `type: enum` 缺少 enum 候选值报错。

## 验证

- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts app/utils/world-engine-preview.test.ts`
  - 4 个测试文件通过。
  - 35 个测试用例通过。
- `bun run typecheck`
  - 通过。

## 与计划的出入

本轮原计划是收紧 `type/itemType` 配置边界，实际修复范围与计划一致。额外补了 `object.fields` 与 `object.itemType` 不能同时声明的结构约束，因为当前设计里二者分别代表固定结构和开放字典，混用会让语义不清楚。

仍未自动浏览器验证。项目指令要求必须用户确认后才能打开浏览器；本轮属于 schema loader 后端输入边界修复，不替代页面验收。

## 后续

- 浏览器验证仍是当前总任务缺口：需要在 `/world-engine.preview` 新建 Project、跑一键示例世界、编辑过去 slice、执行 re-settle，并评估体验。
- schema loader 后续还可以审查 `desc`、subject type 名称、attr path 名称是否需要格式限制；目前先保留宽松。
