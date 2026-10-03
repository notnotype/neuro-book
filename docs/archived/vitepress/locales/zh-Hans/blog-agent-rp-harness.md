# 从 SillyTavern 到写作 Agent Harness：NeuroBook 的探索笔记

这篇文章不是 NeuroBook 的系统介绍。系统介绍应该放在教程、Reference 和产品文档里。

::: warning 这是一篇探索笔记，不是当前版本的功能说明
文中描述的 RP / 世界模拟三层结构是设计探索方向。**当前版本已把 RP 入口从常规界面下线**，产品重心收敛到长篇写作。要了解现在实际能用的能力，看 [核心能力](/core/world-engine) 或 [基础教程](/tutorials/)。
:::

这篇文章记录的是一个探索过程：为什么我会觉得现有 AI 创作工具还不够，为什么 SillyTavern 的模式会在长线写作和 RP 中遇到瓶颈，为什么 code agent 给了一个新的方向，以及为什么 NeuroBook 最后会走向“写作特化 Agent Harness”。

## 起因：SillyTavern 模式下的巨大缺陷

SillyTavern 的角色卡生态非常强。它证明了一个事实：作者可以把世界观、角色、规则和玩法封装成可分发的内容，用户加载后就能开始游玩。

但如果从系统结构看，它的核心仍然接近单轮生成：

```text
角色卡 + 预设 + 世界书 + 当前聊天 + 插件注入
-> 一次 LLM 调用
-> 一段回复
```

这套模式在轻量 RP 中非常好用，但它天然有几个问题。

第一，对话通常只有一轮真正的模型生成。正文、角色反应、旁白、剧情推进、状态变化都压在同一次调用里完成。模型写完以后，用户只看到结果，很难插入审查、批评、润色、重写这样的中间环节。即使 provider 侧可能做了某种润色，它也通常对用户透明，不形成可控工作流。

第二，提示词非常大。角色卡、预设、lorebook、变量、状态栏、插件动态信息都会拼进上下文。每次动态变量变化、lorebook 召回变化、状态栏变化，都可能破坏缓存，对首字延迟和交互体验有直接影响。

第三，它天生不带强记忆系统。长期记忆通常依赖手动总结、聊天摘要、插件数据库或外接系统。总结可以缓解上下文长度问题，但总结本身又会引入丢失、偏差和不可审查的问题。

第四，lorebook 太多以后，AI 注意力会不够。即使上下文窗口足够大，模型也不等于真的“理解并检索了所有条目”。它仍然是在预测下一个 token，容易忽略低频但关键的设定、隐藏条件和角色信息边界。

第五，角色很容易全知。很多角色卡的 worldbook 是上帝视角写的，但最终生成正文的是同一个 LLM。它一边看 GM 真相，一边扮演角色，一边写用户可见文本。在上下文很大的情况下，它很难稳定记住“谁知道什么”。

这些问题合在一起，说明 SillyTavern 的核心矛盾不是“模型文笔不够好”，而是单轮生成承载了太多职责。

## Agent 带来的转机：检索不该只靠注意力

Code agent 给了一个很重要的启发。

一个好的 code agent 在改代码前不会把整个仓库塞进上下文，然后靠模型注意力硬猜。它会先用 `rg`、文件读取、测试、类型检查等工具定位相关文件和相关上下文，再进行修改。

这解决了一部分创作系统的问题：retrieval。

在创意写作里，我们也不应该期待模型在一个超长 prompt 里自动注意到所有相关设定。更合理的方式是：

```text
当前任务 / 当前剧情 / 当前用户行动
-> 主动检索相关 lorebook、manuscript、Plot、simulation state
-> 组织成本轮需要的上下文
-> 再生成或裁决
```

这和 code agent 改代码前先搜相关函数、类型、测试是同一个思路。

但是，code agent 只解决了一部分问题。它擅长代码仓库，因为代码仓库有天然结构：文件、函数、类型、测试、调用关系、错误栈。创意写作没有这么统一的结构。如果每个人都把通用 Pi agent 或 code agent 改造成自己的创作系统，短期当然可行，但门槛很高，而且很难形成可交流、可分发、可迁移的内容标准。

这就是我认为需要 NeuroBook 的地方：不是简单把 code agent 搬到写作，而是为写作和 RP 建立一套领域结构。

## 为什么需要写作特化 Agent 框架

AI 创作不是没有结构，只是过去我们经常没有把结构显式建模。

一部小说项目至少需要回答这些问题：

- 设定放在哪里？
- 正文放在哪里？
- 当前剧情状态放在哪里？
- 哪些内容是上帝视角真相？
- 哪些内容是角色已经知道的信息？
- 哪些物品只是类型，哪些物品是有状态实例？
- 导入的角色卡里，哪些是稳定设定，哪些是动态脚本？
- writer 写正文前应该拿到哪些信息？
- 写完正文后，状态变化由谁提交？

如果没有统一规范，内容分发会很难。一个作者发布的角色卡、世界书或小说项目，另一个人很难知道哪些文件是 canon，哪些是临时状态，哪些是 prompt trick，哪些是变量 UI，哪些是角色可知信息。

SillyTavern 的 worldbook 在生态中承担了太多职责：

- 它负责普通设定召回。
- 它负责 MVU 变量初始化。
- 它负责变量更新规则。
- 它负责变量展示和状态栏。
- 它可能包含提示词模板。
- 它可能包含玩法系统、地点、势力、事件、角色卡、格式要求。

这是一种非常强的创作者自由，但也是系统迁移和长期维护的压力来源。

NeuroBook 的探索方向是：保留创作者自由，但把不同职责拆到更明确的位置。

## 信息控制的根因

RP 中最难的问题之一是信息控制。

现实跑团里，信息控制主体很清晰：GM 知道世界真相，玩家只知道自己角色合理知道的部分。玩家可以推理、误解、猜测，也可以被 GM 告知新的观察结果，但玩家不能直接翻 GM 的真相笔记。

AI RP 中这个边界很容易被破坏。根因是 SillyTavern 模式里所有正文通常由一个 LLM 写出来。这个 LLM 同时看到了上帝视角 lorebook、角色 prompt、当前聊天和动态变量，然后一次性生成用户可见正文。

人类写作时会分析：

```text
这个铁匠住在这个城市，他可能知道史莱姆凝胶的普通用途；
但他不是炼金术士，所以不该知道它在禁忌仪式中的真正用途。
```

LLM 不是这样工作的。它不是先维护一张严格的“谁知道什么”的知识图，再基于角色视角输出。它主要是在给定上下文里预测下一个 token。上下文越大、上帝视角信息越多，它越容易把不该泄露的信息写出来。

所以信息控制不能只靠 prompt 里一句“不要泄露秘密”。我们需要在内容结构和 Agent 流程上控制信息流。

## 一个真实 worldbook 例子

我观察了 SillyTavern 角色卡中的大量 worldbook 条目。比如这个文件：

```text
workspace/gong-li-yu-lu-xue-yuan/reference/silly-tavern/命定之诗与黄昏之歌v4.2/worldbook/entries/000601-DLC-角色-天原绘璃奈-天原绘璃奈(OwO-人造龙姬，活跃于艾瑟嘉德学院区).md
```

它记录了“天原绘璃奈”这个角色的基本信息、背景故事、外貌、性格、目标动机、战斗能力和个人物品。里面有这样的背景设定：她是艾瑟嘉德学院区的“人造龙姬”，诞生于一场联合实验，没有生物意义上的父母，学院学者们可以说就是她的父母；外界不知道她诞生的真正目的，她自己也在追问这个问题。

这类内容明显是上帝视角的真相。它很适合给作者、GM、simulator leader 看，但不适合直接给所有角色看，也不适合无过滤地给用户角色看。

哲学上说，故事中的角色永远无法直接得到“真理本身”。他们只能得到观察、传闻、误解、证据、推断和 GM 转告的部分信息。

因此 lorebook 的位置应该是 canon / prototype / truth source。角色真正能使用的信息，应该来自自己的经历、知识、心理和状态。

这就是 NeuroBook 后来区分 `lorebook/` 与 `simulation/subjects/` 的原因。

## 原型与实体：血药和下毒血药

再看一个更小的例子：血药。

“血药”作为一种消耗品，它的通用设定应该放在 lorebook：

```text
lorebook/item/consumable/blood-potion/
```

这里可以记录它通常能恢复伤势、常见价格、制作材料、副作用、连续饮用三瓶会发生什么等全知规则。

如果某个角色拥有三瓶普通血药，不需要实例化三次。角色的 `state.md` 可以直接记录：

```yaml
inventory:
  - prototype: lorebook/item/consumable/blood-potion/
    subjectVisibleName: 血药
    quantity: 3
    subjectKnownEffect: 通常用于恢复伤势
```

但如果其中一瓶被下了毒，它就不再只是普通数量。它有独立状态、隐藏真相和剧情风险，应该成为 entity：

```text
simulation/entities/poisoned-blood-potion-001/
```

这个 entity 的 `state.md` 可以记录真实状态：

```yaml
holder: simulation/subjects/npc-a/
condition:
  poisoned: true
subjectVisibleName: 血药
subjectVisibleProperties:
  - 看起来和普通血药没有区别
```

但 NPC-A 是否知道它有毒，不由 entity 决定，而由 NPC-A 自己的 `memory.jsonl` 和 `events.jsonl` 决定。

这就是 Prototype / Instance + Subject-facing View 的核心：

- `lorebook/` 保存原型、规则和全知设定。
- `simulation/entities/` 保存有状态实例。
- `simulation/subjects/` 保存信息主体看到、知道、误解和经历过的内容。

## 从单次生成到可审查链路

SillyTavern 模式下，正文通常是一次模型调用生成的。这个体验很直接，但创作上少了一个关键环节：审查。

人类写作很少是“一次写完就是最终稿”。更自然的流程是：

```text
writer -> critic -> writer
```

或者更长一点：

```text
plan -> draft -> critique -> revise -> final
```

这个范式在 LLM 研究里常被叫作 critique-and-revise、Self-Refine 或 Reflexion 家族的思路。它和 ReAct 类似，都不是把模型当成一次性文本生成器，而是让模型在多个步骤里思考、行动、观察、修正。

写作尤其需要这个循环。

writer 负责写草稿。critic 负责检查节奏、信息释放、人物动机、设定一致性和文风问题。writer 再根据 critic 的反馈重写。这个过程如果在 provider 内部透明发生，用户无法审查；如果在 Agent Harness 里显式发生，用户就能看到每一步、暂停每一步、替换每一步。

这也是为什么 NeuroBook 不应该只做“更大的 prompt”。它需要的是可组合的 Agent 流程。

## NeuroBook 探索出的整体方向

把上面的线索串起来，NeuroBook 探索的是一套写作特化 Agent 框架。

它不是要否定 SillyTavern。恰恰相反，SillyTavern 证明了角色卡、世界书和创作者生态的价值。NeuroBook 想继续往后走一步：把这些资产拆成可以长期维护、可以检索、可以迁移、可以多 Agent 协作的结构。

当前比较稳定的方向是：

```text
外部素材 -> reference/
稳定设定 -> lorebook/
正式正文 -> manuscript/
世界运行态 -> simulation/
剧情结构 -> Plot System
协作过程 -> Agent Harness
```

写作模式中，`leader.default` 负责理解用户意图，按需调用 retrieval、writer、researcher 或 simulation tick。writer 不直接维护世界状态，只负责正式章节正文。

RP 模式中，`simulator.leader` 承担 GM / simulator leader，调度 `simulator.actor` 和 `rp.writer`。actor 不读取完整 lorebook，只消费经过筛选的 GM packet。writer 只渲染用户可见正文，不承担 GM 裁决。

导入 SillyTavern 角色卡时，流程分为：

```text
inspect -> unpack -> import
```

inspect 只看概览。unpack 保存原始材料。import 把稳定 worldbook 条目导入 lorebook，动态机制先归档到 reference，等待后续迁移到 simulation mechanics。

这套设计的核心不是目录本身，而是职责分离：

- lorebook 不再承担所有职责。
- writer 不再承担所有职责。
- actor 不再被迫全知。
- GM / simulator leader 负责信息过滤和世界裁决。
- Harness 负责让检索、审查、记忆保存和状态提交成为可运行流程。

## 为什么 Harness 必不可少

如果只靠 prompt，很多设计都只是“希望模型照做”。Harness 的意义是把一部分希望变成结构。

例如：

- 哪些消息写入历史？
- 哪些上下文只给本轮模型看？
- 哪些检索 run 不污染主对话？
- 不同职责的 Agent 分别允许使用哪些工具？
- actor 回应后如何保存 `events.jsonl`、`memory.jsonl`、`mind.md`？
- writer 生成后是否进入 critic，再返回 writer 修订？
- 状态变化由谁提交，提交到哪里？

这些问题如果都靠一个 prompt 解决，系统很快会变成巨大的提示词拼接。它不仅慢，而且不可审查、不可组合、不可稳定分发。

Harness 的作用是把创作流程拆成可观察、可组合、可替换的运行单元。它让 NeuroBook 可以逐步从“AI 写一段文本”走向“AI 参与一个长期创作系统”。

## 总结

NeuroBook 的探索起点很简单：现有 AI RP 和 AI 写作工具把太多东西压进了一次模型调用。

SillyTavern 用角色卡和世界书打开了内容分发的大门，但单轮生成、超大 prompt、弱记忆、弱检索、弱信息控制、不可审查润色，都会在长线创作中变成瓶颈。

Code agent 展示了另一个方向：模型可以先检索、再行动，可以使用工具，可以把复杂任务拆成多步。但创意写作不能直接复用 code agent 的结构。它需要自己的文件规范、剧情结构、lorebook 协议、信息控制模型和写作工作流。

这就是 NeuroBook 的方向：

- 用 `lorebook/` 管理上帝视角稳定设定。
- 用 `simulation/subjects/` 管理角色视角知识、经历、心理和状态。
- 用 `simulation/entities/` 管理有状态实例。
- 用 `reference/` 保留外部素材和迁移证据。
- 用 `manuscript/` 保存正式正文。
- 用 Agent Harness 组织 retrieval、writer、critic、actor、GM 和状态提交。

最终目标不是让 AI 一次生成更长的文本，而是让 AI 创作进入一个可检索、可审查、可记忆、可分发、可长期维护的系统。

## 继续阅读

- [Agent Runtime Hooks](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/runtime-hooks.md)
- [Subject RAG Memory](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/content/subject-rag-memory.md)
- [Novel Writing Workflow](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/novel-writing-workflow.md)
- [Content Reference](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/content/README.md)
- [Agent RP Mode Task](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/.agents/tasks/01-agent-roleplay-mode/README.md)
