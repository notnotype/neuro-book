# 2026-06-21 Edit Init Slice List Set Contract

## Summary

主 Workbench 的 Slice Composer 已能载入当前 slice 整块编辑，但真实作者路径会碰到一个后端缝隙：`createSubject` 生成的 init slice 里包含 `list` / `collection` 的 `set []`，此前 `editSlice` 会拒绝这类 mutation。

本轮后端/API 已补齐契约：`list` / `collection` 的 `set` 是合法整组替换。主 Workbench 打开 init slice 后可以原样保存，不需要前端绕过或迁移到下一秒切面。

## Changes

- 后端允许 `list` / `collection` 使用 `set` 做整组替换。
- HTTP API 回归覆盖 `createSubject -> GET /slices?withMutations=true -> POST /slices/:id/edit -> state/query`。
- 本任务 README 的 follow-up 已从“后续单独处理”改为“已处理”。

## Verification

- `bunx vitest run 'server/api/projects/world-engine/[...segments].test.ts'`
  - 39 passed.
- `bun run typecheck`
  - passed.

## Notes

- 未改前端 UI。
- 未自动做浏览器验证；后续如果要实跑主 Workbench，请先由用户明确授权。
