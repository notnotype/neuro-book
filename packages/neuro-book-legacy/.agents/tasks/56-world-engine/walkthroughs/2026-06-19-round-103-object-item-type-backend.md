# Round 103: object itemType 后端契约补齐

## 背景

第八十九轮以后，Workbench / Preview 的 Mutation Builder 已经把 `list/collection itemType=object` 当作合法前端契约：默认值会生成 `{}`，value 输入会显示 JSON object textarea，并在提交前拒绝数组、字符串等非 object 值。

第 102 轮补后端 collection 测试时发现后端 schema loader 仍拒绝 `itemType: object`，报错为 `属性 itemType 不合法：tokens=object`。这会导致前端可生成的 schema / mutation 在后端无法落库，属于前后端契约漂移。

## 变更

- 更新 `server/world-engine/schema-loader.ts`：
  - `itemType` 的合法值允许 `object`。
  - `type` 仍不允许 `object`，避免把 `{ kind: scalar, type: object }` 也悄悄放开；对象属性仍应使用 `{ kind: object }`。
- 更新 `server/world-engine/world-engine.service.ts`：
  - `validateTypedValue()` 增加 `object` 类型校验。
  - `itemType: object` 对应的 list / collection item 必须是非数组 JSON object。
- 更新 `server/world-engine/world-engine.facade.test.ts`：
  - 新增 `list/collection 支持 object itemType 并按稳定 JSON 处理 collection`。
  - 覆盖 schema 投影包含 `itemType: object`。
  - 覆盖 `collectionAdd` 对 object item 按 stable JSON 去重。
  - 覆盖 `collectionRemove` 对 object item 按 stable JSON 删除。
  - 覆盖 `listAppend` 接受 object item。
  - 覆盖非 object item 被拒绝。

## 验证

```powershell
bunx vitest run server/world-engine/world-engine.facade.test.ts
```

结果：1 个测试文件、35 个测试通过。

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts
```

结果：2 个测试文件、18 个测试通过。

```powershell
bun run typecheck
```

结果：通过。

## 审查结论

- 前端已支持的 `list/collection itemType=object` 现在有后端 schema 与 service 层契约支撑。
- `scalar type: object` 没有被放开，避免和 `kind: object` 的领域表达冲突。
- collection object item 的 add/remove 复用既有 stable JSON 比较，对象 key 顺序不会影响去重或删除。
- 没有自动做浏览器验证；真实用户流验收仍需用户确认后执行。

## 后续

- 下一步可以继续从真实用户流出发做浏览器验收：新建 Project、创建示例世界、写入 object collection/list mutation、查询 state、执行删除与 re-settle。
- 若 UI 后续需要更舒适地编辑 object collection 项，可以在现有 JSON textarea 基础上再设计对象项模板或结构化表单。
