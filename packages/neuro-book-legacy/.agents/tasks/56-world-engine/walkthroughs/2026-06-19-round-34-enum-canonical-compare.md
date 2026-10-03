# Round 34 - enum canonical JSON 校验

## 背景

Round 33 把 `editSlice` mutation value 比较改成 canonical JSON，解决了 object key 顺序变化误触发 re-settle 的问题。继续审查同类比较逻辑时发现：enum 校验仍使用普通 `JSON.stringify()`。

schema loader 已允许 `enum` 候选是任意 JSON 值。如果 enum 候选是对象，普通 `JSON.stringify()` 会把 key 顺序当成差异，导致语义相同的对象值被误拒绝。

## 本轮计划

1. 保持 `enum` 允许任意 JSON 值的既有设计。
2. enum 校验改用 canonical JSON。
3. 增加对象 enum key 顺序回归测试。

## 实现

- 更新 `server/world-engine/world-engine.service.ts`：
  - `validateTypedValue()` 校验 `type: enum` 时使用 `stableJson()` 比较候选值和值。
  - object key 排序后比较，array 顺序仍保持原语义。
- 更新 `server/world-engine/world-engine.facade.test.ts`：
  - 新增测试：`enum 对象值校验忽略 key 顺序`。
  - 覆盖 default 校验和普通 mutation 校验两条路径。
- 更新文档：
  - `README.md` 记录第三十四轮进展。
  - `schema-design.md` 补充 enum JSON 值的 canonical 比较规则。
  - `PROJECT-STATUS.md` 同步当前 World Engine 状态。

## 验证

- `bunx vitest run server/world-engine/world-engine.facade.test.ts`
  - 1 个测试文件通过。
  - 25 个测试用例通过。
- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts app/utils/world-engine-preview.test.ts`
  - 4 个测试文件通过。
  - 43 个测试用例通过。
- `bun run typecheck`
  - 通过。

## 与计划的出入

本轮属于代码审查中发现的同类边界修复，实际范围比 Round 33 更小，没有改动 API 形态、schema 字段格式或 Preview 交互。

没有自动浏览器验证；项目指令要求必须用户确认后才能打开浏览器。

## 后续

- 继续审查 schema 校验与运行时 reduce 的一致性，尤其是“schema 允许 JSON 值”的地方是否还存在普通字符串化比较。
- 浏览器验证仍待用户确认后执行。
