# Round 197: HTTP path segment 非法编码稳定错误

## 背景

继续审查 World Engine 后端 / API 公开边界时发现，`/api/projects/world-engine/[...segments]` 的 `readSegments()` 直接对 catch-all path segment 调用 `decodeURIComponent()`。如果请求路径里出现坏的 percent encoding，例如 `%E0%A4%A`，会抛出原生 `URIError`。

公开 API 应该返回稳定的业务错误，而不是把原生解码异常冒出去。

## 本轮变更

- `server/api/projects/world-engine/[...segments].ts`
  - 新增 `decodeSegment()`。
  - `readSegments()` 改为逐段安全解码。
  - 非法 URL percent encoding 返回 `400: API path 编码不合法：<segment>`。

- `server/api/projects/world-engine/[...segments].test.ts`
  - 新增 malformed path 回归测试：`slices/%E0%A4%A` 返回稳定 400。

- 文档同步：
  - `docs/tasks/56-world-engine/sqlite-and-api.md`
  - `docs/tasks/56-world-engine/README.md`
  - `PROJECT-STATUS.md`

## 验证

- `bun run test 'server/api/projects/world-engine/[...segments].test.ts'`
  - 1 file passed，38 tests passed。
- `bun run test server/world-engine/world-engine.facade.test.ts 'server/api/projects/world-engine/[...segments].test.ts' server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files passed，136 tests passed。
- `bun run typecheck`
  - passed。

## 与计划出入

- 按用户当前要求，本轮继续只做后端/API 边界，没有进入前端。
- 这轮只收口 World Engine API；同仓库内其它 catch-all API 若也要统一处理，可后续单独做公共 helper。
