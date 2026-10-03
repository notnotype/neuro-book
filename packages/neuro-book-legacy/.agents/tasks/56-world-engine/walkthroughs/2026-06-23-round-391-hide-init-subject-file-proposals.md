# Round 391 - Hide Init Subject File Proposals

## Context

Round 390 后继续从作者真实流程看，发现 `init` slice 会生成主体文件建议。以 `ming-ding-zhi-shi-2` 为例，初始化切面会把角色默认值如 `hp set 100`、`events set []` 转成 `events.jsonl` 经历草稿。

这会误导作者把“注册主体 / 初始化默认值”当成角色经历写进六文件。主体文件建议应服务推演事件、状态变化和后续人工审查，不应该把初始化默认值伪装成叙事经历。

## Scope

- `kind === "init"` 的 slice 不生成主体文件建议。
- 普通 `event` slice 在主体语境下继续显示 `files N`，并可进入 Inspector 查看 proposal。
- 不改数据库，不写 `simulation/subjects` 六文件。

## Implementation

- `app/utils/world-engine-workbench-real.ts`
  - `buildWorldWorkbenchSubjectFileProposals()` 在入口处直接过滤 `init` slice，返回空数组。
- `app/utils/world-engine-ide-entry.test.ts`
  - 新增 `initProposals` 断言：即使 init slice 包含 `player.hp set 100`、`player.events set []`，也不会生成主体文件建议。

## Verification

### Static Tests

```powershell
bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts
```

结果：2 个测试文件，9 条测试通过。

### Browser Acceptance

Project：`workspace/ming-ding-zhi-shi-2`

浏览器步骤：

1. 打开 `http://localhost:3001/?project=workspace%2Fming-ding-zhi-shi-2`。
2. 打开顶部 `World`。
3. 查看整体世界时间线。
4. 确认 init slice 不显示 `files N`。
5. 将 `薇洛丝` 设为主体文件建议语境，再切回整体世界时间线。
6. 确认三条 `[验收]` `world.events` event slice 仍显示 `files 1`。
7. 点击第一条 event slice 的 `files 1`，确认右侧 Inspector 展示 `Subject file proposals`。

实际结果：

- init slice 只显示 `27 mutations / 7 subjects`，没有 `files 6` 或其它主体文件建议入口。
- `薇洛丝` 语境 + 整体世界时间线下，三条 `[验收]` event slice 均显示 `files 1`。
- 点击第一条 event 的 `files 1` 后，Inspector 展示 `薇洛丝 / 当前主体语境下的 world 事件建议 / simulation/subjects/player`，包含 `events.jsonl draft` 与 `state.md review`。
- 本轮没有保存、删除或写入 Project SQLite，也没有修改 `simulation/subjects` 六文件。
- 临时 `bunx nuxt dev --port 3001` 已关闭，确认 `port 3001 free`。

## Actual vs Plan

- 计划：去掉 init slice 的主体文件建议噪音，同时保证 event slice 的 proposal 入口不受影响。
- 实际：静态测试和真实浏览器都确认 init 不再生成 `files`，event 在主体语境下仍可生成和打开 proposal。
- 与计划出入：无。

## Follow-up

- 继续观察作者打开目标六文件后的真实落地路径：是否需要“粘贴到末尾”“审查 state.md 区块”这类更明确但仍不自动写文件的下一步入口。
