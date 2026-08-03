# Skill

Skill 是一张**可复用的工作流程卡**：告诉 Agent 某一类任务该怎么做。

它不是工具，也不是脚本。Agent 在 `SkillCatalog` 里看到有哪些 Skill 可用，需要时用 `read` 打开对应的 `SKILL.md` 读流程——**所以 Skill 始终是你能打开看的 Markdown，不是不可见的黑箱**。

## 内置 Skill

### 写作流程（按顺序用）

| Skill | 做什么 |
| --- | --- |
| `novel-guide` | **总览路线图**。不确定现在该用哪个 skill 时先读它 |
| `novel-idea-exploration` | 灵感探索：题材、粗略剧情、模糊世界观的成形 |
| `novel-setup` | 项目搭建四阶段：项目初始化 → 世界书框架 → 角色设计 → World Engine 初始化 |
| `novel-writing` | 写作循环总控：剧情设计 → 拍板落库 → 正文 / 评审 / 修订。开局黄金三章是它的首轮特化 |
| `novel-writer-execution` | writer 收到任务后的详细执行手册 |

### 随时可用

| Skill | 做什么 |
| --- | --- |
| `novel-genre-research` | 题材与竞品分析，接榜单数据 |
| `novel-data` | 本地小说榜单与书籍详情查询，供题材分析取数 |
| `novel-technique-character-card-workshop` | 重量级角色塑造与人设整理 |
| `llmlint` | 文风检查与修复，见 [llmlint](/core/llmlint) |
| `stop-slop` | 写作时去除 AI 腔 |

### 导入工具

| Skill | 做什么 |
| --- | --- |
| `novel-import-silly-tavern-card` | SillyTavern 角色卡 / worldbook / 预设导入 |
| `novel-import-tomato-reference` | 外部小说 epub / 下载器产物导入 |

### 开发者向

| Skill | 做什么 |
| --- | --- |
| `profile-system-guide` | Harness、TSX profile、ProfileTurnPlan 的系统导览 |
| `tsx-profile-editing` | 编辑 TSX Profile，见 [从零写一个 Profile](/profile-tsx/authoring) |
| `skill-creator` / `skill-creator-zh` | 创建和维护 Skill 本身 |

### 历史

`RP模式` 服务于已下线的 RP 入口，保留但当前不可用。

## Skill 放在哪

Skill 按目录名寻址，目录名就是它的 id：

| 层 | 位置 |
| --- | --- |
| 系统内置 | 随 NeuroBook 分发 |
| 用户层 | Workspace Root 的 `.nbook/agent/skills/<id>/SKILL.md` |

用户层同名目录会整体覆盖系统内置的同名 Skill，不会逐个文件合并。

`SKILL.md` 用 frontmatter 声明 `name` 和 `description`——**description 决定 Agent 什么时候会想起用它**，所以要写清适用场景而不只是功能名。想让界面显示中文名，把 `name` 保持为英文小写 id，中文写进 `metadata.displayName`。

## 可执行 Skill

有些 Skill 带自己的 CLI（`llmlint` 就是），这类叫 runnable skill，有正式的包合同：`package.json` 的版本号是 SemVer 真相源，catalog 会输出版本和根路径。它们的 `node_modules` 不进入受管资产，首次使用时走依赖安装门。

## 可见 ≠ 可用

profile 可以用 `skills.include` 声明白名单。**catalog 里能看到不等于能用**——白名单在 prepare 层统一过滤。例如 `leader.assets` 的白名单只有 4 个资产编辑类 skill。

## Skill、Workflow、工具怎么分

| | 提供什么 | 什么时候用 |
| --- | --- | --- |
| **工具** | 一次原子能力 | 读文件、写切面、调子 agent |
| **Skill** | 知识与方法 | 「这类任务按什么步骤做、注意什么」 |
| **Workflow** | 确定的执行编排 | 步骤固定、需要并发 / 循环 / 状态图 |

不要为了打包一段说明文字去建 workflow，那是 Skill 的活。

## 继续阅读

- [Agent 工具](/agent/tools)
- [Workflow 与 Job](/agent/workflow)
- [Skill Package 合同](https://github.com/notnotype/neuro-book/blob/master/reference/agent/skill-package.md)
