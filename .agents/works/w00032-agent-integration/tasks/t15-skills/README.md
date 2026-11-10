---
schema: nbook.task/v2
taskId: t15-skills
status: active
updated: 2026-11-10
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

审查改动（同意）：插话里的 `$x` 正文排在插话后面；放回合计不超过窗口 25%、Skill 用文件与计划剩下的；同一 Skill 没改过、上一份还在上下文里时只附“见前文”；代码里的 `$` 不认成 Skill（编辑器也不再显示成小块）。

先调研再定的：字段全表、Skill 参数与“带参数自动执行脚本”、依赖（Python、Node、Bun）、更新与 Skill 市场。调研：[各家的 Skill](../../research/2026-10-30-skill-survey.md)。

## 来自 t05 的事项（2026-11-07）

决定 12 的“当前 Profile 白名单”到现在没有字段（t05 第一轮否掉了 `skills.include`）。白名单的形状在 [t05 计划](../t05-profile/plan.md)的“给 t14、t15 留的”定了：Profile 声明缺省，用户在 `profileSettings` 里按 Profile 增删（`{added, removed}`，同工具绑定），设置页加一节。字段随本 Task 加。

## 当前状态

讨论完成（开发者 2026-10-30 确认）：五轮决定见上。2026-11-10 开工：实施计划 [`plan.md`](plan.md) 开发者确认（第六轮第 17–21 条）。

## 下一步

切片 0：计划设计审查（Opus）与界面静态稿（评审板）并行，写 `agent/skills.md` 与相关 Spec 的改动。之后按计划切片在 worktree `.worktree/w00032-t15-skills`（分支 `feat/w00032-t15-skills`）实施。插件 SDK 的构建在 [t33](../t33-plugin-skills/README.md)。
