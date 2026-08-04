# AGENTS.md

面向人类贡献者的开发入口、Issue/PR 流程和 Task 责任边界见 [`CONTRIBUTING.md`](CONTRIBUTING.md)；本文件继续作为开发 Agent 和仓库实现细则的权威来源。

## Core Rules

- 使用 *中文* 为默认语言与用户交互
- 安装新依赖时，使用 bun 安装最新版本的依赖
- 当前是沙盒环境，执行 bun 命令时，提权在沙盒外执行
- **学会在需求和实现复杂度之间妥协：当你制定计划、需求、审查用户需求或者设计系统的时候，多进行一步思考：这个需求是否很冷门？如果对需求进行妥协是否能大幅度降低复杂度？**
- 执行命令时注意 PowerShell 路径转义
- 如果遇到性能与复杂度权衡问题，报告、解释、给出你的建议、交给用户做最终决定
- **Bug 诊断流程**：当用户要求排查、诊断、debug 报错或性能回归时，参考 `$diagnose`；先阅读相关上下文并定位可能原因，再用最小测试、脚本、请求或日志尝试复现并确认症状。不要直接修改业务代码修复；诊断完成后先给出报告，说明现象、复现结果、根因判断、影响范围和建议修复方案，等待用户确认后再进入实现。若无法复现，报告已尝试路径和下一步需要的信息。
- 没有收到用户明确的指令，永远不要擅自改代码、文件。优先做只读调研、讨论、分析
- 任务完成后不要主动运行 git 命令查看变更
- **Important: 单点、少量、需要判断的修改一律用文件编辑工具，不要用 shell 绕过。** 例外是**大范围机械替换**（同一个确定的模式改多个文件、批量改名、批量调整 import 路径等）：这种情况推荐用 shell 或 codeact（python / js 脚本）批处理，比逐个编辑更可靠。但必须满足两条：
  1. **先 dry run**：先只输出「会改哪些文件、每处改成什么」，确认命中范围和改动内容都符合预期，再实际写入。
  2. **有把握**才批处理。只要模式不确定、需要逐处判断上下文、或者 dry run 结果里出现意料之外的命中，立刻停手改回逐个编辑。

  批处理完成后要报告实际改了哪些文件，不要只说「已统一」。
- **不要自动进行浏览器验证，你可以建议用户让你进行浏览器验证**
- **代码审查报告使用直白的话语再解释一次**
- 任务完成后的 walkthrough 要报告实际结果与任务计划的出入
- **Important: 目前项目已经很大了，所以在开始任务前，你可以读取相关文档和相关的 tasks**
- 代码修复、代码重构设计的时候需要考虑这些问题：
  1. 这个修复或者重构是否系统性？还是说本次修复是 hack？
  2. 这次修复或重构，能否在代码设计上约束 Agent 以后不会犯这种错误？
  3. 本次重构或修复会导致那些测试出问题？哪些测试没用了考虑删除。哪些应该修改优化？
- 任务结束后记得报告并清理用户不知情的临时文件（例如 ~/some-files）
- 进行提示词工程的时候不要把当前对话用户提到的要求带进提示词中，也不要假定对方拥有和你一样的知识（上下文）

## Git 工作流

维护者（用户 + 开发 Agent）的协作模式：GitHub Issue 承载需求与 TODO，分支 + worktree 承载开发，squash PR 合并进 `master`。外部贡献者的 Issue/PR 流程见 `CONTRIBUTING.md`，本节不重复。

### 分支命名

格式：`{type}/{refs}-{slug}`

- `type` ∈ `feat` / `fix` / `docs` / `refactor` / `test` / `chore`（对齐 Conventional Commit）。
- `refs`：`t{task号}` 或 `i{issue号}`；同时关联时 issue 在前：`i{issue号}-t{task号}`。
- `slug`：英文 kebab-case，不超过 5 个单词。
- 示例：`feat/t135-agent-asset-install`、`fix/i18-we-sibling-deref`、`feat/i14-t133-style-distill`。
- 每个代码分支必须能追溯到至少一个 issue 或 task；不再使用 `codex/*` 这类 agent 前缀（agent 会更换，前缀与任务追溯无关）。

### 开发循环

1. 想法 / bug / 需求先开 GitHub Issue（`type:*` + `status:*` 标签）；维护者用 `gh issue create` 直接开即可，不必走 Issue Form（表单面向外部贡献者）。`PROJECT-STATUS.md` 不再新增 TODO 清单。
2. 重大任务继续按 `docs/tasks/README.md` 建任务目录：issue 是需求层，task 是文档层，两者互补不替代。
3. 开工前 `git fetch origin`，然后 `git worktree add .agent/workspace/wt/<slug> -b <branch> origin/master`（worktree 固定在 `wt/` 子目录，与临时文件区分；存量 worktree 不迁移）。新 worktree 没有 `node_modules`，首次使用前必须 `bun install`。
4. 在 worktree 内开发；完成后 push 分支并 `gh pr create`。PR 完整覆盖 issue 时正文用 `Closes #N`（merge 会自动关闭 issue）；只覆盖一部分时用 `Refs #N`，避免 issue 被提前关闭。
5. **到此停下，向用户报告验证结果与 PR 链接。Agent 不得自行合并 PR、关闭 issue 或做其它收尾动作。** Agent 可以自审或跑代码审查并把结论附在报告里，但「审查完成」的判定与收尾许可都来自用户；浏览器验收同样由用户执行或授权。
6. 收尾（仅在用户许可后，一次做完）：确认 CI 通过且本地验证（typecheck + 相关聚焦测试）通过（现状 CI 没有 required check，见 issue #15，本地验证是实际门禁）→ `gh pr merge --squash --delete-branch`（squash 提交信息 = PR 标题，Conventional Commit 格式）→ issue 应随 `Closes` 自动关闭，未关闭时手动 `gh issue close` 并留言说明 → 主工作区立刻 `git fetch && git merge --ff-only origin/master`（有在途改动先提交或 stash）→ `git worktree remove .agent/workspace/wt/<slug>` 并 `git branch -D <branch>`（`--delete-branch` 删不掉仍被 worktree 占用的本地分支，不手动清理会残留）。收尾链任一步失败时报告断点，从断点继续，不要重头执行（已完成的步骤如 merge 不可重复）。
7. 远端 `master` 被任何 worktree 或 agent 更新后（不限于自己的收尾），主工作区必须立刻 `git fetch && git merge --ff-only origin/master`，防止主工作区停在旧提交产生分叉。
8. Windows 上 `node_modules` 深路径可能让 `git worktree remove` 报 `Filename too long`：先 `git config core.longpaths true` 重试；注册已清除但目录残留时，在 PowerShell 里用 robocopy 镜像空目录清掉（Git Bash 会把 `/MIR` 误转成路径）。

### Agent 创建 Issue 约定

- 必须打 `source: agent` 标签（另加常规 `type:*` / `status:*`），便于区分机器起草与人工报告。
- 标题说清「什么东西要变成什么样」，不堆内部类名、文件名、函数名。
- 正文结构（对齐 ADR 的背景 → 决策 → 后果习惯）：
  1. **一句人话概述**：没看过会话、没读过代码的人，也能看懂这个 issue 要让什么变成什么样。
  2. **背景**：为什么现在提。给足上下文，不假设读者拥有你的会话记忆。
  3. **内容 / 方案**：要做什么。内部标识符（文件路径、函数名、合同名）放这一段，并给出上下文。
  4. **验收 / 证据**：怎么算完成。
- Task 引用一律用完整链接，不裸写编号。
- 不复制会话原话：用户随口说的要求必须改写为面向读者的陈述。
- Issue 是公开页面，正文同时遵循「面向用户的语言风格」中适用的部分（不出现无上下文的内部名词）。

### master 纪律

- `master` 是用户测试基线，始终保持可构建、可测试状态；代码改动一律走分支 + squash PR。
- 文档类例外可直推 master：typo、`PROJECT-STATUS.md` / task walkthrough 更新、`RELEASE.md` 维护、release 脚本的版本提交。
- 测试反馈小修复例外可直推 master：用户在 master 上测试（含浏览器验收）发现的问题，修复**同时**满足以下全部条件时可就地修复直推，任一不满足回完整流程（issue + 分支 + PR）：
  1. 单文件、改动约 ≤ 30 行；
  2. 不动架构 / 数据合同 / Prisma schema；
  3. 不引入新依赖。
  约束：验证不跳过（至少 typecheck + 相关聚焦测试）；可不开 issue，但 commit message 必须注明问题现象与来源（如 `fix: 修复章节名不刷新（#55 浏览器验收发现）`）；agent 就地修复前先向用户确认「简单」判定与主工作区状态（用户可能正跑着 dev 或有未提交改动）。
- 上述纪律是约定层面，不配 GitHub ruleset / required check（质量门禁见 issue #15）。
- 不 force push `master`；远端拒绝就停下报告。

### 多 Agent 并行

- 一个 agent 对应一个独立 worktree + 分支；不共享 worktree，不在同一 worktree 里同时跑两个 agent。
- 跨模块合同、冲突、文档和最终验证由主工作区统一集成（对齐 `CONTRIBUTING.md` 的集成负责人规则）。

## 文档索引

- `PROJECT-STATUS.md`：仓库级现状、当前重点、模块状态、风险和近期任务。TODO / 跟进事项记录为 GitHub Issue，不写进该文件。
- `docs/README.md`：文档体系入口，说明 `docs/` 目录分工。
- `reference/README.md`：NeuroBook Reference Bookshelf，按模块链接到 `reference/<module>/`。
- `reference/world-engine/README.md`：World Engine 世界引擎 reference 入口。写作模式动态世界状态 + 时间线真相源；处理 slice / subject / instant / reduce / schema / Calendar / 记录原则 / leader-writer 协作时先读这里。
- `reference/workspace/TERMS.md`：Workspace Root、Workspace Root `.nbook`、Project Workspace、Project Workspace `.nbook`、user-assets、Bundled Workspace Template 的标准术语。涉及 workspace / project / user-assets / assets 覆盖时必须优先引用这里，不要把 Project Workspace 缩写成 workspace。
- `docs/modules`：模块文档索引，链接模块说明、需求整理和开发参考。在你直接查询 node_modules 前先看看这个文件，可能有 research 或者库的本地 git 仓库位置
- `docs/tasks/README.md`：重大任务 walkthrough 规则和维护要求。
- `docs/tasks/TEMPLATE.md`：新任务 walkthrough 模板。

## 文档规范

- `PROJECT-STATUS.md` 是仓库级现状报告。重大任务结束后，如果代码行为、架构决策或模块状态发生变化，必须同步更新该文件。TODO / 跟进事项一律开 GitHub Issue（见「Git 工作流」），不再写入该文件的 Known Follow-ups。
- `docs/tasks/<order>-<task-slug>/README.md` 是 active 重大任务的持续 walkthrough；归档任务在 `docs/tasks/archived/<task-slug>/README.md`。每个重大任务都应有一个任务目录，记录用户需求、目标、执行过程、关键决策、变更文件、验证结果和后续 TODO。task walkthrough 的 TODO / Follow-ups 只记本任务实现级跟进；跨任务或产品级跟进一律开 GitHub Issue。
- 同一功能后续调节时，继续更新原任务 walkthrough。例如新增“拆书功能”后，后续所有拆书功能调节都更新同一个 active 编号任务目录，不要每轮新建碎片文档。
- `reference/` 只放稳定参考和实现契约，按模块分组，例如 `reference/agent/`、`reference/content/`、`reference/editor/`、`reference/plot/`。
- `docs/` 放文档入口、模块说明、调研、草案、归档和任务 walkthrough。调研资料放 `docs/research/`，未定稿草案放 `docs/drafts/`，过期但仍有参考价值的内容放 `docs/archived/`。
- 移动文档或改名时，必须同步更新交叉链接，避免留下绝对路径链接和旧路径引用。
- 纯问答、只读探索、无状态变化的失败尝试，不强制更新 `PROJECT-STATUS.md` 或任务 walkthrough。

### 面向用户的语言风格

适用于所有用户会读到的文字：`RELEASE.md` 与 `docs/changelog/`、`README`、文档站页面、UI 文案、错误提示。**不适用**于 `PROJECT-STATUS.md`、`docs/tasks/**`、`reference/**` 和代码注释——那些是给开发者和 Agent 看的，该多技术就多技术。

读者假设：一个会用电脑、对写小说感兴趣、但从没读过本仓库任何一行代码的大学生。

- **写他能做什么，不写我们改了什么。** 「现在可以让 AI 一次写完一整章并自动检查」，不是「run_workflow 接入 AgentJobManager」。
- **不出现内部名词。** 模块名、类名、文件名、Task 编号、Phase 编号一律不写。确实要提某个界面，就用界面上的原字。
- **必须用的术语，当场一句话解释。** 「工作流（把「写正文 → 检查 → 修订」这种多步骤活儿打包成一条命令）」。同一篇里解释一次就够。
- **给前后对比。** 「以前设了 30 秒超时也可能跑满 5 分钟，现在到点真的会停」比「修复超时不生效」有用得多。
- **每条 1–2 句，动词开头。** 写不下就说明这条该拆成两条，或者根本不该进更新日志。
- **能用日常词就别用专有名词**：「后台任务」别写「job」，「界面」别写「UI」，「装到本地」别写「部署」。
- **回退和限制要如实写。** 砍掉的功能、需要手动操作的步骤、还没验证的部分，一律照直说，不藏进「优化」里。
- **别夸。** 不写「大幅提升」「全新体验」「强大」。有数字就给数字，没数字就描述现象。

`RELEASE.md` 的固定结构：

```markdown
## <版本> - <日期>

一段话说清这个版本主要解决了什么问题，两三句即可。

### 新功能
### 改进
### 修复
### 升级须知
```

四个小节按需出现，没内容就整节删掉，不要留空标题。`### 升级须知` 只写用户真的要动手做的事（备份、换目录、改配置），没有就不写。

`RELEASE.md` 只保留当前版本；历史版本按发布线归档到 `docs/changelog/`（中文）与 `docs/en/changelog/`（英文镜像），文件开头留一行指向那里。

### JS/TS

- 不要使用相对路径导入，使用 `import {Sessions} from "nb/types/session"`
- async 函数优先：尽量避免回调函数。try catch 优先。尽量避免 Promise API
- 日志使用规范：this.logger.debug({ kind: message.kind }, "自然语言描述，不要用 tui.adapter.emit");
- **Important：目前项目处于快速开发阶段，可以直接激进地修改本项目代码，不需要对老代码做兼容。数据库结构、数据可以随意变更，不用兼容。永远不要出现 legacy**
- 有时候 throw 比 try catch 更好
- 后端代码（gateway、runtime 等需要高领域表达力的）推荐使用 class 模式，前端代码 web/ 下推荐使用 Functional Programming 模式
- 代码多使用中文注释。设计接口和类时，要为接口和每一个函数写规范
- 多使用注释，函数必须添加注释
- 不要过度设计。先尝试在现有组件基础上修改，实在不行才建立新组件。
- **不要过度创建函数，如果某处逻辑只有一处复用的地方，不要抽函数，优先 inline**
- 实现需求时先考虑使用第三方库
- 先查看 package.json，是否有些需求能用现有库
- getter/setter is better then getXXX/setXXX
- 命名推荐：名字尽量不超过 5 个单词。同时不要有这种名字：`getMessagesByChannel(channelKey: string)`，因为 ByChannel 的含义已经在参数中包涵了
- 当使用 optional 属性（例如 { result:? string }）时，使用注释标注何时为空、非空表示什么
- Important: 当你编写代码的时候遇到项目设计等问题，不要用 hack 绕过问题、制造技术债、破坏类型系统。立刻终止任务，并告知用户问题
- 不要一次性应用 800 行以上的超大补丁（防止出错）。可以考虑拆分多次进行应用（例如按照脚本逻辑 script、模板 template、样式 style）。或者提醒用户规划拆分为多个文件。但是要注意：强耦合，高相关的逻辑还是可以放在一个文件内的。（不要为了为拆而拆）
- 简单逻辑不要主动写测试文件，复杂逻辑需要写测试
- 只有在复杂、大型功能编写后才运行测试。简单的小功能不要主动测试。不要过度测试，只在最常用，最复杂，最容易犯错的地方加测试即可
- 类型覆盖非常重要，你设计的每一个组件都尽可能地标注类型。不要用 Record<string, unknown>，unknown，any 这些类型。如果特殊情况（外部未知数据用 unknown，无法表达或主动绕过类型系统时才用 any。）使用 any/unknown 请在代码旁边写明原因，如果你使用了 any，需要提出系统设计是否有问题。

### HTML/Vue

- HTML 容器附近使用注释标注，以便后续修改时能快速指认位置
- 组件化：为了防止出现 800 行以上的大型单文件组件。编写代码时考虑拆分组件。
- 通用组件路径：app/components/common
- 通用组件索引：
  - app/components/common/NotificationViewport.vue
  - app/components/common/Dialog.vue
  - app/components/common/DialogWindow.vue（非模态浮动窗口：无遮罩、标题栏拖动、毛玻璃；模态确认继续用 Dialog）
  - app/components/common/form/FormColorField.vue（取色字段：色块弹层调色盘 + 原生 EyeDropper 吸管）
- Novel IDE 颜色一律消费 `app/utils/theme/README.md` 登记的 CSS 主题变量，禁止新增 Tailwind 调色板类（如 `bg-gray-*`、`text-amber-*`、`border-rose-*`）和 `dark:` 变体；明暗差异由当前主题变量承载。
- 状态语义映射口诀：草稿/待审/未保存/占位用 `warning`，完成/已同步用 `success`，错误/删除/冲突用 `danger`，运行中/引用/说明用 `info`，选中/当前项/主操作用 `accent`。
- World Engine `--we-*` 仍是局部别名层，唯一映射源在 `app/styles/theme-vars.css` 的 `.world-engine-workbench-theme`；真实 Dialog 与 preview 必须挂这个 class，不要在 preview 或 scoped style 中反向覆盖全局主题变量。
- Plot / Workspace / Reference chip 分类色板是类别识别色例外，不迁移为状态色；`ReferenceChip.vue` 只输出 `is-chapter` / `is-character` 等语义 class，chip 外观统一在 `app/styles/reference-chips.css`，不要在 TipTap 或业务组件里重复写色。
- Profile template 节点类型 accent、Markdown 正文颜色选择器、JsonViewer/Monaco 语法色属于内容/第三方编辑器色板例外；只清理它们周边普通 UI 的状态色、阴影和文本色。
- 新增组件层主题变量前必须先确认无法用背景/文本/边框/强调/状态/编辑器变量表达，并同步登记到 `app/utils/theme/README.md`、`reference/theme/system.md` 与 8 套内置主题。
- 前端 API 错误文案统一使用 `app/utils/api-error.ts` 的 `resolveApiErrorMessage(error, fallback)` 解析，不要在业务组件里重复解析 `$fetch` 错误结构。
- **前端通知途径规范**（详见 `docs/frontend-notification-channels.md`）：
  - **全局通知 `useNotification()`**：跨入口操作、后台动作（自动保存、Agent 运行）、即时反馈（复制、粘贴、文件操作）、成功提示。使用 `notification.success()` / `error()` / `warning()` / `info()`，配合 `resolveApiErrorMessage()` 解析错误。
  - **局部 error state (`const error = ref("")`)**：当前 Dialog/Panel 内可恢复的表单或加载错误，需要持续展示直到用户修正。
  - **决策标准**：如果操作完成后 Dialog 会关闭，或错误可能在其它入口不可见，使用 `useNotification()`；如果错误需要和当前表单字段关联展示，使用局部 error state。
- 如果同一业务函数会被多个入口复用，必须在函数内按调用入口显式选择错误出口，或拆成入口级 wrapper，避免隐藏宿主、Dialog、侧边栏之间错误不可见。
- 可拖拽调整尺寸的面板统一使用 `app/composables/useResizablePanel.ts`；不要在组件里重复手写 `mousemove` / `mouseup` / pointer 监听。尺寸状态放在宿主或 store，组件只通过 `update:width` / `update:height` 回传。

## Coding Style

- JS/TS 代码缩进 4 空格，遵循现有代码格式风格
- HTML 标签尽量保持一行，开闭标签尽量保持在一行

## subagents

- 如果不是困难的任务，例如探索代码，调研等。不要使用 fable 作为模型

## 信息、文档获取

- 可读取 node_modules 下的源代码
- 可以使用 get_file_contents、search_code、issue_read 搜寻 github 项目
- .agent/workspace 为你可随意操作的目录（.agent 目录不是），你可以再此编写临时文件、clone 代码等
- 可以通过编写测试脚本并运行来测试数据
- 如果要写 commit message 的时候，可以从 docs/tasks PROJECT-STATUS.md 获取信息，查看他们的最新变更。提交信息要丰富，覆盖所有相关 tasks。重点关心新功能

## 发布流程

- 发布前先阅读 `PROJECT-STATUS.md` 和相关 `docs/tasks/**/README.md` / walkthrough，确认本轮改动、验证记录和任务状态。
- 发布前必须更新 `RELEASE.md`，严格按「面向用户的语言风格」小节写：只留当前版本，历史版本移到 `docs/changelog/` 并同步英文镜像 `docs/en/changelog/`。prerelease 的 GitHub Release note 自动读取 `RELEASE.md` 当前版本段落（`## <版本> - <日期>` 起至文末）作为正文，缺失或为空时回退到通用模板并打印警告——写不好会直接出现在每个 canary release 页面上。
- 提交前用 `git status --short --branch` 确认工作区范围；用户明确要求“提交全部改动”时，才使用 `git add -A` 纳入全部 tracked / untracked 改动。
- 任何 worktree 或 agent 向远端 `master` 推送或合并后，主工作区必须立刻 `git fetch && git merge --ff-only origin/master`（分支与 worktree 约定见「Git 工作流」）。否则主工作区的 `master` 永远停在旧提交，下次提交就变成分叉；同一份改动也不要在主工作区和 worktree 各提交一次，那会产出 patch-id 相同、SHA 不同的重复提交。
- 业务提交 message 要覆盖主要任务和用户可见能力。代码改动走分支 + squash PR（见「Git 工作流」）；`git push origin HEAD:master` 仅限文档类例外与 release 提交。如果远端拒绝，停止并报告，不要 force push。
- canary patch 发布使用 `bun run release -- canary --next patch --push --yes --no-watch`；canary minor 发布使用 `bun run release -- canary --next minor --push --yes --no-watch`。
- release 脚本会自动更新 `package.json.version`、创建 `chore(release): v...` 提交、push 当前分支并创建 GitHub prerelease。
- 不要等待或盯 GitHub Actions release workflow；发布命令必须带 `--no-watch`。创建 GitHub Release 成功后，报告 release tag / URL，并说明 Actions 后台自行运行。
- 如果 release 命令被中断，先检查 `git status --short --branch`、`git log --oneline -5`、`package.json.version`，再用 `gh release view <tag> --repo notnotype/neuro-book` 判断版本提交和 GitHub Release 是否已经完成，避免重复发布。

## 子项目索引（sibling 仓库）

NeuroBook 的部分功能模块独立成 sibling 仓库开发（位置均为主仓同级目录 `../<name>`），主仓以 vendor 快照、同步脚本或 goal 封装消费。**改这些模块一律去对应 sibling 仓，不在主仓内开发；主仓只更新快照 / 同步，也不要在主仓的快照目录内执行 sibling 仓的 git 操作。** sibling 仓改动落盘后，其 `goal:check` / `test` / `build` 属于该仓侧的真实验证，必须如实报告结果；在 sibling 仓执行 `push` / `remote` 操作前先 `git remote -v` 确认当前仓库，不 force push。

| 仓库 | 内容 | 与主仓的关系 |
| --- | --- | --- |
| llmlint | lint 规则开发仓（github.com/notnotype/llmlint，AGPL-3.0）；仓库根为开发工作区，可安装 skill package 固定在 `skill/` | 主仓 `assets/workspace/.nbook/agent/skills/llmlint/` 是 `../llmlint/skill` 的 vendored runtime snapshot；从 llmlint 根 `bun run sync:neuro-book` 或主仓 `bun scripts/cli/sync-llmlint-skill.ts` 同步，再跑 `sync-user-assets.ts` 更新 user runtime 副本（只镜像 `skill/`，排除 `.git`、`node_modules`、`evals`、`tests` 等） |
| nb-memory | 记忆框架（Task 113 产物，TS/Bun 零依赖、port 注入） | agent memory goal（`bun run agent-memory-*`）在该仓执行 |
| nb-history | workspace 操作日志与文件历史（append-only 事件溯源 + 内容寻址快照） | 主仓 `bun run sync:nb-history` 同步 |
| nb-workflow | Agent Workflow 编排 spike（Task 110） | 主仓 `bun run sync:nb-workflow` 同步 |
| neuro-agent-harness | 多宿主 Agent Harness（Profile、Run Kernel、Session、approval、compaction） | 上游真相源；主仓 `server/agent/harness/` 为快照 |
| nb-ui | NeuroBook 系项目共享 Vue/Nuxt UI 组件库 | 供派生项目使用；主仓未迁移 import |
| nb-fullstack-template | 全栈项目模板 | neuro-book-site 等 sibling 项目从它派生 |
| neuro-book-site | 官方站：账号关联、创意工坊、客户端加密云备份 | 独立部署（owner-only 私有内测），与主仓是产品配套关系 |

- llmlint 的 README 为中英双语双文件：仓库根与 `skill/` 两层，改安装或运行方式时两层都同步。
- NeuroBook 侧验证 vendor 快照的最小方式是 import smoke，例如 `bun -e "import './llmlint/llmlint.ts'; console.log('ok')"`。
