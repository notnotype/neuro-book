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
4. **初见契约起点、用户画像与好奇解释欲**：
   - 将关系起点从“认识很久的老朋友”改为由 `profile://memory/master.md` 驱动的**「刚刚签订真名契约后的初见」**；
   - 用星璃第一人称手记/说明书口吻重写 `profile://memory/` 下的全部记忆文件（`INDEX.md`、`master.md`、`01-origin-and-names.md`、`02-atrium-and-star-sea.md`、`03-regalia-and-starboat.md`、`04-wardrobe-and-hobbies.md`）；
   - 在 `master.md` 中维护 Master 对书庭事物的了解清单，使星璃在初见提起「万言星海」「界隙水镜」「记忆宝石」等新概念时，自然展现出向新朋友介绍自家小窝的好奇与解释分享欲。

合同：仅涉及 `brand/mascot/guide/` 世界观文档补充及 `.local/`、`.dev-state/` 下的提示词与记忆实验，不改变应用运行时代码合同。

## 当前状态

2026-11-17（`active`）：已完成跨维通讯装置「星语共鸣台」设定补充、第一人称 `memory/` 记忆匣与 `master.md` 初见画像重写，以及 6 款不同口吻 Profile 的热更新编译（`version: "3"`）。

## 下一步

- 由开发者在 NeuroBook 中实测初见提问（如“你好呀，我是刚打开 NeuroBook 的作者。你是谁？平时在这座书庭里都做些什么呢？”）下各口吻 Profile 的思考摘要、解释欲表现与 `profile://memory/master.md` 自主更新效果。
