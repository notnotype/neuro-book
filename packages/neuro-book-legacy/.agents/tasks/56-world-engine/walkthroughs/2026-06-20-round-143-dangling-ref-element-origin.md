# Round 143 - Dangling Ref Element Origin

## Context

继续按用户最新边界推进：本轮不做前端，专注后端与 API 设计。

审查 `issues.sliceId` 定位时发现一个后端准确性问题：`dangling-ref` 对 `list` / `collection` ref 元素只按属性记录来源。多个 slice 依次修改同一属性时，缺失 ref 可能被归到最后一次属性变更，而不是写入该具体 ref 元素的 slice。

## Plan

1. 为 reduce 过程补元素级 origin 跟踪。
2. 用 facade 测试钉住 collection ref 的 dangling-ref slice 归属。
3. 重新运行目标测试，并记录 profile artifact / typecheck 现状。

## Implementation

- `reduceWithIssues()` 现在在 apply mutation 前后读取属性值，并调用 `recordOriginAfterMutation()` 记录来源。
- `listAppend` 会记录到 `${attr}[index]`。
- `collectionAdd` 只在真正新增元素时记录 `${attr}[index]`；重复 add 不覆盖原来源。
- `collectionRemove` 会按剩余元素的稳定 JSON 值重排来源，避免删除前面的元素后 index 来源错位。
- `findOriginSlice()` 先查精确路径，再回退到去掉 index 的父路径。
- 补 facade 回归测试：
  - `old-sword` 和 `key` 由两个不同 slice 加入 `inventory`；
  - 手工删除 `old-sword` subject 后，`dangling-ref inventory[0]` 必须归属到“拾起旧剑”的 slice；
  - 后续“拾起钥匙”的 slice 不应显示该 issue。
- 目标测试发现 `world.engine` profile artifact 因依赖指纹变化变 stale；按项目已有脚本重新编译 system profile artifacts。
- 因全量 system profile artifact 变 fresh 后 catalog 加载耗时变长，将 `world.engine` profile catalog 测试超时从 20s 调到 60s，断言不变。

## Review Notes

这次修复只改变 issue 定位，不改变 reduce 后的 state 值，也不改变正常写入 ref 时的校验逻辑。`dangling-ref` 仍主要覆盖旧数据、手工 DB 损坏或未来删除 subject 场景。

本轮与大目标计划的出入：

- 仍未做前端和浏览器验收，符合用户最新“本次不用做前端，专注后端与 API 设计”的调整。
- `bun run typecheck` 没有通过，但失败来自当前无关的 `server/low-code-form/*` 类型错误，不是本轮 World Engine 后端/API 改动。

## Verification

- `bunx vitest run server/world-engine/world-engine.facade.test.ts`
  - 1 file / 43 tests passed
- `bunx vitest run server/world-engine/world-engine.facade.test.ts "server/api/projects/world-engine/[...segments].test.ts" server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 61 tests passed
- `bun scripts/build/profile.ts status world.engine --system`
  - `world.engine: loaded`
- `bun run typecheck`
  - failed in unrelated `server/low-code-form/index.ts` and `server/low-code-form/resource-preset.ts`

