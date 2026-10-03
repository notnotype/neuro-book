---
type: emulation-run-report
runId: 000000-initial-state
mode: bootstrap
status: draft
worldTimeBefore: ""
worldTimeAfter: ""
---

# 000000 Initial State

本报告用于说明 simulation 初始运行态。它是 leader / simulator 的创作判断文件，不直接作为正文或 lorebook canon。

## Trigger

Project 模板创建了默认 simulation 目录。

## Goal

建立最小可用的运行态示例，让后续 emulation tick、开局剧情设计或 RP 初始化知道应维护哪些信息。

## Scope

- subjects：`player`、`sample-npc`
- entities：`example-item`
- runs：`current.md`、`index.md`、本 tick 的 `report.md` 和 `prose.md`

## Inputs

待填写。正式项目中列出本次初始化读取的 lorebook、Plot、reference 或用户指令。

## Prior State

模板状态，尚未绑定真实故事时间和场景。

## Active Subjects

### player

玩家 / 主角 subject。正式项目中应把玩家角色当前地点、已知信息、持有物和短期目标写入 `simulation/subjects/player/`。

### sample-npc

示例 NPC。正式项目中可替换为开局关键角色，或删除该 subject。

## Active Entities

### example-item

示例有状态实例。只有唯一、隐藏状态、损坏、进度、持有人差异或剧情关键对象才需要进入 `simulation/entities/`。

## Hidden Facts

待填写。这里记录 simulator leader 知道但不能直接交给 actor 或 writer 的信息。

## Causal Chains

初始化 tick 不推进剧情。后续 emulation tick 至少记录 2 到 3 条与当前剧情有关的因果链。

## Random Disturbances

初始化 tick 不生成随机扰动。

## Adjudicated Events

尚未发生正式事件。

## Subject Updates

初始化时按需写入 subject `events.jsonl`、`memory.jsonl`、`mind.md` 和 `state.md`。

## Entity Updates

初始化时按需写入 entity `entity.md` 和 `state.md`。

## Information Boundary

不要把完整上帝视角 lorebook 复制进 subject `memory.jsonl`。subject 只能知道自己经历、被告知、观察或自然推断到的信息。

## Plot Consequences

无。初始化 tick 不替代 Plot System。

## Writer-safe Brief

如需向用户展示开场，生成 Writer Brief 并交给 `rp.writer` 写入本目录 `prose.md`。Brief 只写当前可见场景和玩家角色合理已知信息，不泄露 Hidden Facts。

## Commits

- `simulation/runs/current.md`
- `simulation/runs/index.md`
- `simulation/runs/ticks/000000-initial-state/report.md`
- `simulation/runs/ticks/000000-initial-state/prose.md`

## Open Questions

- 当前世界时间是什么？
- 玩家角色初始位置在哪里？
- 哪些 subject 和 entity 需要进入正式运行态？

## Next Hooks

完成初始化后，可进入 `novel-workflow-06-emulation-tick`、开局剧情设计或 RP 初始化。
