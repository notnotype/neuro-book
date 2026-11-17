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
6. **下一步收敛与深化的六项共识（2026-11-17 开发者反馈）**：
   - **边界感区分「工作 vs 闲聊」**：工作状态（讨论剧情、设定、大纲、改稿、查证）作为司书神官当然应当专业严谨、有问必答；但闲聊与私人话题（问年纪、为什么赤足不穿鞋、羞耻的道藏长尊号等）必须有真实女孩的害羞、情绪边界与小秘密，严禁“先客套一句害羞紧接着竹筒倒豆子全招了”。
   - **思维链三条路线对比**：
     1. *路线 A（单人格思维链劫持）*：当前方案，受限于服务端 Thought Summarizer，呈现半星璃半助手状态；
     2. *路线 B（关闭原生思考 + 外部显性 CoT）*：归入 [`t03`](../t03-external-explicit-cot/README.md) 后续专项；
     3. *路线 C（人格分裂 / 双体共生合理化）*：将模型的理性分析/工具检索人格与星璃感性人格拆开并合理化（例如将理性层定义为怀中圣器**《万界真典》的器灵 / 脑内旁白**，负责检索记忆、判断工作/闲聊场景并引导星璃；星璃只负责纯粹的少女心声与对话输出）。
   - **高频基础记忆默认注入**：星璃几乎每次都会查的自身核心设定（如来历真名、书庭基本布局与日常喜好）直接默认注入或内化，避免每次对话开场先调多轮 `read` 查自己是谁。
   - **去除 `master.md` 中的 `- [ ]` 打卡清单诱导与通讯工具复读**：模型看到 `master.md` 里的 `- [ ]` 清单会触发任务打卡本能，导致用户只说一句“你好”就被强行科普「星语共鸣台」「忆星书庭」「万言星海」；日常打招呼绝不主动提通讯装置，世界观仅在话题自然聊到或用户问起时点到为止。
   - **提示词口吻统一收敛为「脑内旁白对话式引导」**：不再写生硬的命令（“你是星璃”），而是用脑内旁白温柔对话引导的语气（“星璃，你是……，你……”），与路线 C 的「脑内旁白 + 星璃本人」架构自然合一。

合同：仅涉及 `brand/mascot/guide/` 世界观文档补充及 `.local/`、`.dev-state/` 下的提示词与记忆实验，不改变应用运行时代码合同。

## 当前状态

2026-11-17（`active`）：已完成英文 `<meta_instruction>` 初版与原始思维链分析，已记录工作/闲聊边界、双人格合理化（脑内旁白 + 星璃）、高频记忆默认注入、去 `- [ ]` 科普打卡诱导等收敛方向。

## 下一步

- 按「脑内旁白对话引导 + 双人格合理化 + 高频记忆默认注入 + 去 `- [ ]` 打卡诱导 + 工作/闲聊边界区分」重构主力星璃提示词并实测。
