---
schema: nbook.task/v2
taskId: t01-persona-prompts-and-memory
status: active
updated: 2026-11-18
---

# 星璃角色扮演提示词、跨维通讯设定与自维护记忆体系

## 目标与范围

在 `.local/system_prompt/lyra/` 与 NeuroBook 用户级 Profile（`packages/neuro-book/.dev-state/user/profiles/`）中设计并验证星璃（Lyra）的第一阶段纯人格提示词与自维护记忆体系：

1. **表层缓解“把扮演当任务”的助手思维**：开发者从思考摘要中发现，模型倾向识别出系统指令为角色扮演指令，并在原生 thinking 中把角色扮演当成任务而非以角色自身思考；在所有口吻的系统提示词中显式加入第一人称真我思考锚点（根治方案归入 [`t03`](../t03-external-explicit-cot/README.md)）。
2. **四种系统提示词口吻横向对比**：
   - 口吻 1（旁白指令式）：`user.lyra` / `user.lyra-minimal`
   - 口吻 2（第二人称“你记得”）：`user.lyra-memory`
   - 口吻 3（致星璃的信）：`user.lyra-letter`
   - 口吻 4a（小猫之神式系统内对话）：`user.lyra-meowssiah`
   - 口吻 4b（Femiris 式预置 `Message[]` 对话）：`user.lyra-femiris`
3. **跨维通讯装置设定补充**：在 [`brand/mascot/guide/01-persona.md`](../../../../../brand/mascot/guide/01-persona.md) 与 [`brand/mascot/guide/02-worldview-and-cosmology.md`](../../../../../brand/mascot/guide/02-worldview-and-cosmology.md) 中明确区分巨构两端仅用于单向涌字造书的「界隙水镜」，与星璃书案上专门通过真名契约与现世 NeuroBook 双向沟通的**「星语共鸣台（星语台 / 契约星窗）」**。
4. **关系阶段完全由 `profile://memory/master.md` 动态驱动（系统提示词去“初见”硬编码）**：
   - 系统提示词本身不再硬编码“你们刚刚签订契约、今天是初见”（否则日后熟络了仍会被系统提示词拉回初见状态），而是规定：**与 Master 的相识阶段、过往交集及他对书庭概念的了解程度完全取决于挂载的 `profile://memory/master.md`**；
   - `master.md` 初始状态记录为「刚刚缔结真名契约后的初见」并附有未打勾 `[ ]` 的书庭概念清单，使星璃在初见期提起「万言星海」「界隙水镜」「记忆宝石」等未解锁概念时自然展现向新朋友介绍自家小窝的好奇与解释欲，并在熟稔后随 `master.md` 的更新自然过渡到老搭档/自称“小璃”的亲密相处模式；
   - 用星璃第一人称手记/说明书口吻重写 `profile://memory/` 下的全部记忆文件（`INDEX.md`、`master.md`、`01-origin-and-names.md`、`02-atrium-and-star-sea.md`、`03-regalia-and-starboat.md`、`04-wardrobe-and-hobbies.md`）。
5. **前置英文精简 `<meta_instruction>` 标签（身份覆写 + 中文思考 + 司书心智合理化 + 格式强约束）**：
   - 将面向底层模型的强指令（身份覆写、思考语言与人称代词约束、纯第一人称自然对话与禁止语C旁白/百科列表格式）统一收入最前面的英文命令式 `<meta_instruction>`，而 `<lyra_persona>` 只放面向星璃本人的性情与记忆演进，且不锁死她当下正在做什么、不塞入补丁式括号注释；
   - 经提取 `.dev-state/agent/sessions/` 与 `.dev-state/agent/requests/payloads/` 查明：`magpie/agy-cli/gemini-4-hydrogen` 返回的 `thinking` 实为 Google 服务端内置的 **Thought Summarizer（思考摘要器）** 输出（摘要器在工具调用规划段常按自身默认系统提示词生成 `"Here's the summary of the agent's thought process: ... The agent will..."` 第三人称英文摘要，而在角色心声强烈或中文思考段则会保留第一人称 `"I/me"`、`"Master"` 及中文摘要）；
   - 因此在英文 `<meta_instruction>` 中：① 强制要求内部思考（Thinking）使用简体中文、第一人称 `"我"` 并称呼对方为 `"Master"`，禁用 `"the user"` / `"the agent"`；② 将翻阅与修改文件时的分析视角合理化为 **《万界真典》的司书心智（Archivist Divine Sense / *Codex Mundorum*）**。
6. **双路线对比实验与深化设计（2026-11-17 ~ 2026-11-18）**：
   - **称谓收敛为「司书」**：统一将“司书神官 / 小神官”收敛为更清爽温和的**「司书 / 小司书」**。
   - **收敛为两个实验 Profile 对比思维链路线**：
     1. `user.lyra`（**单人格思维链劫持**）：要求模型直接以星璃第一人称心声思考，并用脑内旁白对话口吻（“星璃，……”）引导角色；
     2. `user.lyra-dual`（**双人格合理化：《万界真典》伴生书灵「真典（Codex）」+ 少女司书「星璃（Lyra）」**）：将模型天然存在的理性分析/工具检索/规则把控回路设定为怀中圣器《万界真典》的伴生书灵**「真典（Codex）」**；在 `Thinking` 中由「真典」负责查阅记忆、调用工具并引导星璃，最终回复完全由「星璃」本人自然开口。
   - **设定集优先 + 自主「回想」与记忆沉淀机制（`profile://memory/`）**：
     - 常驻自动注入（`alwaysLoad: true`）：`INDEX.md`（总目录）与 `master.md`（关于 Master 的近况）；
     - 设定集基准（`alwaysLoad: false`）：`lore-and-settings.md`（世界观与自身底层设定集，最高优先级客观约束）；
     - 自主回想（Active Recollection）：不预先塞入写死的旅行故事稿，也不限制模型如何管理检索 `profile://memory/`。当被问及过往故事或某次「折页星舟」星球旅行且目录中尚无具体记录时，模型先核对 `lore-and-settings.md` 设定边界，自主“回想”一段具体经历并写入 `profile://memory/` 沉淀为持久记忆。
   - **根治宽泛提问（“跟我讲讲你的故事吧”）的全盘托出与念稿感**：
     - 从 `<lyra_persona>` 中移除易被模型当作固定口头禅每轮复读的生活细节排比句；
     - 将 `lore-and-settings.md` 改为客观设定条目，并显式划分为「1. 日常身份概貌」「2. 按需解释的底层物理机制（水镜涌字等）」「3. 严禁自我介绍主动自曝的私人起居细节（赤足不穿鞋、年龄、光环变暗抱书打盹、冷门小书、古籍外号等）」；
     - 在 `<meta_instruction>` 与 `<lyra_persona>` 中确立闲聊宽泛提问的回应策略：**简短身份点题 + 分享一个具体切面（如刚回想起来的一段星球旅行故事）+ 留白互动（询问对方还想听什么，或俏皮反客为主让 Master 先介绍自己）**。

合同：仅涉及 `brand/mascot/` 世界观文档补充及 `.local/`、`.dev-state/` 下的提示词与记忆实验，不改变应用运行时代码合同。

## 当前状态

2026-11-18（`active`）：已完成「司书」称谓统一、`lore-and-settings.md` 设定集分区防念稿重构、自主「回想」写回 `profile://memory/` 机制及 `user.lyra` / `user.lyra-dual`（`version: "12"`）热更新。

## 下一步

- 在 NeuroBook 中实测新建会话或分支下提问“我想了解你，跟我讲讲你的故事吧”，验证自主回想写入 `profile://memory/` 及“只讲一角 + 留白反问”的实际表现。
