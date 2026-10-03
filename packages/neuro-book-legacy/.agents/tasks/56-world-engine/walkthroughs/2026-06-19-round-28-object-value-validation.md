# Round 28 - object set/default 子值校验

## 背景

本轮继续审查 World Engine 的运行时 schema 校验。`object` 在设计里统一承载两类结构：

- 固定结构：声明 `fields`，例如 `equipment.weapon`。
- 开放字典：声明 `itemType`，例如 `memory` 的 topic -> text。

审查 `WorldEngineService.validateValue()` 时发现当前实现把 `attrSchema.type ?? attrSchema.itemType` 直接用于所有属性：

- 对开放字典 object，整体 `set memory = { capital: "..." }` 会被误判成 `memory 必须是 text`。
- 对固定 fields object，整体 `set equipment = { weapon: "subject://..." }` 没有按子字段 schema 校验。
- object default 只检查是否为 object，没有校验内部值。

## 本轮计划

1. `object` 整体 set 时先校验 value 必须是 object。
2. 固定 `fields` object：只允许声明过的字段，并按字段 schema 校验 value。
3. 开放 `itemType` object：逐个 key 校验 value 类型。
4. object default 使用同一套子值校验。

## 实现

- 更新 `server/world-engine/world-engine.service.ts`：
  - `validateValue()` 遇到 object attr 时走 `validateObjectValue()`，不再把 `itemType` 当成 object 自身类型。
  - 新增 `validateObjectValue()`：
    - 非 object value 报错。
    - `fields` 模式下拒绝未声明字段，并递归按字段 schema 校验。
    - `itemType` 模式下逐 key 校验 value。
  - 新增 `validateValueBySchema()` / `validateTypedValue()`，让普通 mutation 与 default 校验共用同一套类型判断，同时保留原有错误文案风格。
- 更新 `server/world-engine/world-engine.facade.test.ts`：
  - 覆盖开放字典 object 整体 set 成功。
  - 覆盖固定 fields object 整体 set 成功。
  - 覆盖开放字典 value 类型错误报错。
  - 覆盖固定 fields object 未声明字段报错。
  - 覆盖 object default 内部 value 类型错误报错。

## 验证

- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts app/utils/world-engine-preview.test.ts`
  - 4 个测试文件通过。
  - 37 个测试用例通过。
- `bun run typecheck`
  - 通过。

## 与计划的出入

本轮原计划是修复 object 整体 `set/default` 的校验语义，实际范围与计划一致。没有做浏览器验证；项目指令要求必须用户确认后才能打开浏览器，本轮仍属于后端核心语义修复。

## 后续

- 浏览器验证时可额外尝试用 Mutation Builder/JSON textarea 写入 object 属性，确认错误文案能回到页面局部错误区域。
- 正式 UI 后续应为固定 fields object 提供结构化子字段编辑，而不是要求用户手写整个 JSON object。
