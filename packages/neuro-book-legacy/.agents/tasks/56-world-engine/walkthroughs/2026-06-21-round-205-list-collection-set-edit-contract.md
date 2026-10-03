# Round 205: list/collection set 整组替换契约

## Summary

作者视角 P0 实跑后暴露一个后端/API 契约缝隙：`createSubject()` 会把 schema default 写成 init slice 里的 `set` mutation，包括 `events set []`、`inventory set []` 这类 `list` / `collection` 初值；但 `editSlice()` 整块保存时，service 校验只允许 `listAppend` 或 `collectionAdd` / `collectionRemove`，导致系统自己生成的 init slice 可能无法被 Workbench 原样载入后保存。

本轮把 `list` / `collection` 的 `set` 明确为合法的整组替换，不再把它当作 `createSubject` 的隐式特例。

## Changes

- `server/world-engine/world-engine.service.ts`
  - `list` 允许 `set` / `listAppend`。
  - `collection` 允许 `set` / `collectionAdd` / `collectionRemove`。
  - `list` / `collection` 使用 `set` 时，value 必须是 array。
  - 数组项继续按 `itemType` / `type` 校验；`ref(type)`、`itemType: object`、safe integer 等既有规则不放松。
- `server/api/projects/world-engine/[...segments].test.ts`
  - 新增一条 HTTP 回归：创建 `character` subject 后，读取系统生成的 init slice，再用同一组 mutations 原样调用 `POST /slices/:id/edit`，确认返回 `{sliceId, issues: []}`，并查询 list/collection 初值仍是空数组。
- 文档同步：
  - `schema-design.md`、`sqlite-and-api.md`、`worked-example.md` 改为当前契约：`list` / `collection` 的 `set` 是整组替换，value 必须是数组。

## Verification

- `bunx vitest run 'server/api/projects/world-engine/[...segments].test.ts'`
  - 1 file passed, 39 tests passed.
- `bun run typecheck`
  - passed.

## Plan Delta

- 用户要求不要过度测试，本轮只补最贴近作者路径的 HTTP 回归，没有额外扩 facade / Agent / 前端字符串测试。
- 未执行浏览器验证；项目规则要求浏览器验收需用户明确授权。
