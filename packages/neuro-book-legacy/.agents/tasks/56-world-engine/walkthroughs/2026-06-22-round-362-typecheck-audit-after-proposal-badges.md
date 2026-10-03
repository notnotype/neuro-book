# Round 362 - Typecheck Audit After Proposal Badges

## 背景

Round 357-361 连续补强了主体文件建议的可发现性：保存提示、Inspector 顶栏、隐藏 Inspector 入口、focused subject 对齐和 slice card `files N` 徽标。前面已通过两组 World Engine 前端契约测试，但这些测试主要是静态契约与 util 行为，不等价于全量 Vue / TS 类型检查。

## 本轮目标

- 运行一次全量 typecheck，确认新增 prop / computed / import 没有暴露 World Engine 类型错误。
- 如果失败，区分是否由本轮 World Engine 改动导致。

## 验证

```bash
bun run typecheck
```

结果：失败。

失败范围集中在已知无关文件：

- `server/agent/tools/control-tools.test.ts`
  - `UserInputFormSpec | Promise<UserInputFormSpec | null>` 上访问 `.form`。
  - `ImageContent | TextContent` 上访问 `.text`。
  - 若干 `Object is possibly 'undefined'`。

本次输出没有出现 `app/components/novel-ide/world-engine/**`、`app/pages/world-engine.workbench-preview.vue`、`app/utils/world-engine-*.test.ts` 或 `docs/tasks/56-world-engine` 相关类型错误。

## 结论

- 全量 typecheck 仍被无关 Agent control tools 测试类型漂移阻塞。
- 目前没有证据显示 Round 357-361 的 World Engine proposal 可发现性改动引入类型错误。
- 本轮没有修改业务代码。

## 与计划出入

- 按用户约束，没有顺手修无关 `control-tools.test.ts`。
- 浏览器验收仍未执行，需要用户明确允许后再跑真实 Workbench 作者流。
