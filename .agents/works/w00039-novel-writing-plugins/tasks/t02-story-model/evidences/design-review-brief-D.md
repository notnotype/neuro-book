# 任务：独立设计 w00039：作者视角的小说世界模型内核

仓库：`/home/notnotype/CodeRepository/neuro-book`（只读）。你是一位没参与讨论的架构师，要独立给出一份设计。另有人写了一份方案，你**不要读**它，也不要读这几个文件，它们记着那份方案与讨论过程：`docs/proposals/world-engine-kernel.md`、`.agents/works/w00039-novel-writing-plugins/README.md`、`.agents/works/w00039-novel-writing-plugins/tasks/t02-story-model/` 下的全部文件、`.agents/works/w00039-novel-writing-plugins/research/2026-11-01-author-domain-analysis.md`。

## 目标

NeuroBook 是本地优先的长篇小说写作工作区，作者与产品内置的 Agent 一起写书。为它设计“作者视角”的世界模型内核：管理设定、随剧情变化的状态、剧情计划与情节，让作者和 Agent 能长期一起写一部几百章的长篇。只设计模型（数据怎么组织、怎么随剧情变、作者与 Agent 各自怎么用），存储格式与界面细节不必定。

## 需求（开发者的原话或概括）

1. 旧版用户反馈：设定管理、人物管理太复杂（只能通过文件来设定），希望有一套可视化的表单系统。
2. 设定写下以后不是一成不变的，会经常变：小说推进剧情时在原设定基础上补充、解释；作者发现某处设定错了要改。还有一种作者也要自己维护：状态，例如主角有多少钱、有什么物品。人物关系能从正文里读出来，作者要不要专门管，需要你判断。
3. 作者无心智负担，或者负担很小：作者通常不负责数据结构的维护，只产出文本（提示词，可能有图片等多模态）；作者能查看、修改、补充已经维护好的数据结构。作者的描述文字表达力最强，系统管理的格式表达力不如它。
4. 现在没有无限上下文；即使上下文无限，作者作为人类也背不下全书，需要整理过的视图（人物视图、剧情视图）。
5. 用户不喜欢自己写的文字被 AI 自动转写（转写后文字就不是自己的了）。
6. 作者通过系统界面访问，不直接编辑存设定的文件夹；直接访问文件留给 Agent。
7. 作者写书时承载树（卷、章）和因果树（剧情线、情节）是一起想的。有的作者先搭设定再写，比较懒的直接动手写第一章，设定靠脑子记，只把技能、数值和要构思的东西记下来。
8. 游戏文、面板文常用精确的数值（例如魔法精灵展开的面板）。
9. 条目的样子差别很大：
   - “灵魂宝石”：只有一段介绍文字；
   - “魔法少女对策局”：一个组织，有介绍、成员列表（每人一句介绍）、历史经历；
   - 人物：作者要填表，还要能存图片（立绘）；
   - 情节：条目很多，要分页，作者要有查询控件（要能调用嵌入和模型）；
   - 地点有层级（大陆 / 欧亚大陆 / 英国 / 皇宫 / 房间），用户想由此建立世界地图。
10. Agent 的典型场景：作者给出一章的第一版细纲，想先和 Agent 讨论、审查有没有吃书（和已写正文冲突）、吃设定、不严谨；Agent 需要先查细纲里出现的人名、物品、概念（这一步也可以由系统自动做）。写完一章后，要把这一章发生的变化记下来（“记账”），这是作者最想交给 Agent 的事。
11. 以后可能要支持平行宇宙、死亡回档（GitHub Issue #144）；以后可能和 nb-story（读者视角的剧情图谱）合并。第一版不必做到，但不要堵死。

## 例子

- 一位作者的故事种子、加面板的要求与第一章大纲，原样摘录：`/home/notnotype/CodeRepository/neuro-book/.local/agent/works/w00039-novel-writing-plugins/tasks/t02-story-model/review/xingxia/seed-and-chapter1-outline.txt`
- 另一本书（样本书）的前 3 章正文：`/home/notnotype/CodeRepository/neuro-book/.local/agent/works/w00039-novel-writing-plugins/tasks/t02-story-model/review/book/chapter-01.txt` 到 `chapter-03.txt`

## 可以读的现状

- `.agents/works/w00039-novel-writing-plugins/research/2026-10-31-repo-survey.md`（nb-story、旧 WorldEngine 与剧情工坊、旧版设定、新应用的现状）
- nb-story：`docs/proposals/novel-memory-v9.md`、`docs/specs/story/`；nb-memory：`packages/nb-memory/README.md`；nb-history：`packages/nb-history/README.md`；表单：`docs/specs/ui/forms.md`；活页夹：`docs/specs/workspace/folder-kinds.md`

## 做法

1. 先逐个视角提质疑，每个视角几句：反对与精简（这件事要不要做，能不能用现成的库或模块）；成本（开发、运行、模型额度）；使用者体验（作者、写代码的 Agent、产品里的 Agent）；迁移与兼容；可观测与排障；长期维护与技术债。
2. 再给出你的方案：核心概念与它们的关系；设定、状态、剧情、情节各存在哪、怎么随剧情变；作者怎么开始一部作品、日常怎么用；Agent 怎么查、怎么审查细纲、怎么记账；用上面星瑕的例子走一遍。
3. 给出两到三个备选与取舍，说明你为什么选你的方案。
4. 列出你的方案里你最没把握的三件事。

只读，不改仓库文件，不开子代理。结果写到 `/tmp/review-w00039-t02-design/report-D.txt`（分段追加；写不成就放进最终回复）。用中文写。
