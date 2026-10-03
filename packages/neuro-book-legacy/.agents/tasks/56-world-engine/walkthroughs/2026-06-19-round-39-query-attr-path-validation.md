# Round 39 - query attrs 路径校验

## 背景

Round 38 已经在写入侧拒绝包含空段的 attr path，避免 `profile..tags` 在 schema 校验和状态写入阶段产生不同含义。本轮继续审查查询投影，发现 `queryState({ attrs })` 仍然会接受同类畸形路径。

查询侧畸形路径通常只是返回空投影，但对 Agent / Preview 来说这很容易被误解成“该属性不存在”，而不是“输入路径写错了”。因此查询投影应该和写入 mutation 使用同一条路径规则。

## 本轮计划

1. 复用写入侧 attr path 校验。
2. `queryState.attrs` 包含空段时直接报错。
3. 增加回归测试。

## 实现

- 更新 `server/world-engine/world-engine.service.ts`：
  - `queryState()` 在读取 subject 和 reduce 前校验 `query.attrs`。
  - 复用 `assertAttrPath()`，保持写入路径与查询路径规则一致。
- 更新 `server/world-engine/world-engine.facade.test.ts`：
  - 新增测试：`queryState 拒绝带空段的 attrs 投影路径`。
  - 覆盖 `profile..tags` 不再被静默忽略。
- 更新文档：
  - `README.md` 记录第三十九轮进展。
  - `PROJECT-STATUS.md` 同步当前状态。

## 验证

- `bunx vitest run server/world-engine/world-engine.facade.test.ts`
  - 1 个测试文件通过。
  - 29 个测试用例通过。
- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts app/utils/world-engine-preview.test.ts`
  - 4 个测试文件通过。
  - 48 个测试用例通过。
- `bun run typecheck`
  - 通过。

## 与计划的出入

本轮按计划修复查询侧路径校验，没有改动 API 形态。`attr` 点分路径规则仍然保持宽松，只禁止空段。

没有自动浏览器验证；项目指令要求必须用户确认后才能打开浏览器。

## 后续

- 继续审查 queryState 对 `listLimit` 的内部调用边界，例如 facade 直接传 0 或负数时是否也应明确拒绝。
- 浏览器验证仍待用户确认后执行。
