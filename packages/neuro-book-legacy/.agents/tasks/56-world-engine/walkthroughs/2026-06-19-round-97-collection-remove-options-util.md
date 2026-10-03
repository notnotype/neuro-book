# Round 97: collectionRemove 候选项 util 与行为测试

## 背景

第九十五、九十六轮让 `collectionRemove` 可以从当前 State Query 结果生成已有项下拉，并自动同步默认候选值。但当时主要依靠 `world-engine-ide-entry.test.ts` 的字符串契约保护组件结构，缺少对候选项推导本身的行为测试。

为了避免后续改动让完整 attr key、点分嵌套路径或对象项格式化漂移，本轮把纯逻辑抽到 util，并补上普通单测。

## 变更

- 更新 `world-engine-preview.ts`：
  - 新增 `WorldPreviewStateSubject` 与 `WorldPreviewValueOption` 类型。
  - 新增 `collectionRemoveValueOptions(states, subjectId, attrPath)`。
  - 候选项推导优先匹配完整 attr key，失败后再按点分路径读取嵌套值。
  - 字符串值保持原样，非字符串 JSON 值用 `JSON.stringify()` 生成 option value。
- 更新 `WorldEngineMutationBuilder.vue`：
  - 删除本地 `stateValueAtPath()` / JSON 格式化 helper。
  - 改为直接使用 `collectionRemoveValueOptions()`。
  - 文件体量从 193 行降到 158 行。
- 更新测试：
  - `world-engine-preview.test.ts` 增加行为测试，覆盖完整 key、点分嵌套路径、对象 collection 项和非数组回退。
  - `world-engine-ide-entry.test.ts` 改为断言 Builder 消费 `collectionRemoveValueOptions()`。

## 验证

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts
```

结果：2 个测试文件、18 个测试通过。

```powershell
bun run typecheck
```

结果：通过。

## 审查结论

- 本轮不改变用户可见能力，只把 `collectionRemove` 状态候选推导从 Vue 组件中提炼为可测试纯函数。
- 候选项推导现在有行为测试覆盖，不再只依赖组件字符串契约。
- 没有自动做浏览器验证；真实浏览器验收仍需要用户确认后执行。

## 后续

- 后续浏览器验收时继续重点检查 collection 删除链路。
- `WorldEngineMutationEditor.vue` 和 `world-engine.preview.vue` 都是 799 行，后续再加功能前应优先拆分。
