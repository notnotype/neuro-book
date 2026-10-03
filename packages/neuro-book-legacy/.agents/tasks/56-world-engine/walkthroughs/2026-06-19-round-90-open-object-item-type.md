# Round 90: 开放 object 行 value 继承 itemType

## 背景

第八十九轮补齐了 `list/collection itemType=object` 的顶层 JSON object 输入。继续审查同一条 value mode 链路时发现，开放 object 的行编辑器还有一个类似缺口：

当 schema 声明 `object` 只有 `itemType`、没有固定 `fields` 时，用户在 Object Value 中新增任意 key。此前这些开放 key 的 value 输入不会继承根 object 的 `itemType`，例如 `itemType=object` 仍是普通文本输入，容易把对象值写成字符串。

本轮把开放 object 行 value 也接入同一套 itemType 推导。

## 变更

- 更新 `WorldEngineMutationEditor.vue`：
  - `objectFieldAttr(rowKey)` 在没有固定 fields 时，会把根 object 的 `itemType` 投影成当前开放 key 的临时 schema attr。
  - `objectFieldValueMode(rowKey)` 因此可为开放 key 返回 number / boolean / ref / json / text 等模式。
  - 当用户给开放 object 行输入 key，且 value 仍为空时，会按 itemType 自动填默认值，例如：
    - `itemType=object` -> `{}`
    - `itemType=int` / `float` -> `0`
    - `itemType=bool` -> `false`
    - `itemType=ref(item)` -> 可用 subject 引用或 `subject://`
- 更新 `world-engine-ide-entry.test.ts`：
  - 增加 `attr.itemType` 和开放 key 默认值链路的契约断言。

## 验证

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts
```

结果：2 个测试文件、17 个测试通过。

```powershell
bun run typecheck
```

结果：通过。

## 审查结论

- 本轮只改变 Workbench 前端 Builder 的输入控件推导和默认值填充，不改变后端 API、Project SQLite schema、Agent 工具或 reduce / re-settle 语义。
- 开放 object 与固定 object fields 的 value mode 更一致：同样能按 schema 投影显示 ref / number / boolean / JSON object 等控件。
- 没有自动做浏览器验证；主 IDE Workbench 的真实浏览器验收仍需要用户确认后执行。

## 后续

- Builder 的 object/list/collection 输入已经覆盖主要 schema 投影路径。
- 下一阶段更值得转向真实浏览器验收，或者继续做 collectionRemove 的现有值辅助选择。
