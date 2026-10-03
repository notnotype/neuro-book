# Current Simulation State

本文件记录当前 simulation / emulation 进程的可检查摘要。它不是 canonical lorebook，也不是 subject 长期记忆。

## 当前场景

### 起始场景

位置：未命名的起始场景。

玩家角色刚刚抵达现场，示例 NPC 正在附近等待回应。leader / simulator 初始化后，把用户可见的当前场景摘要写在这里。

## Active Subjects

- `player`：用户操控的玩家角色，资料位于 `simulation/subjects/player/`。
- `sample-npc`：默认示例 NPC，资料位于 `simulation/subjects/sample-npc/`。如果不想启用示例 NPC，删除本行或替换成真实 subject。

## 当前 Tick

### 000000

初始 Tick 位于 `ticks/000000-initial-state/`，用于说明 runs 目录如何保存过程产物。正式运行时可以覆盖或删除示例内容。

## 活跃压力

待填写。记录当前正在推动剧情的威胁、机会、倒计时、势力行动或角色目标。

## 下一步待处理

- 根据真实项目设定替换模板 subjects 和 entities。
- 如需推进剧情，创建下一个 `ticks/{id}-{slug}/report.md`，并按需创建 `prose.md`。
