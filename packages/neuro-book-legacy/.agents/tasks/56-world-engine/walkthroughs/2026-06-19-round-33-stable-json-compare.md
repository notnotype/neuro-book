# Round 33 - stable JSON 语义比较

## 背景

上一轮修复了 `editSlice` 纯元数据编辑误报 re-settle，但继续审查 mutation 语义比较时发现一个边界：object value 如果只是 JSON key 顺序不同，普通 `JSON.stringify()` 会把它判断为不同值。

这会让作者或 Preview 载入旧 slice 后重新保存时，因为对象序列化顺序变化而误报需要 re-settle。实际世界状态没有变化，只有 JSON 表达顺序变了。

## 本轮计划

1. 保留 `editSlice` 的“语义变化才触发 re-settle”原则。
2. 把 mutation value 比较改成 canonical JSON。
3. 增加回归测试覆盖 object key 顺序变化。

## 实现

- 更新 `server/world-engine/world-engine.service.ts`：
  - `stableJson()` 改为 canonical JSON 序列化。
  - object key 排序后再序列化，array 保持原顺序。
  - `sameMutationInputs()` 比较 `editSlice` mutation 语义时复用该序列化结果。
  - collection value 去重 / 删除比较也复用同一语义比较，避免对象元素被 key 顺序影响。
- 更新 `server/world-engine/world-engine.facade.test.ts`：
  - 新增测试：`editSlice 比较 object value 时忽略 key 顺序`。
  - 场景覆盖：同一 object value 只调整 key 顺序，且后续存在同 subject mutation，保存后仍返回 `needsResettle: false`。
- 更新文档：
  - `README.md` 已记录第三十三轮进展。
  - `sqlite-and-api.md` 已补充 re-settle 判断里的 canonical JSON 规则。
  - `PROJECT-STATUS.md` 同步记录当前 World Engine 状态。

## 验证

- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts app/utils/world-engine-preview.test.ts`
  - 4 个测试文件通过。
  - 42 个测试用例通过。
- `bun run typecheck`
  - 通过。

## 与计划的出入

本轮按计划修复 `editSlice` object value key 顺序误判，没有改变 `editSlice` 第一版整块替换语义，也没有自动接入 re-settle。

没有自动浏览器验证；项目指令要求必须用户确认后才能打开浏览器。

## 后续

- 浏览器验证时重点确认：载入包含 object mutation 的旧 slice，只改变 JSON key 顺序后保存，不应出现 re-settle 提示。
- 如果后续引入 slice 局部 patch API，也应沿用 canonical JSON 判断对象值语义是否变化。
