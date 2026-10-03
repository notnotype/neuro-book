# Round 412 - 默认模板主体系统 schema 浏览器验收

## 背景

Round 411 已把 Bundled Workspace Template 的 `world-engine/schema.yaml` 补齐 `character` 的主体系统映射字段。本轮不继续改代码，目标是用真实 dev server 和主 IDE Workbench 验证：新建 Project 不手写 schema 时，同步模板内置 `player` 后，World Engine state 会保留 `simulation/subjects` 六文件路径、RAG source 和计数。

## 执行

- 启动本地 dev server：`http://127.0.0.1:3001`。
- 创建临时 Project：`workspace/world-engine-round-412-default-template-1782187458736`。
- API 预检确认默认模板 schema 已包含：
  - `sourcePath`
  - `subjectFiles`
  - `ragIndexSources`
  - `subjectSystemVersion`
- 打开主 IDE：`/?project=workspace%2Fworld-engine-round-412-default-template-1782187458736`。
- 打开 `World Engine` Workbench。
- 点击 `同步主体系统`。
- UI 结果：
  - 左栏出现 `玩家角色 character player 主体系统`。
  - 卡片显示 `2 events / 2 memory`。
  - Timeline 出现 1 条 `init` slice，状态为 `clean 1`。
- State Query 结果：

```json
{
    "subjects": [
        {
            "subjectId": "player",
            "type": "character",
            "attrs": {
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
                "memoryCount": 2,
                "subjectSystemVersion": "simulation-subjects-overview"
            }
        }
    ],
    "issues": []
}
```

## 结果

通过。默认新 Project 的真实 UI / API 链路已经不再需要作者手写主体系统映射 schema；模板内置 `player` 同步后，World Engine state 会保留六文件路径、RAG source、事件/记忆计数和主体系统版本，且 query `issues` 为空。

## 与计划的出入

- 本轮没有改代码，只做真实浏览器验收和文档同步。
- 普通 Playwright DOM snapshot 在该页面返回空字符串，但 in-app browser 的可见 DOM 能读取并点击顶部 `World`、`同步主体系统` 等真实 UI 节点；关键状态再用 HTTP State Query 复核。
- 本轮没有写真实 `ming-ding-zhi-shi-2`，只使用临时 Project。
- 清理时 `DELETE /api/projects/item` 再次超时且目录仍存在；随后按既定 fallback 停止 dev server，并调用 `deleteProjectWorkspace()` 删除明确的临时 Project，最终目录不存在。

## 清理

- 临时 Project 已在验收后删除。
- dev server 已关闭。
- `port 3001` 已确认空闲。
