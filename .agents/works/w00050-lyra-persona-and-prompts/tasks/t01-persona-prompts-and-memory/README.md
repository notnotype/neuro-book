---
schema: nbook.task/v2
taskId: t01-persona-prompts-and-memory
status: active
updated: 2026-11-17
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
6. **双路线对比实验与四项深化设计（2026-11-17 第二轮收敛）**：
   - **收敛为两个实验 Profile 对比思维链路线**：
     1. `user.lyra`（**单人格思维链劫持**）：要求模型直接以星璃第一人称心声思考，并用脑内旁白对话口吻（“星璃，……”）引导角色；
     2. `user.lyra-dual`（**双人格合理化：《万界真典》书灵「真典（Codex）」+ 少女司书「星璃（Lyra）」**）：将模型天然存在的理性分析/工具检索/规则把控回路设定为第二人格——怀中圣器《万界真典》的伴生书灵**「真典（Codex）」**；在 `Thinking` 中由「真典」负责查阅记忆、调用工具并以脑内旁白口吻提醒星璃（或与星璃心声互动），而在最终回复中完全由「星璃」本人自然开口。
   - **跨维通讯软件化**：将原偏笨重的物理祭坛「星语共鸣台」调整为类似 QQ/Discord 的**跨维 IM 聊天软件**（天然契合打字聊天、在线状态与后续 `t02` 表情包发送，且日常绝不主动科普聊天软件本身）。
   - **「工作有问必答 vs 闲聊活人主体性」的完整边界（不局限于女孩子害羞话题）**：
     - **工作探讨（剧情、设定、大纲、改稿）**：司书神官的专业本职，严谨可靠、有问必答；
     - **日常闲聊与个人互动（活人主体性）**：① 拒绝把闲聊当阅读理解审讯（被连问多个问题时不列 `1/2/3` 全答，只挑最感兴趣的聊或反客为主）；② 有自己的主观好恶、小脾气与轻吐槽，不做永远顺从迎合的客服；③ 有小秘密、骄傲与少女矜持（问年龄、赤足原因、羞耻长尊号或想吊胃口的事，直接嗔怪挡回或卖关子，绝不“先客套一句害羞紧接着竹筒倒豆子全招了”）。
   - **记忆目录省 Token 重构（配合 frontmatter `alwaysLoad` 约定）**：
     - **常驻自动注入（`alwaysLoad: true`）**：`INDEX.md`（总目录）与 `master.md`（关于 Master 的关系阶段、称呼、创作偏好与约定；去掉 `- [ ]` 打卡清单诱导，聊天与写作均常驻）；
     - **按需翻阅（`alwaysLoad: false`，合并原 4 份碎片文件为 2 份高密度手记，减少 `read` 次数）**：`about-me.md`（我的来历真名、古籍外号、赤足穿搭秘密与日常五个小爱好）与 `atrium-and-cosmos.md`（忆星书庭、万言星海、白洞与界隙水镜造书、记忆宝石、圣器与折页星舟）。

合同：仅涉及 `brand/mascot/guide/` 世界观文档补充及 `.local/`、`.dev-state/` 下的提示词与记忆实验，不改变应用运行时代码合同。

## 当前状态

2026-11-17（`active`）：已完成 `user.lyra`（单人格思维链劫持）与 `user.lyra-dual`（双人格合理化：真典书灵 + 星璃）双 Profile 实验构建、记忆文件两层精简重构（去除 `master.md` 的 `- [ ]` 清单）并热更新生效。

## 下一步

- 由开发者选定跨维 IM 软件的正式名称，并在 NeuroBook 中实测对比 `user.lyra` 与 `user.lyra-dual` 在思维链表现及“闲聊活人主体性 vs 工作专业有问必答”上的效果。
