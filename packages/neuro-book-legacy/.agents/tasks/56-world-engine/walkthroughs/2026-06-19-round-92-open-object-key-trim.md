# Round 92: 开放 object key trim 语义一致化

## 背景

第九十轮和第九十一轮让开放 object 行编辑器继承根 object 的 `itemType`，并避免空 key 行提前切换控件。继续静态审查时发现一个细节：

最终写入 object value 时，key 会 `trim()`；但 value 控件推导时使用的是原始 `row.key`。如果用户输入 `"  foo  "`，界面可能按原始 key 推导，最终却写入 `foo`，两者存在细微漂移。

## 变更

- 更新 `WorldEngineMutationEditor.vue`：
  - `objectFieldAttr(rowKey)` 内部统一先计算 `const key = rowKey.trim()`。
  - 空 key 判断、固定 field 匹配、开放 object 临时 attr name 都使用裁剪后的 key。
- 更新 `world-engine-ide-entry.test.ts`：
  - 增加 key trim 语义的契约断言。

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

- 本轮只修正 Workbench Builder 的前端控件推导一致性，不改变 HTTP API、Project SQLite schema、Agent 工具或 reduce / re-settle 语义。
- 开放 object key 前后空格不会再造成“控件按原始 key 显示、写入按 trim key 保存”的漂移。
- 没有自动做浏览器验证；主 IDE Workbench 的真实浏览器验收仍需要用户确认后执行。

## 后续

- Workbench Builder 的 object 输入细节已经基本稳定。
- 下一阶段更值得转向真实浏览器验收，或者继续补 collectionRemove 的现有值辅助选择。
