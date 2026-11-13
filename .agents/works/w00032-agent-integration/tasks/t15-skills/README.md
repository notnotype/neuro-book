---
schema: nbook.task/v2
taskId: t15-skills
status: active
updated: 2026-11-13
---

# Skill 规范与目录

## 目标与范围

定产品 Skill 的格式与目录层次、带 package.json 与脚本的 Skill 怎样装依赖（bun、uv），以及加载与触发方式。

来源：需求 13（[报告](../t01-survey/artifacts/report/index.html)）。

合同：本 Task 只做设计讨论，行为合同未变；定稿后在计划里写明改哪些 Spec。

## 要讨论的问题

- 格式：`SKILL.md` 加 frontmatter（name、description 必填）。
- 目录层次：内置、用户、项目、插件贡献；要不要兼容读 `~/.claude/skills`、`~/.agents/skills`。
- 带 package.json 与脚本的 Skill：bun 的依赖什么时候装、装在哪；uv 用脚本内联依赖。
- 加载与触发：目录列出、`$` 触发、`skill://`。
- 信任：按现有约定默认信任作者。

## 材料

- [外部参照](../../../../../docs/research/agent-runtime-references.md)第 3、5、6 节
- [`story/cli-skill.md`](../../../../../docs/specs/story/cli-skill.md)
- 旧应用 `packages/neuro-book-legacy/assets/reference/agent/skill-package.md`

## 前置

t05、t08、t10。

## 决定

第一轮（开发者 2026-10-30）：

1. 用户用 `$` 触发 Skill（旧应用的做法），不只靠 `/`。

第二轮（开发者 2026-10-30）：

2. Skill 参数、“带参数调用就自动执行脚本”（Claude Code 的 `` !`命令` ``）先不做，以后再考虑。
3. 字段：收 Agent Skills 标准的 6 个字段，标准之外只收一个 `when_to_use`，正式写法改为连字符 `when-to-use`，读取时也认 `when_to_use`（`allowed-tools` 只解析、不生效，放行走 t06）。其余扩展字段都不收，第一版所有 Skill 的表现固定为：模型不能自己启用（相当于 `disable-model-invocation: true`，说明不进提示词）、用户能用 `$` 触发（`user-invocable: true`）、不隐藏；没有参数，不做 `paths`/`globs`、`context: fork`、`model`、`hooks`。Profile 的 Skill 白名单只决定在这个 Profile 里能 `$` 哪些 Skill（t14 第 16 条“推荐的 Skill 进提示词”第一版用不上）。
4. 依赖第一版只支持 Bun（`package.json` 加 `bun.lock`）；Python（uv、虚拟环境）与系统程序只检测、只报告，不代替用户安装，用户可以让 Agent 帮忙装，以后有需要再说。
5. 应用自己判断 Skill 是否初始化好；`nbook` 命令行提供初始化命令，Agent 也能经命令行初始化，与用户在界面上初始化是同一件事；Agent 不主动初始化，只在用户要求时做。
6. 更新与市场参照 Claude Code 的插件市场，另开 [t25](../t25-plugin-marketplace/README.md) 讨论。

第三轮（开发者 2026-10-30）：

7. 插件里的 Skill 在构建时带齐依赖：插件 SDK 的构建预设（`nbooke build`）把插件里每个 Skill 的脚本连同用到的 npm 包各打成一个单文件（`bun build --target bun`），装好就能用、不用初始化；打不进单文件的（原生模块、运行时读包内数据文件、Python 脚本）构建失败并说明原因。内置 Skill 用同一套。要改插件 SDK 的构建预设（记进 [t10](../t10-agent-plugin/README.md)）。
8. 初始化标记：`node_modules/.nbook-skill-deps.json`，记 `schema`、`runtime`、`inputs`（`package.json` 中影响安装的字段加 `bun.lock` 的哈希）、`platform`、`bun` 版本、安装时间，失败时记 `error`；与 `node_modules` 同生共死，不放在 Skill 源目录。以后支持 uv 时，标记放状态根按 Skill 分文件，判断就绪时再实际试一次。
9. 最小的安装单位是插件：有版本、能更新、能上架的只有插件，市场是插件市场（[t25](../t25-plugin-marketplace/README.md)），像 VS Code 的主题也是插件一样。Skill 的来源：内置、插件贡献、`user://skills/`（自己写的，或从文件夹、zip 复制进来的，不记来源、不更新）。单个 Skill 要上架，就包成只含 Skill 的插件。

第四轮（开发者 2026-10-30）：

10. 不支持“额外的 Skill 目录”（改 t08“另定的两条”）；来源只有内置、插件、`user://skills/` 三种。
11. `$` 触发的 Skill 作为这一轮的附带内容进对话，排在用户的话前面（t20 的位置章）；压缩之后放回最近用过的 Skill 正文，每个前 5,000 token、合计 25,000（照 Claude Code）。
12. `$` 菜单列当前 Profile 白名单里的 Skill，未就绪的标出状态。
13. id 带来源前缀（`builtin.`、插件 id、`user.`），不做同名覆盖；`$` 菜单显示 `name`，重名时显示 id。
14. 坏掉的 Skill（frontmatter 解析不了、`name` 与目录名对不上）只隔离它一个并写诊断。
15. 改动何时生效：Skill 正文改了，下一次 `$` 或压缩后放回时读到新内容；已经发出去的轮不变（日志是事实）。Skill 目录（catalog）变了要让会话知道：参照 Claude Code 的“又有哪些 Skill 可用”的提醒，但第一版不实时提醒，等压缩时随稳定槽重新生成。第一版 Skill 的说明不进提示词（第 3 条），所以这条在模型能自己启用 Skill 之后才起作用；界面的 `$` 菜单随时是最新的。

第五轮（开发者 2026-10-30）：

16. `user://skills/` 的初始化：应用按标记判断状态；入口是设置里 Skill 页的“初始化”、`$` 未就绪的 Skill 时的询问、命令行 `nbook skill init <id>`（`--yes` 跳过确认），三者做同一件事；开始前列出要装多少个包、要联网；用应用自带的 Bun 在 Skill 目录里执行 `bun install --frozen-lockfile --ignore-scripts`，同一个 Skill 同一时间只跑一个；成功写标记，失败把原因写进标记的 `error`。只有 `package.json`、没有 `bun.lock` 时也允许初始化：明确告诉用户“将按最新版本解析依赖并生成锁文件”，生成之后都按锁安装。

第六轮（开发者 2026-11-10，看实施计划之后）：

17. Profile 没声明 Skill 白名单时没有可用的 Skill；主创声明“全部”，放进 `user://skills/` 的马上能 `$`；临时帮手不声明。用户在 Profile 设置页按 Profile 去掉或加上。
18. 父 Agent 发给子代理的话里有 `$x` 也算触发，不特殊处理（只要在子会话 Profile 的白名单里）。
19. `nbook skill init` 不要求应用在运行：命令行直接调用同一个初始化模块，用 Skill 目录里的锁文件挡住与应用同时装，应用经监视看到结果。
20. 插件的 Skill（贡献点 `agent.skills`）与插件 SDK 的构建（第 7 条）拆到 [t33](../t33-plugin-skills/README.md)；本 Task 的目录服务按来源设计，接上只多一个来源。
21. 先出一轮界面静态稿（Skill 页、`$` 菜单的状态、初始化确认、用户消息上的 Skill、Profile 页的 Skill 一节），定了再写界面；后端几片与评审并行。

第七轮（开发者 2026-11-10，界面的注意力排序；计划设计审查之后的四处改动也同意）：

22. 设置里的 Skill 页：按来源分组（我的在前、内置在后）；每行先看名字，紧跟状态（只在不是“可用”时出现：未初始化、正在初始化、坏了），说明一行截断；“初始化”只在要初始化时出现，“打开”常在；坏的行第二行直接写原因；许可、兼容性、`metadata`、外部依赖、目录位置收在行展开里；页头只有“打开 Skill 文件夹”，没有 Skill 时写一句怎样放进来。
23. `$` 菜单：名字在前、说明一行，未初始化的在右边标出；最近用过的在前，其余按名字；坏的不列（去 Skill 页看）；白名单为空时写一句说明并带去设置的入口。
24. 选了未初始化的 Skill：确认框先看要装几个包、要联网，没有锁时才多一句“会生成锁文件”；装的时候只显示“正在安装…”，输出的最后几行收起；失败写原因并能重试；完成或失败都把标签插进去。
25. 用户消息上的 Skill：带上了的不另显示（`$` 标签就是证据）；没带上的才在标签上标出、消息下面一行写原因。
26. Profile 页的“Skill”一节：与工具、可派的子代理两节同样式，放在它们下面；声明“全部”的列出目录里的全部 Skill，每个能去掉，去掉的收在最后一组“已去掉”，能加回来。

第八轮（开发者 2026-11-11，评审板第 1 轮）：

27. Skill 页：同一列表里的状态徽标与按钮每行落在同一列（整个列表共用的列），不紧跟长短不一的名字；状态用规范说法，“坏了”改为“无效”。对齐与“换状态不变尺寸”写进 [nb-ui 开发规范](../../../../../packages/nb-ui/docs/ui-development-spec.md)的“几何、排版与动效”与自检清单；口语的规范原本就有，补了“坏了”这个例子。
28. `$` 菜单：未初始化、正在初始化用徽标标出，与 Skill 页同一种（选 B）。nb-ui 的建议菜单要加一个项尾徽标字段；同一级有一项带徽标，每行都留出这一列。
29. 确认框：确认、正在安装、失败几种状态下尺寸不变，按内容最多的那种定尺寸，输出放在固定高度的区域里。“先不初始化”也把标签插进输入框，开发者没有异议，照做。
30. 装的时候能关掉确认框，在后台继续装（选 A）。开发者备注：和 VS Code 一样，可能要引入一个后台任务系统；怎样显示进度与结果，第 2 轮定。
31. 用户消息：不要消息下面那一行带三角形图标的提示；没带上的 Skill 原因改放在哪里，第 2 轮定。标签的悬停提示从“技能：…”统一为“Skill：…”，开发者没有异议，照做。
32. Profile 页的“Skill”一节照草稿做。

第九轮（开发者 2026-11-11，评审板第 2 轮）：

33. 后台安装的进度与结果（选 B）：先另开一个 Task 做通用的后台任务系统（类似 VS Code 的进度服务加通知中心），t15 的界面几片等它；不用临时的进度通知顶上。
34. Skill 页：整页共用的几列，照第 2 轮的草稿做。
35. `$` 菜单的徽标列：右边空白太多，要改；第 3 轮出候选。
36. 确认框：尺寸对了，但一个组件的几种状态之间区别不要太大：没有锁时多出的黄字挤小了“直接依赖”那块，不行；“标签已经插进输入框”这类话不放在确认框里。这条原则写进 nb-ui 开发规范，也写进 Skill 的 Spec；第 3 轮出改过的稿。
37. 没带上的 Skill 界面上不提示（标签不改样子、不加悬停原因）；改为给模型一条 system-reminder，排在用户的话前面，写明哪些 `$` 没带上、为什么。改了第 25、31 条。

第十轮（开发者 2026-11-11，评审板第 3 轮）：

38. `$` 菜单的状态改用图标：每行留一列图标列（未初始化、正在初始化各一个图标），悬停时看图标的意思；不用徽标。改了第 28、35 条；Skill 页仍用徽标、仍叫“正在初始化”。
39. 确认框照第 3 轮的稿：三块区域（一行状态、中间一块、两行说明）位置与大小固定，没有锁的那句在说明行，失败的原因在说明行。

第十一轮（开发者 2026-11-13，收口审查之后）：

40. Skill 已有 `bun.lock`、之后手改 `package.json` 加了依赖时，按锁的安装失败，记为已知限制（方案 b）：用户在 Skill 文件夹里跑一次 `bun install` 或删掉 `bun.lock` 再初始化，应用与命令行不重新生成锁。写进 `agent/skills.md` 的已知限制。

审查改动（同意）：插话里的 `$x` 正文排在插话后面；放回合计不超过窗口 25%、Skill 用文件与计划剩下的；同一 Skill 没改过、上一份还在上下文里时只附“见前文”；代码里的 `$` 不认成 Skill（编辑器也不再显示成小块）。

先调研再定的：字段全表、Skill 参数与“带参数自动执行脚本”、依赖（Python、Node、Bun）、更新与 Skill 市场。调研：[各家的 Skill](../../research/2026-10-30-skill-survey.md)。

## 来自 t05 的事项（2026-11-07）

决定 12 的“当前 Profile 白名单”到现在没有字段（t05 第一轮否掉了 `skills.include`）。白名单的形状在 [t05 计划](../t05-profile/plan.md)的“给 t14、t15 留的”定了：Profile 声明缺省，用户在 `profileSettings` 里按 Profile 增删（`{added, removed}`，同工具绑定），设置页加一节。字段随本 Task 加。

## 当前状态

讨论完成（开发者 2026-10-30 确认）：五轮决定见上。2026-11-10 开工：实施计划 [`plan.md`](plan.md) 开发者确认（第六轮第 17–21 条）。2026-11-11：评审板第 1 轮答复记为第 27–32 条，第 2 轮已发布、等答复；Spec 已写：新建 [`agent/skills.md`](../../../../../docs/specs/agent/skills.md)（planned，界面部分等第 2 轮定了再补），相关 Spec 补了 planned 条目。

实施（分支 `feat/w00032-t15-skills`）2026-11-13 合入 master（`502e8f9ef`），切片 1–6 都已完成：

- 切片 1：`nb-markdown` 代码里的 `$` 不算技能、`${…}` 放宽，经纯 TS 子路径 `./prompt-text` 交出 `promptSkillTokens`（计划原定根入口，包的边界规定不允许，改了并记进计划）；技能小块悬停改为“Skill：”；`nbook.files` 的挂载点可另给容器与目录名；Skill 目录服务、`skills://`、远程 `skills` 与 `skillsChanged`。
- 切片 2（后端）：Profile 声明 `skills`、`profileSettings` 的 `skills`、白名单合成，主创声明全部。
- 切片 3：扩展 `nbook.agent.skills`（带上正文、见前文、`skillMissing`）；内核放回参数加 `kept`；压缩之后放回 Skill；压缩详情认 `skill`。
- 切片 4：初始化模块（应用的 Bun 按锁安装、文件锁、标记）、远程 `skillInitPlan` 与 `initSkill`、`nbook skill init`；nb-harness 公开 `./file-lock`。
- 切片 5（界面，按[计划的“切片 5 细化”](plan.md#切片-5-细化2026-11-13t34-合入之后)）：初始化接进后台任务（可取消、失败带输出能重试）、远程 `openSkillsFolder`；建议菜单行尾的状态图标与 `menu.selected`；`$` 菜单、确认框、点开 Skill 标签；设置里的 Skill 页；Profile 页的 Skill 一节；Lab 场景。
- 切片 6：e2e `agent-skills.e2e.ts`（场景 2、3、4 在界面上的部分）；收口实现审查，后端 Claude Opus 12 条、前端 Claude Sonnet 16 条，都没有阻断，处理见 [`evidences/impl-review-handling.txt`](evidences/impl-review-handling.txt)，修正提交 `9423f8783`，Spec 随之改写（`be932fdf5`）。

验证：受影响的单元与 DOM 测试、应用包的类型检查、e2e `agent-skills`、`agent-profiles`、`agent-conversation`、`settings` 全过；`lab-scenes` 只剩与本 Task 无关的既有失败（ThemeEditor 的 404，AgentDock、BackgroundCommandCard、ProfileRail、ProfileSettingsPage、SubagentCard 在手机画布上越界，同 [t34](../t34-background-tasks/README.md) 记下的），新加与改过的 Skill 场景经 `nbdev shot` 测量干净。

没有自动化覆盖的：模型经 shell 运行 Skill 的脚本并导入依赖（`install.test` 直接跑脚本）；`ambiguous`、`unreadable` 两种没带上的原因只在认标签的单元测试里；Bun 在没有 `node_modules` 时自动联网取包的行为没有实测。`skills://` 写入在资源视图层得 `unsupported-capability`（与 `docs://` 相同），写工具按分类拒绝为 `permission-denied`。

## 下一步

等开发者：

1. 批准 Spec 晋升：`agent/skills.md` 改为 `implemented`（补实现合同与证据）；`agent/compaction.md`（输出 13 与非目标里的一句）、`agent/contributions.md` 输出 20、`agent/resources.md` 输出 15、`agent/profile-settings.md` 输出 26、`ui/prompt-editor.md`（`${…}` 的写法）、`workspace/resources.md`（挂载点另给容器）里 t15 的条目去掉 planned。
2. 锁放在哪个包（后端审查第 10 条）：不判旧的系统文件锁 `tryLock` 现在在 nb-harness 的 `./file-lock`，nb-story 的 `platform/flock.ts` 是几乎相同的另一份。开发者 2026-11-13 问 nb-file-lock 为什么是 private、能不能并进 nb-harness 或一起发布：ADR 0045 决策 4 只写了不发 npm、要发布时另定，没有记录别的理由；候选是把 `tryLock` 放进 nb-file-lock 的单独子路径并随 nb-story 发布，或留在 nb-harness、让 nb-story 改用它。待定。

与评审板不同、要告诉开发者的：确认框安装中不显示实时输出（中间一块仍列直接依赖，失败后才是输出的最后几行）；点已发送消息里的 Skill 标签按名字现认，不按那一轮记下的 id；白名单为空时去 Profile 设置的那一项只在刚打 `$` 时给，`$` 后面已经有字时回车照常发送（审查前端第 16 条）。插件 SDK 的构建在 [t33](../t33-plugin-skills/README.md)。
