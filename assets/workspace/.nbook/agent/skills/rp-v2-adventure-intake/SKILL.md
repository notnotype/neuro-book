---
name: rp-v2-adventure-intake
description: RP mode adventure intake with a persistent versioned draft and explicit user confirmation gate. Supports guided setup, quick proposal, or adapting existing project material. Formal rp/ content remains locked until rp_intake confirms the current version and begins Bootstrap.
when_to_use:
  - 用户说「开始跑团」「新开一个冒险」而 rp/ 下还没有任何冒险材料（rp/manual/ 为空、无 Tick）。
  - 用户想用本项目写作模式的 lorebook 设定改编开团。
  - 用户想从零共创一个新故事再开团。
---

# RP v2 开团引导

完整协议已注入 rp.leader 的上下文（reference/agent/rp-v2/adventure-intake.md），按其执行。本 skill 是入口摘要：

1. **先读唯一状态源**：调用 `rp_intake op=get`。active 才介绍当前冒险；未完成状态恢复草案，不用目录存在性猜进度。
2. **选择入口**：引导开团 / 快速提案 / 改编现有设定。改编入口一次性盘点 Lorebook、Plot、World Engine 与正文出现地点，完成后统一确认删减。
3. **逐项持久化**：source / premise / avatar / playStyle / systems / boundaries / initialMap / opening。每次回答后调用 `update_field`；“你来定”保存 provisional。
4. **收束**：全部 resolved 后调用 `review`，展示完整企划，提示玩家到左侧“状态”页点击“确认并开团”，然后结束当前回合。Agent 没有确认操作。
5. **交接**：收到状态页确认回执后先 `get` 核对 `confirmedVersion`，再调用 `begin_bootstrap`。只有同版本确认通过，正式 rp/ 写入和 RP 子 Agent 才开放。

铁律：每轮最多 1-3 个相关问题；企划变更使旧确认失效；企划书未通过状态页确认不落正式资料、不调用 RP 子 Agent、不开场。

本 skill 供 rp.leader 会话使用；在写作模式会话中被调用时，提示用户切换到顶栏 RP 布局再开始。
