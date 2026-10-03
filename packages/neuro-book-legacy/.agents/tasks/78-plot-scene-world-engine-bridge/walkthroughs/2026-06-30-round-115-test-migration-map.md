# Round 115: Test Migration Map

## Scope

本轮把 Slice 1 的测试迁移压成文件级地图。目标是实现 Profile Contract Cleanup 时知道哪些测试要新增、哪些断言要保留、哪些旧断言要替换。没有改业务代码、没有运行测试。

## Test Files

### `server/agent/profiles/simulation-director-profiles.test.ts`

当前覆盖：

- `simulator.leader` rootToolKeys 和 prompt。
- `director` rootToolKeys 含 `get_scene_world_context`。
- director 不含 `write/edit`。
- director prompt 含 Thread / Scene、Plot reference、defaultChapterPath。

Slice 1 应新增或替换：

- `DirectorOutputSchema` 是 strict 新合同。
- director prompt 不含 `Simulation gate`。
- director prompt 不含 `simulator_requests`。
- director prompt 含 `world_engine_requests`。
- director prompt 表达“不写 World Engine，返回 world_engine_requests 给 leader/default 或 world.engine 处理”。
- `plot_updates.kind` 只允许 `thread | scene`。

保持：

- director 不含 file write/edit tools。
- director 不含 World Engine write tools。
- director 继续含 Plot Thread / Scene tools。

### `server/agent/profiles/leader-assets-profile.test.ts`

当前覆盖：

- leader.default 从 assets 加载并使用 v3 工具名。
- leader.default prompt 包含 writer/retrieval/researcher 协议。
- writer 输入合同和 payload。
- writer legacy `threadIds/sceneIds/plotIds` 不进入 rendered context。

Slice 1 应新增或替换：

- leader.default visible/history prompt 含 `director`。
- leader.default reference 不再含“不路由到 Plot / director”。
- leader.default 描述 Scene / Chapter / writer brief 工作路由 director。
- writer prompt 含“可消费上游 Scene / World Context brief”。
- writer prompt 或 rendered context 不含“普通写作完全不使用 Plot”这种绝对语义。

保持：

- writer rootToolKeys 不含 Plot tools。
- writer legacy Plot ids 不渲染。
- writer target path 仍是唯一写入目标。

### New Schema Test

可以放在 `simulation-director-profiles.test.ts` 或拆为独立 `director-output-schema.test.ts`。建议集中在现有 profile 测试里，避免新增浅测试文件，除非文件变得过长。

必须覆盖：

```ts
Value.Check(DirectorOutputSchema, validNewOutput) === true
Value.Check(DirectorOutputSchema, {...validNewOutput, simulator_requests: []}) === false
Value.Check(DirectorOutputSchema, outputWithPlotKind) === false
Value.Check(DirectorOutputSchema, {...validNewOutput, extra: true}) === false
Value.Check(DirectorOutputSchema, outputWithPlotUpdateExtra) === false
```

不要测试：

- `report_result.data` 必填。当前 runtime 不能机械保证它存在。
- legacy alias。旧字段不做兼容。

### Future Slice Tests

不应混进 Slice 1：

- OpenAPI `RouteMetaEntry.path` 测试属于 Slice 2。
- `ChapterWriterBriefService` fixture 属于 Slice 3。
- `get_chapter_writer_brief` runtime registry / typed binding / compiled artifact 属于 Slice 4。

Slice 1 可以为未来 brief 留 prompt 语言，但不应断言 brief tool 已存在。

## Deletion / Replacement Rules

删除或替换这些旧断言：

- director output 包含 `simulator_requests`。
- director workflow 包含 `Simulation gate`。
- leader.default 普通写作不路由 director/Plot。
- writer “完全不使用 Plot 系统”。

保留但改写这些意图：

- writer 不直接用 Plot tools。
- Plot 不作为动态世界状态真相源。
- leader.default 不直接持有 full Plot write tools。
- director 不写 World Engine。

## Conclusion

Slice 1 的测试重点是 profile contract，而不是 brief service。测试迁移应证明旧 simulator/Plot 语义被机械拒绝，同时保留 writer isolation 和 World Engine 真相源约束。

