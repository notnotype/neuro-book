# Round 190：schema desc 必须是字符串

## 背景

本轮继续按用户最新范围只做后端/API，不进入前端。

巡检 schema loader 时发现一个显式配置错误会被吞掉：

- subject type 的 `desc: 123` 会被静默当作没有 desc。
- attr 的 `desc: 123` 会因为 `...attr` 保留到归一化结果里，可能被 `getWorldSchema()` 投影给 API / Agent。

这和最近几轮“显式配置错误必须稳定暴露”的方向不一致。

## 实现

- `server/world-engine/schema-loader.ts`
  - 新增 `readDesc()`。
  - subject type 的显式 `desc` 必须是字符串。
  - attr 的显式 `desc` 必须是字符串。
  - 未写 `desc` 时仍为 `undefined`。

- `server/world-engine/world-engine.facade.test.ts`
  - 覆盖 subject type 非字符串 desc。
  - 覆盖 attr 非字符串 desc。

- `server/api/projects/world-engine/[...segments].test.ts`
  - 覆盖 HTTP `GET /schema` 对非字符串 attr desc 返回稳定 400。

## 文档同步

- `docs/tasks/56-world-engine/schema-design.md`
  - 记录 subject type / attr 的显式 `desc` 必须是字符串。

- `docs/tasks/56-world-engine/sqlite-and-api.md`
  - 在 API 契约里补充 schema desc 类型规则。

- `docs/tasks/56-world-engine/README.md`
  - 增加 round-190 状态与 walkthrough 链接。

- `PROJECT-STATUS.md`
  - 增加 round-190 仓库级状态说明。

## 验证

- `bun run test server/world-engine/world-engine.facade.test.ts 'server/api/projects/world-engine/[...segments].test.ts' server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files passed
  - 129 tests passed

- `bun run typecheck`
  - failed，阻塞点是前端 mock preview 既有类型问题：
    `app/components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewInspector.vue(76,15): 'renderNode' implicitly has return type 'any' because it is recursive`
  - 本轮按用户最新范围只做后端/API，未修前端。

## 与计划出入

原长期目标仍包含前端与最终浏览器验收；本轮按用户最新调整只推进后端/API 设计收口。typecheck 阻塞来自前端 mock preview，不是本轮后端/API 改动引入。

