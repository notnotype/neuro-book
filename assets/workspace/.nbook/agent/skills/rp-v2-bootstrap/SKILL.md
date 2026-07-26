---
name: rp-v2-bootstrap
description: Bootstrap RP mode v2 for a project from zero to playable - RP world timeline init (worldKey=rp), character dossiers under rp/characters/, avatar creation with the user, opening prose, and optional state-view config. For rp.leader hosting a project's first RP session.
when_to_use:
  - 用户在 RP 模式下开始一个还没有任何 RP 运行态的项目（rp/ 目录为空、rp 世界线无切片）。
  - 用户说「开始跑团」「进入 RP」「帮我捏个角色开新冒险」而项目尚未初始化。
  - RP 化身或关键 NPC 需要补建档案。
---

# RP v2 Bootstrap：从零到可玩

按顺序完成五步。每步都是幂等的——中断后重跑不会破坏已有内容。协议细节见已注入的 rp-v2 参考文档（README / world-contract / adjudication / character-memory）。

## Step 1：确认世界观材料

- 读 `manual/README.md`、`manual/player-guide/`、`manual/gm-guide.md`；没有 manual 时改读 `lorebook/` 核心设定。
- 与用户确认：玩什么世界、扮演谁、从哪个场景开局。材料不足时先陪用户把「开局最小集」聊出来（世界基调、化身身份、第一个场景），不要空转生成。

## Step 2：初始化 RP 世界线（调用 rp.world）

invoke rp.world，消息写明「初始化」并给出：纪年/开局时间、world subject 初始状态、化身与关键 NPC 的首切片事实（位置/关键数值/持有物）。要求它：

- 一律 worldKey="rp"（绝不碰写作模式主世界线）。
- 地点 subject 带 `连接` 字段、角色 subject 带 `关系` 字段（地图与关系图面板靠它们生长）；schema 不含这些字段时如实报告即可，不硬造。
- 隐藏状态放进 subject 的 `secret` 子对象。

## Step 3：角色建档（rp/characters/）

对化身与每个关键 NPC：

1. `rp_character_update op=ensure` 建骨架。
2. 按 subject-creation-guide 方法论写 soul.md（第一人称扮演手册：我是谁/性格调色盘/说话方式/我知道什么/想要什么怕什么/不会做什么），`op=write_soul` 写入。**化身（player）的 soul.md 侧重身份与处境，性格留给用户输入**。
3. `op=write_mood` 写开局心境。
4. 开局已知的关键信息用 `op=add_knowledge` 落账（含来源）；开局就该有的戏剧反差交给 rp.screenwriter 用 `op=add_unknown` 登记。

## Step 4：开场白

生成开场白 Writer Brief（`<context>` 通常为空，`<beats>` 写化身入场/身体感/可见人物/第一选择点），创建 rp.writer 写入 `rp/ticks/000000-initial-state/prose.md`。终稿组装：正文链接 + 彩绘的元场景引导。

## Step 5（可选）：状态面板配置

用户想让侧栏角色卡更好看时，按 `world-engine-state-view` skill 写 `world-engine/state-view.json`（hp 配 progress、物品配 item-list 等）。RP 侧栏与 World Engine Workbench 都会消费它。

## 完成标准

- rp 世界线有 world subject 与开局切片（RP 侧栏「世界」面板能显示时间与登场要素）。
- 化身与关键 NPC 在 rp/characters/ 下有 soul/心境/已知信息。
- `rp/ticks/000000-initial-state/prose.md` 已由 rp.writer 写入，用户收到开场白链接。
- 之后进入常规 Tick 流水线（见 rp-v2/README.md）。
