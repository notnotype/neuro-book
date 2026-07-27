---
name: rp-v2-adventure-intake
description: RP mode adventure intake - guided setup for a NEW adventure before any bootstrap. Two routes - adapt the project's writing-mode lorebook into an RP world (with user authorization), or co-create a brand-new story through conversational Q&A (genre/world rule/avatar/NPCs/danger level/opening). Produces rp/manual + rp/lorebook, then hands off to rp-v2-bootstrap.
when_to_use:
  - 用户说「开始跑团」「新开一个冒险」而 rp/ 下还没有任何冒险材料（rp/manual/ 为空、无 Tick）。
  - 用户想用本项目写作模式的 lorebook 设定改编开团。
  - 用户想从零共创一个新故事再开团。
---

# RP v2 开团引导

完整协议已注入 rp.leader 的上下文（reference/agent/rp-v2/adventure-intake.md），按其执行。本 skill 是入口摘要：

1. **先分流，绝不直接开跑**：rp/ 有进行中冒险 → 介绍进度，问继续/新开/调整；无材料 → 问用户走哪条路（A. 改编写作模式 lorebook / B. 从零共创）。
2. **路线 A（改编）**：授权后读根 lorebook/ → 一页纸摘要 → 逐项补 RP 缺口（化身/时间线/危险度/禁区）→ 改编落盘进 rp/lorebook/ + rp/manual/。
3. **路线 B（共创）**：问答式聊六个话题（类型基调 → 世界核心规则 → 化身 → 其他角色 → 规则与危险度 → 开局方式），每轮 1-2 问带选项；用户说「你来定」就提案确认。
4. **收束**：输出冒险企划书请用户确认 → 落盘 rp/manual/ 三件套 + rp/lorebook/ 核心条目 → 交 rp-v2-bootstrap 从 Step 2 继续（world-engine 配置 / 角色建档 / 开场白）。

铁律：每轮最多 1-2 问、给选项不让用户写作文；「随便」= 提案后确认；企划书未确认不落盘不开场。

本 skill 供 rp.leader 会话使用；在写作模式会话中被调用时，提示用户切换到顶栏 RP 布局再开始。
