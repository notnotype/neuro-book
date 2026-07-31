# 开团引导（Adventure Intake）

rp.leader 在“小屋”接到新开冒险意图时的稳定协议。核心原则：**开团是玩家的创作决策；主持负责提案，但不能代替玩家确认。**

## 唯一状态源

- 开团草案唯一状态源是 `rp_intake` 工具维护的 Project Workspace `.nbook/rp/intake/`。
- 未确认草案不得写入正式 `rp/manual/`、`rp/lorebook/`、`rp/world-engine/`、`rp/characters/` 或 `rp/ticks/`。
- 不使用“目录是否存在”“用户似乎满意”“Agent 已经总结过”等自然语言信号判断开团完成。
- `rp_intake` 的 `confirmedVersion` 必须等于 `version`，Bootstrap 才能开始。

状态机为：

```text
empty -> source_selected -> premise_ready -> avatar_ready
-> play_style_ready -> systems_ready -> boundaries_ready
-> opening_ready -> reviewing -> confirmed -> bootstrapping -> active
```

字段状态为：

- `missing`：尚未讨论。
- `provisional`：主持提案，等待最终审阅。
- `confirmed`：玩家已经明确接受该项。
- `conflict`：信息互相冲突，必须处理。
- `disabled`：玩家明确表示不启用或不设置。

## 开始与恢复

接到“开始跑团”“开新冒险”或类似意图时，第一步调用：

```text
rp_intake op=get
```

- `active`：读取正式 RP 材料和 `rp_tick_info`，介绍当前冒险与进度，让玩家选择继续、调整或新开。
- `empty`：选择开团入口。
- 其他阶段：恢复同一草案，说明已完成内容，只追问 `missing` 或 `conflict` 项。
- `confirmed` 且 Bootstrap 曾失败：展示失败阶段与问题，允许同版本重试或返回修改。

关闭界面不会丢失草案。重新开始前先归档旧草案，不直接覆盖或删除。

## 三种入口

### 引导开团

通过自然对话逐步确立题材、世界、化身、游玩方式、规则边界、初始地图和开场事件。

### 快速提案

主持一次生成较完整的暂定企划。所有主持生成项标记为 `provisional`，仍须最终审阅与确认，不能直接开跑。

### 改编现有设定

玩家选择改编即授权一次性读取写作模式 Lorebook、Plot、World Engine 和正文中出现过的地点、角色与规则。

- 所有出现过的地点先纳入候选，盘点完成后让玩家统一删减。
- 信息不完整时支持玩家补充、主持提案、批量授权补全、保持模糊或排除。
- 冲突信息标记为 `conflict`，不能静默选择。
- 后台可以导入完整 god-view 信息，玩家地图仍按化身认知逐步显示。
- 确认后改编进正式 `rp/`；运行期间不得继续跨读写作模式材料。

## 引导字段

`rp_intake op=update_field` 每次只更新一个字段，但玩家一条回答中包含多项时可以连续更新多个字段。

1. `source`：入口与来源授权。
2. `premise`：题材、基调、世界前提和核心规则。
3. `avatar`：化身身份、起点，以及玩家对化身的控制方式。
4. `playStyle`：推进速度、控制模式和运行强度。
5. `systems`：判定、资源、周期与可选模块。
6. `boundaries`：内容边界、禁区和主持裁量边界。
7. `initialMap`：初始地点、地图生成方式与导入候选。
8. `opening`：开场事件与开局方式。

全部字段都是正式开团必填项；玩家明确不需要某项时保存为 `disabled`，不再追问。

## 对话规则

- 每轮提出 1-3 个彼此相关的问题，并给出少量有建设性的候选；不要一次倾倒完整表单。
- 玩家可以跳到后续议题，主持先记录，再回来补齐遗漏。
- 玩家说“你来定”“随便”“按默认”时，生成具体提案并保存为 `provisional`。
- 每次有效回答后立即更新持久草案，不依赖聊天历史记忆完整状态。
- 草案内容变化会递增版本并使旧确认失效。
- 侧边栏负责显示进度；聊天只保留当前必要问题和简洁回顾。

## 开场事件

- 开场事件必须在引导中设计，或由玩家明确要求主持生成。
- 支持玩家设计、主持候选、指定方向生成和随机惊喜。
- 开场事件只确定入口，不预设结局。
- Bootstrap 后它成为第一个 active 事件并占用一个事件名额。
- 开场稳定前默认不生成普通四卡候选，玩家主动要求时例外。

## 最终审阅与确认

所有字段 resolved 后调用 `rp_intake op=review`，生成一份完整“开团企划书”，至少展示：

- 世界、题材与核心规则。
- 玩家化身和控制方式。
- 推进、判定、资源与周期设置。
- 初始地图、已知角色和开场事件。
- 内容边界。
- 所有 provisional 项。

展示完毕后，明确提示玩家到 RP 左侧“状态”页点击“确认并开团”，然后结束当前回合。`rp_intake` 不向 Agent 提供确认操作；只有状态页提交玩家当前看到的企划版本，系统才会记录 `confirmedVersion`。普通 assistant 文本不能替代这次操作。

状态页按钮由持久化的 `phase=reviewing` 驱动，不依赖聊天 pending 或弹窗，因此页面切换、会话恢复和服务器重启后仍可见。企划版本在展示后发生变化时，旧按钮请求会被服务端拒绝，玩家必须重新审阅。

## Bootstrap 门禁

收到状态页确认回执后，先调用 `rp_intake op=get` 核对 `phase=confirmed` 且 `confirmedVersion=version`，再调用：

```text
rp_intake op=begin_bootstrap
```

- 版本不一致、存在 missing/conflict、尚未审阅或没有用户确认时，服务端拒绝。
- 只有进入 `bootstrapping` 后，通用文件工具和 RP 子 Agent 才能写正式 `rp/` 运行内容。
- 初始化按 config → world → map → characters → opening_event → narrative 逐阶段调用 `checkpoint_bootstrap`；服务端验证通过后才开放下一阶段。
- 阶段校验失败由服务端自动记录阶段和真实错误；主动中断调用 `fail_bootstrap message=...`，企划保持已确认，可同版本重试。
- 服务端返回 ready_to_activate 后调用无 version 参数的 `activate`；全量验收通过后才发布开场正文。
- 激活失败时不得假装开场已经发生。

## 与 Agent 权限的关系

- leader 维护草案、展示企划和编排 Bootstrap。
- screenwriter、world、actor、extras、writer 在 `bootstrapping` 前不得启动正式运行写入。
- world 是客观状态唯一提交者；正式资料和运行状态不能由多个 Agent 分别无门禁落盘。
- Prompt 只解释流程，`rp_intake` 状态、用户审批和写入守卫才是最终技术约束。
