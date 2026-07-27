---
name: RP模式
description: 进入 NeuroBook RP 模式（v2）的总入口说明：顶栏 Agent/IDE/RP 三态布局、rp.leader 六角色 Tick 流水线、rp/ 子树材料结构、开团/继续冒险的正确路径。legacy simulator 体系不再是普通入口。
when_to_use:
  - 用户说进入 RP、开始 roleplay、跑角色扮演、开团、和角色互动
  - 用户询问 RP 模式怎么用、rp.leader / rp.world / rp.screenwriter / rp.writer 是什么
---

# RP 模式（v2）

RP 模式 v2 的普通用户入口是**顶栏 Agent/IDE/RP 三态切换的 RP 布局**：左侧世界/地图/角色面板 + 会话列表，中间 rp.leader（彩绘）沉浸对话流，右侧跑团正文阅读面板，右下角 2d6 掷骰按钮。

## 前置检查

- 当前 Project Workspace 必须存在 `project.yaml`。
- RP 的一切材料都在项目的 `rp/` 子树：`rp/manual/`（玩家手册）、`rp/lorebook/`（世界观 canon）、`rp/world-engine/`（schema + 历法）、`rp/characters/{id}/`（角色档案与记忆，id 以 `rp/characters/registry.json` 注册表为准）、`rp/ticks/`（每 Tick 的 report.md 与 prose.md）、`rp/dice/`（掷骰记录）。
- **与写作模式完全分离**：根 `manual/`、`lorebook/`、`world-engine/`、`manuscript/` 是写作模式的，RP agent 不读写；仅开团引导「改编路线」允许在用户授权下一次性拷贝改编进 `rp/`。

## 启动方式

1. 切换到顶栏 RP 布局（或新建 `rp.leader` 会话）。rp.leader 负责开局引导、陪伴交流与流水线编排。
2. **新项目开团**：rp.leader 先走开团引导（`rp-v2-adventure-intake`）——问用户是改编写作模式设定还是从零共创，聊出冒险企划书并经用户确认后，再走 `rp-v2-bootstrap` 完成技术初始化（world-engine 配置 / 角色建档 / 开场白）。**不要跳过引导直接编剧本开跑**。
3. **已有冒险**：rp.leader 介绍这是什么世界、扮演谁、进行到哪，由用户选择继续 / 新开 / 调整化身。

## 角色分工（v2 六角色流水线）

`rp.leader`（主持编排，权威 Tick 编号由它用 rp_tick_info 宣告）→ `rp.world`（World Engine 唯一读写通道，一律 worldKey=rp）→ `rp.screenwriter`（一切判断与终裁；2d6 目标值由它定，骰子由用户在界面亲掷、以 `rp/dice/rolls.jsonl` 为准）→ `rp.cast`/`rp.actor`（主角并行扮演）∥ `rp.extras`（群演）→ `rp.writer`（用户可见正文，写入 `rp/ticks/{NNNNNN-slug}/prose.md`）。协议细节见 `reference/agent/rp-v2/README.md`。

## legacy 边界

`simulator.leader` / `simulator.actor` / `simulation/` 目录是 v1 legacy 体系，仅供历史项目使用，不作为 v2 入口；两套互不迁移、互不混用。SillyTavern 卡导入仍可先用 `novel-import-silly-tavern-card`，产物再经开团引导改编进 `rp/`。
