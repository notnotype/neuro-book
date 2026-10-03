# Round 104: 开放 object itemType object 路径解析修复

## 背景

第 103 轮补齐了后端 `itemType: object` 契约，主要覆盖 `list/collection itemType=object`。继续代码审查时发现还有一个边界需要验证：`kind: object, itemType: object` 的开放 object 子路径，例如 `memories.second`，是否也能按 object 子值写入。

补测试后暴露真实问题：`findAttrSchema()` 在解析开放 object 子路径时，会把根 object 的 `itemType` 临时转换成 `{ kind: "scalar", type: current.itemType }`。当 `itemType` 是 `object` 时，这会变成非法的 `scalar type=object`，触发 schema loader 报错：

```text
属性 type 不合法：attr=object
```

## 变更

- 更新 `server/world-engine/schema-loader.ts`：
  - `findAttrSchema()` 遇到开放 object 的 `itemType: object` 时，临时 schema 改为 `{ kind: "object" }`。
  - 其他 `itemType` 仍按原逻辑映射为 scalar type。
- 更新 `server/world-engine/world-engine.facade.test.ts`：
  - 补 `scalar type: object` 仍被 schema loader 拒绝的断言。
  - 补 `开放 object 支持 itemType object 并校验每个子值`：
    - `memories` 声明为 `{ kind: object, itemType: object }`。
    - 创建 subject 时 default 写入 `{ first: { text: 初见王都 } }`。
    - 写入 `memories.second = { text: "拿到旧剑" }` 成功。
    - 写入 `memories.third = "不是对象"` 被拒绝。
    - 查询状态确认 first / second 都保留为 object。

## 验证

```powershell
bunx vitest run server/world-engine/world-engine.facade.test.ts
```

结果：1 个测试文件、36 个测试通过。

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts
```

结果：2 个测试文件、18 个测试通过。

```powershell
bun run typecheck
```

结果：通过。

## 审查结论

- 第 103 轮的 `itemType: object` 后端契约现在覆盖了 list、collection 和开放 object 子路径三类入口。
- `scalar type: object` 仍然被拒绝，领域表达保持为 `kind: object` 或 `itemType: object`。
- 没有自动做浏览器验证；根据项目规则，真实浏览器验收仍需要用户确认后执行。

## 后续

- 下一轮建议进入浏览器用户流验收：用新 Project 跑 object item 的创建、写入、删除、查询和 re-settle，重点观察 Builder 是否足够顺手。
