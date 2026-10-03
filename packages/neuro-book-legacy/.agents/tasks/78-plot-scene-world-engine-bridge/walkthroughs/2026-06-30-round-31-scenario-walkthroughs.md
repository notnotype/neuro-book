# 2026-06-30 Round 31 - Scenario Walkthroughs

## Scope

本轮用典型使用场景检验 Director + Brief Compiler 是否覆盖真实写作链路。目标是找出 profile 调用协议的缺口，而不是新增 Module。

本轮不修改业务代码。

## Scenario 1: 用户要求规划并写一章

1. `leader.default` 询问/确认本章目标、时间线、canon 选择。
2. `leader.default` 用 `execute_world(readwrite)` 写入或修正已确认的 World Engine 事实。
3. `leader.default` 调 `director`，传 `projectPath/mode/defaultChapterPath` 和本轮任务 message。
4. `director` 创建/更新 Thread / Scene / Chapter Scene order / Scene World Anchor。
5. `director` 调 `get_chapter_writer_brief`。
6. `director` 返回 `writer_handoff` 和 `world_engine_requests/open_questions`。
7. `leader.default` 处理未决 World Engine 问题；必要时再次调 `director` 更新 Scene。
8. `leader.default` 编辑完整 writer brief 后调 `writer`，`input.path` 指向章节 `index.md`。
9. `writer` 写正文，用 readonly `execute_world` 自查。
10. `leader.default` 检查 writer summary，必要时回补 World Engine，再让 director 更新 Scene / Thread summary。

结论：该流程覆盖 Plot 结构、World Engine 真相源、正文写作和写后对账。

## Scenario 2: Scene 有 unresolved subject

1. `director` 创建 Scene，并可先保存占位 subject id。
2. `get_chapter_writer_brief` 返回 warnings。
3. 如果仍有足够上下文，status 可以是 `ready`；如果全部需要查询的 subject 都 unresolved，status 应为 `needs_world_context`。
4. `leader.default` 决定是补建 World Engine subject，还是让 director 重新选择已有 subject。

结论：unresolved subject 是一等 warning，不是静默失败，也不阻塞所有写作。

## Scenario 3: Scene 缺时间范围

1. `director` 可以先规划 Scene。
2. `get_chapter_writer_brief` 对关键 Scene 返回 `needs_world_anchor`。
3. `director` 若能从已确认 canon 推导时间，则更新 Scene World Anchor。
4. 若不能推导，返回 `open_questions` 给 leader/用户。

结论：Plot 允许先规划后连接 World Engine，但 writer handoff 前必须显式暴露缺口。

## Scenario 4: World Engine calendar 损坏

1. Plot 聚合读取可以在缺 `calendar.ts` 时降级。
2. 但 brief / Scene World Context 需要真实 World Context 时，坏 calendar 应进入 `needs_world_context` 或直接暴露配置错误。
3. `leader.default` 可转 `world.engine` 修复 schema/calendar。

结论：Plot 浏览容错和 writer handoff 准备不是同一要求；后者不能吞掉配置错误。

## Scenario 5: writer 写出新事实

1. `writer` 在 summary 中报告正文自然产生的新事实或状态变化。
2. `leader.default` 判断是否 canon。
3. canon 后用 `execute_world(readwrite)` 写入 World Engine。
4. 再调 `director` 更新 Scene summary / Thread summary / anchor。

结论：writer 不写 Plot，不写 World Engine；post-write reconciliation 由 leader 统筹。

## Scenario 6: leader 想快速查看 brief

第一阶段：

1. `leader.default` 调用已有 director 或新建 director。
2. `director` 调 `get_chapter_writer_brief` 并回报。

后置优化：

- 如果该往返在真实使用中频繁造成摩擦，再给 `leader.default` 加只读 `get_chapter_writer_brief`。

结论：Leader Readonly Brief 是观察项，不是第一阶段必需能力。

## Result

场景推演没有推翻 Director-only brief。最关键的缺口仍是实现 `get_chapter_writer_brief` 的 status/warnings/markdown，让 director 不再手动串 Plot 和 World Context。

