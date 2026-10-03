# 认识你的小说工作台

这一节结束后，你会知道 NeuroBook 页面上的主要区域分别负责什么，并能判断一个任务应该交给编辑器、文件树、Plot 还是 Agent。

NeuroBook 更像一个小说 IDE，而不是单纯的聊天框。它把正文、设定、剧情结构和 Agent 协作放在同一个本地工作区里。你可以直接编辑文件，也可以让 Agent 按明确边界读取、整理和写入这些文件。

![NeuroBook 工作区](/images/首页-2-文件树展开.jpg)

如果你正在配置模型，先看 [快速开始中的四步配置图](/quick-start#配置-ai-模型)：每个操作都有独立的标注 PNG。

## 顶栏有什么

从左到右：

| 入口 | 作用 |
| --- | --- |
| **Bookshelf** | 书架，切换和新建项目 |
| **World** | [World Engine](/core/world-engine) 工作台，管会变的世界状态 |
| **Plot** | [剧情工坊](/core/plot-workbench)，两棵树 + 承诺账本 + 决策记录 |
| **Trace** | 请求追踪，看 Agent 每次调用模型的完整过程 |
| **Jobs** | 后台任务中心，徽标显示运行中的任务数 |
| **变更** | 文件变更收件箱，审查 Agent 改了什么 |
| **用户资产** | 管理 profile、Skill、模板 |
| 最右侧 | Agent 面板开关、账号菜单（设置入口在这里） |

窗口较窄时部分按钮会自动收起。

## 首页和项目

打开应用后，你首先要关注的是当前 Project Workspace。每一本书都是一个独立项目，通常位于 `workspace/{project}/`，里面会有 `lorebook/`、`manuscript/`、`world-engine/`、`agents/`、`manual/`、`reference/`、`upload/` 和 `.nbook/`。

你可以把 Project Workspace 理解成这本书的工作室：

- `project.yaml`：这本书的名字、简介和项目身份，由系统生成，通常不需要手动维护。
- `lorebook/`：稳定设定，像角色、地点、物品、势力和世界规则。
- `manuscript/`：正文草稿和章节。
- `world-engine/`：世界引擎配置（时间格式与主体模式）；会随剧情变化的状态由系统记录在这里的时间线中。
- `agents/`：各 profile 的项目专用上下文、跨 session 记忆和程序生成的推荐。
- `manual/`：面向读者/玩家的说明性材料，例如可选角色化身。
- `reference/`：外部素材、导入归档和低置信迁移材料。
- `upload/`：用户上传的原始文件。

## Markdown Studio

Markdown Studio 是正文和设定的主要编辑区。NeuroBook 把 Markdown 文件作为长期真相，同时提供更接近写作软件的富文本编辑体验。

你可以在这里写章节正文，也可以修改世界书条目。源码模式适合精确处理 Markdown、frontmatter 和引用；富文本模式适合专心写作。

## 文件树

文件树让你看到 Project Workspace 的真实目录。和许多只把内容藏在数据库里的工具不同，NeuroBook 鼓励你理解文件结构，因为 Agent 也会按这些路径读写内容。

写作时最常看的目录是：

- `lorebook/`：设定说明书。
- `manuscript/`：章节正文。
- `world-engine/`：动态世界状态与时间线，通常通过和 Agent 对话查询，而不是直接看文件——文件本身只是 calendar 与 schema 配置。

## Plot 剧情工坊

顶栏 **Plot** 按钮打开剧情工坊。它管长期剧情结构，不是动态世界状态的真相源，也不替代正文和世界书。

它用**两棵树**分开两件事：承载树管故事在哪里讲（卷 → 章 → 正文），因果树管故事为什么发生（阶段 → 剧情线 → 场景）。两棵树在"场景属于哪一章"上交汇，所以倒叙、插叙和多线可以随便排而因果链不乱。

工坊里还有两个账本：**承诺账本**把每个伏笔当作对读者的欠债来记账（埋下 / 推进 / 兑现），**决策记录**存档你为什么做出某个创作决定。完整说明见 [Plot 剧情工坊](/core/plot-workbench)。

写作主链是：剧情设计 → 用户确认后推进 World Engine（把确认的动态事实写入时间线）→ 更新 Plot（Thread / Scene / Chapter）→ 调用 writer 写正文。当你准备写正式章节时，最好先让 Agent 走完这条链，而不是直接跳去调用 writer。

## Agent 抽屉

Agent 抽屉是你和 AI 协作的入口。你可以让 leader 理解你的意图、调用 Skill、检索设定、创建 linked agent，或者把章节写作任务交给 writer。

几个常见概念先记住直觉就够了：

- Agent：一次可持续协作的 AI 工作单元。
- session：和某个 Agent 的一条对话 / 工作记录。
- profile：定义 Agent 的角色、工具权限和提示词边界。
- Skill：一张可复用的工作流程卡，教 Agent 怎么完成某类任务。
- World Engine：动态世界状态和时间线的真相源。你只管讲故事，Agent 会帮你把确认的事实记进时间线。你可以直接问"某角色现在什么状态""两百年前这里什么样"，不需要理解它背后的实现。

下一节会用这些概念创建第一本书。
