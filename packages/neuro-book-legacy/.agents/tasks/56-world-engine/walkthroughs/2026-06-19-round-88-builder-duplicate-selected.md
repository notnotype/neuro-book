# Round 88: Builder 复制所选 mutation

## 背景

第八十七轮给 Workbench Mutation Builder 增加了“插入其后”，解决了新 mutation 只能追加到末尾再反复移动的问题。继续审查多 mutation slice 编辑链路时，另一个常见操作是基于已有 mutation 复制一条相似项，然后只改 subject、attr 或 value。

此前用户需要先“载入”所选 mutation，再“插入其后”，步骤仍偏长。本轮补一个“复制所选”，让相似 mutation 的批量编辑更顺。

## 变更

- 更新 `world-engine-preview.ts`：
  - 新增 `duplicateMutationAt()` 纯函数。
  - 复制后的 mutation 插在原项后方，并选中新副本。
  - 对 JSON value 做结构复制，避免对象 / 数组 value 共享引用。
- 更新 `WorldEngineMutationActionButtons.vue`：
  - 增加“复制所选”按钮。
  - 没有可选 mutation 时禁用。
- 更新 `WorldEngineMutationBuilder.vue`：
  - 透传 `duplicate-selected-mutation` 事件。
- 更新 `WorldEngineMutationEditor.vue`：
  - 新增 `duplicateSelectedBuilderMutation()`。
  - 复制成功后自动选中副本并静默回填 Builder，方便立即微调。
- 更新测试：
  - `world-engine-preview.test.ts` 覆盖复制顺序、选中索引、非法索引错误和 JSON value 深拷贝。
  - `world-engine-ide-entry.test.ts` 增加按钮、事件和编辑器处理函数契约断言。

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

- 本轮仍是 Workbench 前端编辑体验增强，不改变 HTTP API、Project SQLite schema、Agent 工具或 reduce / re-settle 语义。
- “复制所选”复用已有 mutations JSON 校验链路，空数组 / 非法 JSON 仍会被拦截。
- 复制 `unset` mutation 时不会额外写入 `value: undefined`，继续符合 mutation JSON 契约。
- 没有自动做浏览器验证；主 IDE Workbench 的真实浏览器验收仍需要用户确认后执行。

## 后续

- Workbench 的多 mutation 编辑基础动作已经比较完整：选择载入、追加、插入其后、复制所选、替换所选、删除所选、替换全部、上移 / 下移。
- 下一阶段更值得转向真实浏览器验收，或者做 collection / list 的专用输入体验。
