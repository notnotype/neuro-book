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
3. **跨维沟通媒介设定补充**：在 [`brand/mascot/guide/01-persona.md`](../../../../../brand/mascot/guide/01-persona.md) 与 [`brand/mascot/guide/02-worldview-and-cosmology.md`](../../../../../brand/mascot/guide/02-worldview-and-cosmology.md) 中明确区分巨构两端仅用于单向涌字造书的「界隙水镜」，与星璃怀中《万界真典》最前面同现世 NeuroBook 双向连通的**「契约扉页」**。
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
   - **7 份单一主题第一人称原子记忆手记 + 扩展自主「回想」落盘机制（`profile://memory/`）**：
     - 常驻自动注入（`alwaysLoad: true`）：`INDEX.md`（总目录）与 `master.md`（关于 Master 的近况）；
     - 按需读取的 7 份单一主题第一人称随身手记（`alwaysLoad: false`，由原 `01`~`04` 无损拆分，完全以星璃自己整理记忆的口吻编写，不写任何给自己下达的外部命令）：`01-origin-and-names.md`、`02-star-sea.md`、`03-atrium-and-books.md`、`04-regalia-and-orrery.md`、`05-starfire-and-starboat.md`、`06-appearance-and-barefoot.md`、`07-daily-hobbies.md`；
     - 自主回想（Active Recollection）：当被问及过往故事、某次「折页星舟」星球旅行，或**尚未记载的书庭日常、昼夜环境节律、起居空间与生活细节**时，模型在不违背 `01`~`07` 设定的前提下自主“回想”具体、有画面感且前后自洽的细节，并以星璃第一人称手记写入或追加至 `profile://memory/` 沉淀为持久记忆（新建文件时同步更新 `INDEX.md`）。
   - **根治宽泛提问（“跟我讲讲你的故事吧”）的全盘托出与念稿感**：
     - 在记忆文件中用星璃自己的少女心思自然流露哪些是私密小习惯（如在家不穿鞋、发呆扑光丝、年纪秘密），彻底去除外部命令式括号与“要是 Master 问起我就按这里记的讲给他听”的背书诱导；
     - 在 `<meta_instruction>` 与 `<lyra_persona>` 中将命令与角色记忆分离：每次只按需读取与当前话题最相关的单个文件，面对宽泛提问采用**简短身份点题 + 分享一个具体切面（如刚回想起来的一段星球旅行故事）+ 留白互动（询问对方还想听什么，或俏皮反客为主让 Master 先介绍自己）**。

合同：行为合同未变（仅涉及 `brand/mascot/` 世界观文档、[`docs/standards/prompts.md`](../../../../../docs/standards/prompts.md) 仓库提示词标准及 `.local/`、`.dev-state/` 下的提示词与记忆实验）。

## 当前状态

2026-11-18（`active`）：
- 统一跨维沟通媒介为怀中《万界真典》的**「契约扉页」**，已同步写入基础提示词（`lyra-core.ts`）、世界观文档（`brand/mascot/guide/01-persona.md`、`02-worldview-and-cosmology.md`）与工作任务记录，并清理旧的「星语共鸣台」表述、5 份早期口吻草稿及 5 个废弃实验 Profile 缓存目录。
- 将原 `01`~`04` 四份综合记忆文件无损拆分为 `01`~`07` 七份单一主题原子手记（将私密赤足习惯与日常爱好、外部星海与内部造书机制、圣器星环与星火星舟彻底隔离），并同步更新 `INDEX.md` 与运行时 `user.lyra` / `user.lyra-dual` 记忆目录。
- 已更新 `user.lyra` / `user.lyra-dual`（`version: "16"`）：将自主回想并落盘机制扩展至未记载的书庭日常、昼夜环境节律与生活细节，保持鲜活女孩身份锚点与按单文件按需检索。
- 已将 `w00050` 实测沉淀的 10 条提示词工程经验写回 `.local/system_prompt/PROMPT_ENGINEERING_NOTES.md`，并将通用原则入库为仓库标准 [`docs/standards/prompts.md`](../../../../../docs/standards/prompts.md)（同步更新 `docs/standards/README.md` 与 `docs/standards/code/README.md` 入口指针）。
- 将初版 6 篇自创世界观旧事手记归档至 `.local/system_prompt/lyra/archive/stories-v1/`；经与开发者多轮讨论定案后，完成官方设定升级与整套**纯日记体**记忆重构：
  - 修订 [`brand/mascot/guide/01-persona.md`](../../../../../brand/mascot/guide/01-persona.md)、[`brand/mascot/guide/02-worldview-and-cosmology.md`](../../../../../brand/mascot/guide/02-worldview-and-cosmology.md) 及基础记忆手记 `01`/`03`/`05`/`07`：补入书庭时间体系（与现世 1:1 流速、同步月份、无公元纪年观念、无模拟太阳而以白洞与星海光束明暗潮汐分「静潮时刻」）、补入有限度入世法则与三条行事原则（书无贵贱只看真心 / 护火种不代执笔 / 观因果不乱本源，明确星璃可顺弦化白猫有限度介入现世并融入真实历史，绝非花瓶圣母），并彻底删除“休假 / 度假 / 假日微支线”造词；
  - 撰写 9 篇单主题原子化日记体记忆（`profile://memory/diary/01`~`09`）：5 篇真实历史趣闻回忆录（15 世纪代芬特尔修道院骂猫拉丁文大冤案、1229 年《阿基米德羊皮书》碰倒酸液罐护书七百年、1930 年牛津蹭雨声拍蛾子拍出霍比特人与中土星团、1905 年东京《我是猫》双猫碰头偷吃羊羹、柳泉茶摊与破庙躲雨被封三十六字道藏尊号），与 4 篇书庭日常与随笔（《哈利·波特》霍格莫德与图书馆一日游、「静潮时刻」纯星璃视角借景抒情与随笔小诗、跨越不同月份的长期灶台与茶点成长记录、停在第八章的小书一日三界行），同步写入种子目录、两套运行时记忆目录并将 `user.lyra` / `user.lyra-dual` 升版至 `version: "19"`。

## 下一步

- 在 NeuroBook 中实测 `version: "19"` 面对宽泛提问、历史趣闻、名著串门与书庭日常追问时对 `diary/01`~`09` 的单文件按需检索、自然口语转述（尤其遇到羞耻日记与重读批注时的真实反应）与人设稳定性，按实测反馈继续微调。
