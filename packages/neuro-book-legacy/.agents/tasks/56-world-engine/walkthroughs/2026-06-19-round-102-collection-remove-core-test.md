# Round 102: collectionRemove 后端核心测试

## 背景

前几轮持续打磨了 `collectionRemove` 的前端输入链路：Workbench 和 Preview 都能从当前 State Query 结果生成已有项下拉，并自动同步候选值。继续审查后端覆盖时发现，核心测试里已有 `collectionAdd` 示例，但没有明确覆盖 `collectionRemove` reduce 语义。

本轮补一个 facade 级回归测试，保证前端辅助背后的核心行为有后端证据。

## 变更

- 更新 `server/world-engine/world-engine.facade.test.ts`：
  - 新增 `collectionAdd 会去重且 collectionRemove 会删除已有 ref 项`。
  - 使用测试 schema 声明 `character.inventory: collection ref(item)`。
  - 写入重复 `collectionAdd subject://old-sword`、添加 `subject://key`、再 `collectionRemove subject://old-sword`。
  - 查询 reduce 后状态，断言 `inventory` 只剩 `subject://key`。

## 绕道记录

初始测试尝试同时覆盖 `collection itemType: object` 的稳定 JSON 去重/删除，但当前 `schema-loader` 会拒绝 `itemType: object`，报错为 `属性 itemType 不合法：tokens=object`。

因此本轮没有擅自扩展 schema 合法类型，而是收敛到当前后端明确支持的 `collection ref(item)` 契约。对象 collection 是否放开需要另行设计/决策。

## 验证

```powershell
bunx vitest run server/world-engine/world-engine.facade.test.ts
```

结果：1 个测试文件、34 个测试通过。

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts
```

结果：2 个测试文件、18 个测试通过。

```powershell
bun run typecheck
```

结果：通过。

## 审查结论

- 本轮不改变 runtime 行为，只补后端核心回归测试。
- `collectionRemove` 的 ref collection 语义现在有 facade 级测试覆盖。
- 没有自动做浏览器验证；真实浏览器验收仍需要用户确认后执行。

## 后续

- 若后续要支持 `collection itemType=object`，需要先扩展 schema-loader 的合法类型集合与校验规则，再补对象 collection 的稳定 JSON add/remove 测试。
