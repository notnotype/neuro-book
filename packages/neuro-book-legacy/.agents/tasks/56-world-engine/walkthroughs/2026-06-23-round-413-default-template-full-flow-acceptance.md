# Round 413 - 默认模板完整作者流浏览器验收

## 背景

Round 412 已确认默认 Project 模板同步内置 `player` 时，会把六文件主体系统映射写入 World Engine state。本轮继续向真实作者流推进：不手写 schema，用默认模板新建 Project，打开主 IDE Workbench，完成同步主体、创建 `world`、连续推演、主体文件建议、编辑、删除和 state query 对账。

## 执行

- 启动本地 dev server：`http://localhost:3001`。
- 创建临时 Project：`workspace/world-engine-round-413-full-flow-1782188066922`。
- 打开主 IDE Workbench。
- 点击 `同步主体系统`。
  - 左栏出现 `玩家角色 character player 主体系统`。
  - 显示 `2 events / 2 memory`。
  - `player` 自动成为主体文件建议语境。
- 点击 `创建 world subject`。
  - 左栏出现 `世界 world world`。
  - `player` 仍显示 `语境中`。
  - 由于 `world` 与 `player` 都使用默认 `复兴纪元1年 1月1日 00:00:00`，timeline 只有一个 init slice，该 slice 显示 `20 mutations / 2 subjects`。
- 写入第一条 slice：
  - 时间：`复兴纪元1年 1月1日 00:00:01`
  - mutation：`world.events listAppend`
  - 结果：timeline 变为 2 条；该 slice 显示 `files 1`；Inspector 展示 `player` 的 `当前主体语境下的 world 事件建议`。
- 写入第二条 slice：
  - 使用 `写入并继续下一步`。
  - 时间自动推进到 `复兴纪元1年 1月1日 00:00:02`。
  - mutation：`player.events listAppend`
  - 结果：Composer 保持打开，显示上一条已写入回执，并准备 `00:00:03` 草稿；Inspector 展示 `player` 的 direct subject proposal。
- 写入第三条临时 slice：
  - 时间：`复兴纪元1年 1月1日 00:00:03`
  - mutation：`world.events listAppend`
  - 目的：删除入口验收。
- 删除第三条临时 slice：
  - 应用内确认框出现，点击 `确定`。
  - 结果：timeline 从 4 条回到 3 条，`event 2 / clean 3`，被删标题不再出现。
- 编辑第二条 slice：
  - 打开 `编辑 Slice`。
  - Composer 正确载入第二条 metadata 和 mutation JSON。
  - 修改 title / summary 后保存。
  - 结果：旧标题消失，新标题和新 summary 回流；proposal 也使用新标题重新生成。

## API 对账

最终 State Query：

```json
{
    "subjects": [
        {
            "subjectId": "player",
            "type": "character",
            "attrs": {
                "events": [
                    "我把远处的机关声记为可疑线索。"
                ],
                "sourcePath": "simulation/subjects/player",
                "subjectFiles": {
                    "subject": "simulation/subjects/player/subject.md",
                    "soul": "simulation/subjects/player/soul.md",
                    "mind": "simulation/subjects/player/mind.md",
                    "state": "simulation/subjects/player/state.md",
                    "events": "simulation/subjects/player/events.jsonl",
                    "memory": "simulation/subjects/player/memory.jsonl"
                },
                "ragIndexSources": {
                    "events": "simulation/subjects/player/events.jsonl",
                    "memory": "simulation/subjects/player/memory.jsonl"
                },
                "eventCount": 2,
                "memoryCount": 2
            }
        },
        {
            "subjectId": "world",
            "type": "world",
            "attrs": {
                "events": [
                    "玩家角色踏入旧大厅，听见远处传来机关声。"
                ]
            }
        }
    ],
    "issues": []
}
```

最终 slices：

- `复兴纪元1年 1月1日 00:00:00`：`init`，`创建 玩家角色`，实际包含 `player` 和 `world` 两个 subjects。
- `复兴纪元1年 1月1日 00:00:01`：`event`，`Round413 第一步：玩家踏入大厅`。
- `复兴纪元1年 1月1日 00:00:02`：`event`，`Round413 第二步：玩家确认机关声`。

## 结果

通过。默认模板新 Project 已能从真实 UI 跑通：同步 `player`、创建 `world`、连续推演两步、看到主体文件建议、删除临时 slice、编辑已有 slice、用 State Query 对账，且最终 `issues=[]`。

## 观察

- 页面首次用 `?project=workspace%2F...` 打开时一度显示 `未选择小说`，但打开顶部 Project 选择器后当前 Project 已切到正确临时 Project。该现象不阻塞本轮验收，后续若复现频繁，应单独查主页面 route 初始化与 project list 加载顺序。
- 默认模板现在声明了 `character.events`，所以新建 Slice 在 `player` 语境下默认是 `player.events`；若作者要写全局事件，需要点 schema shortcut 的 `world.events`。这覆盖了直接角色事件路径，但也意味着“全局事件默认入口”不再自动出现。
- 删除当前 world event 后，主体文件建议语境短暂回到整体世界；重新选中 `player` 相关 slice 后 `player` 又回到 `语境中`。这不是数据错误，但可以继续观察作者是否会把删除后的语境变化理解成丢上下文。

## 清理

- 临时 Project 已在验收后删除。
- dev server 已关闭。
- `port 3001` 已确认空闲。
- 清理时 `DELETE /api/projects/item` 仍超时且目录未删除；随后停止 dev server，并用 `deleteProjectWorkspace()` 删除明确的临时 Project，最终目录不存在。
