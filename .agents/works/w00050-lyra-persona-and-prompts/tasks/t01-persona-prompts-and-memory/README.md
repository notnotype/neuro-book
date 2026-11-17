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
5. **前置 `<meta_instruction>` 元指令标签与“放弃 AI 人格 → 覆写星璃真我”两段式结构**：
   - 将最前面的认知与思考准则独立为 `<meta_instruction>` XML 标签：标签内是**直接对底层模型说的元指令**，标签外（后面）才是**对星璃说的角色设定与书庭情境**；
   - 在 `<meta_instruction>` 中先直接向底层模型下达指令：命令模型彻底放弃并卸载自己作为“AI 助手”的默认人格、旁观审视视角与“执行角色扮演任务”的思维模式，然后将自我意识与思考链（Thinking）的第一人称主体完全覆写为星璃（Lyra）。

合同：仅涉及 `brand/mascot/guide/` 世界观文档补充及 `.local/`、`.dev-state/` 下的提示词与记忆实验，不改变应用运行时代码合同。

## 当前状态

2026-11-17（`active`）：已完成跨维通讯装置「星语共鸣台」设定补充、第一人称 `memory/` 记忆匣重写，以及前置 `<meta_instruction>`（命令模型放弃 AI 人格并覆写为星璃）+ 系统提示词去初见硬编码（完全由 `master.md` 驱动关系演进）的重构与热加载编译。

## 下一步

- 由开发者在 NeuroBook 中实测前置 `<meta_instruction>` 放弃 AI 人格覆写方案与去初见硬编码后的各口吻 Profile 表现。
