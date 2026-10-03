# Round 237: 待接入 subject 不进入全部 subject 过滤

继续检查 mixed pending / registered subject 选择。Round 236 让新建 Slice 在 mixed 视角下优先落到已注册 subject；但还有一个相邻假空列表：如果当前 subject 过滤里包含“待接入”主体，再切到“全部 subject”，这个过滤在 World Engine 时间线上不可满足。原因是待接入主体还没有 World Engine subject 身份，也不会出现在任何 slice mutation 里。

此前 UI 会允许这个组合，结果中间 Slice List 只显示“没有匹配当前条件的切片”，作者容易误以为角色真的没有历史，或者刚写入的切片丢了。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - 当选择 subject 时，如果包含待接入 subject 且当前是 `all` 模式，自动切回 `any`。
  - 当用户尝试把包含待接入 subject 的过滤切到 `all`，保持 `any` 并显示 notice：待接入 subject 还没有 World Engine 切片，暂不能使用“全部 subject”过滤。
  - 保留 pending-only 视角的原提示：仍要求先同步主体系统，或选择已注册 subject。
  - 不改变服务端 `GET /slices` 过滤，不自动同步 subject。
- `world-engine-ide-entry.test.ts`
  - 补静态契约断言，确认 pending subject 会阻止 `all` 过滤，并提示切回“任一 subject”。

## Validation

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

两项均通过。本轮未自动执行浏览器验证。

## Plan Diff

计划是继续修主 Workbench subject 过滤与新建 Slice 之间的真实使用卡点。实际改动只处理一个不可满足的前端过滤组合，没有改变 API 查询能力，也没有把待接入主体自动注册进 World Engine。
