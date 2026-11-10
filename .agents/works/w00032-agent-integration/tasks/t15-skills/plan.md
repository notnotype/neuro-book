# t15 Skill：实施计划

## Context

t15 的设计在 2026-10-30 讨论定稿（[README](README.md) 第 1–16 条，五轮），当时定“不做设计审查，实施时再审查”。2026-11-10 开发者定 t14 之后接着做 t15。

要交付的是：用户把 Skill 放进 `user://skills/`（或由内置、插件带来），在对话里用 `$` 选一个，它的正文作为这一轮的附带内容交给模型；压缩之后最近用过的 Skill 放回；带依赖的 Skill 能一键初始化（界面、`$` 时的询问、命令行三处是同一件事）；每个 Profile 能管自己可用的 Skill。

已有的骨架（调研结论，详见文末“现状”）：输入框已登记 `$` 触发符、草稿里 `$name` 已渲染成技能标签、点标签发 `skill.open`；宿主没有开 `$`（`session-host.ts` 的 `HOST_TRIGGERS` 只有 `@`、`/`）；`skills://` 只有占位根；压缩放回只认文件与计划；Profile 声明与 `profileSettings` 都没有 Skill 字段；命令行没有 `skill` 子命令；运行期没有执行过 `bun install`。

依据：第 1–16 条决定；内核的位置章（[`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md) 输出 13、14：附带内容在前、用户的话在最后）与反应（[`harness/extensions.md`](../../../../../docs/specs/harness/extensions.md) 输出 11–16：处理函数可以异步，全部完成之后才发下一次请求）；放回（[`agent/compaction.md`](../../../../../docs/specs/agent/compaction.md)）；资源地址（[`agent/resources.md`](../../../../../docs/specs/agent/resources.md)）；白名单的形状（[t05 计划](../t05-profile/plan.md)“给 t14、t15 留的”）；命令行（[w00035](../../../w00035-nbook-cli/README.md) 第 2 条：`nbook skill init <id> [--yes]`）。

工作方式：先写 Spec 与界面静态稿（评审板），定了再前后端一起实施，一个分支、一次合入（同 t14）；worktree `.worktree/w00032-t15-skills`、分支 `feat/w00032-t15-skills`；主会话写代码，按切片提交；审查后端派 Claude Opus、前端派 Sonnet（开发者 2026-11-10 定本会话不开 omp）。

## 技术选型

| 问题 | 选用 | 理由与否决 |
|---|---|---|
| `SKILL.md` 的 frontmatter | `yaml`（`^2.8.2`，仓库根与 dev-panel 已在用，`neuro-book` 新加依赖） | 标准就是 YAML；手写解析否决 |
| 提示词里的 `$` 标签 | `nb-markdown` 现有的分词（`prompt-text.ts` 的 `SKILL_TOKEN_PATTERN`），新开一个纯 TS 的子路径导出给服务端 | 草稿里显示成标签的与服务端认出的必须是同一套；服务端另写正则否决 |
| 装依赖 | 应用自己的 Bun（`process.execPath`）经 `Bun.spawn` 跑 `install --frozen-lockfile --ignore-scripts` | 第 16 条；`owned-process` 只有旧应用在用、新应用的子进程由服务端自己托管，不用 |
| 监视 `user://skills/` | `node:fs` 的 `watch`（递归），同 `ProfileBundles` 监视 `user://profiles/` 的做法 | 文件服务的订阅是给界面的，后端自己的目录照现有先例 |
| 同一个 Skill 同时只装一次 | 进程内按 id 排队，加上 Skill 目录里的锁文件（`wx` 建、装完删）挡住命令行与应用同时装 | 另起锁服务否决 |
| 命令行 | 现有 `commander`（`src/cli/run.ts`） | 已在用 |

## 关键设计

### Skill 包与目录（`agent/backend/skills/catalog.ts`，新）

- 包：一个目录，入口 `SKILL.md`（frontmatter 加正文）。字段只收标准 6 个加 `when-to-use`（也认 `when_to_use`）：`name` 必填，1–64 个小写字母、数字、连字符，必须等于目录名；`description` 必填，1–1024 字；`license`；`compatibility` 至多 500 字；`metadata` 字符串到字符串；`allowed-tools` 只解析不生效。其余字段不收（忽略）。第一版的表现固定：模型不能自己启用、说明不进提示词、用户用 `$` 触发（第 3 条）。
- 来源与 id（第 9、10、13 条）：内置 `builtin.<name>`（包里的 `skills/` 目录，打包进 `dist/skills/`，定位方式同 `docs-root.ts`；这次不带内置 Skill，只有机制）；`user://skills/<name>/` 是 `user.<name>`；插件贡献的是 `<插件 id>.<name>`（见“插件的 Skill”）。不做同名覆盖。
- 坏掉的（frontmatter 读不懂、必填字段缺、`name` 与目录名对不上）只隔离它一个：目录里列出、状态 `broken`、带原因，写诊断（第 14 条）。
- 就绪状态：没有 `package.json` 的是 `ready`；有 `package.json` 的看标记 `node_modules/.nbook-skill-deps.json`（第 8 条：`schema`、`runtime`、`inputs`、`platform`、`bun`、`installedAt`、失败时 `error`），`inputs` 是 `package.json` 里影响安装的字段（各类 dependencies、`overrides`、`resolutions`、`trustedDependencies`、`patchedDependencies`）加 `bun.lock` 的哈希；标记与现状一致、`platform` 相同、没有 `error` 才是 `ready`，否则 `needs-init`（失败过的带原因），正在装是 `initializing`。有 `pyproject.toml`、`requirements.txt`、`uv.lock` 的另标“要自己装 Python 依赖”，状态不因此变（第 4 条：只检测、只报告）。
- 目录变化：启动时扫一遍，之后监视 `user://skills/`（防抖）重扫；变了推 `skillsChanged`。正文不缓存：每次 `$` 与放回都现读（第 15 条）。
- 交出：`list()`（条目 `{id, name, description, whenToUse?, source, plugin?, location, status, problem?, python?}`，`location` 是 `skills://<id>/SKILL.md`）、`resolve(id)`（服务端用的真实目录）、`onChanged`。

### Profile 的 Skill 白名单（`shared/profile-skills.ts`，新；`shared/points.ts`、`shared/contracts.ts`、`shared/settings.ts`）

- Profile 声明加 `skills?: {allowed: string[] | "all"}`；`profileSettings` 每项加 `skills?: {added, removed}`；换算同 `profile-agents.ts`（`profileSkills`、`changeSkillsBinding`）。没声明就没有可用的 Skill；主创声明 `"all"`，临时帮手不声明（第 17 条）。声明 `"all"` 时 `added` 不起作用，`removed` 照样去掉。
- 白名单里的 id 现在不在目录里的不报错，`$` 菜单不列；设置页列成“已删除或不可用”一行，能去掉（同 t14 的可派子代理）。
- 设置页：Profile 页加“Skill”一节，复用 `ProfileToolsSection`（`kind` 加 `skills`），候选是目录里不在白名单的；`profile-view.ts` 加 `skillsField`，`profile-page.ts` 写 `profileSettings`。

### 这一轮带上 Skill（扩展 `nbook.agent.skills`，`agent/backend/skills/extension.ts`，新）

- 由 `input`、`steer` 事件引出的反应：用户与父 Agent 发的话一样处理（第 18 条：父 Agent 的话里有 `$x` 也算，只要在子会话 Profile 的白名单里）。用 `nb-markdown` 的分词从 `text` 里取出 `$` 标签，按顺序去重；每个标签先按 id 认，认不出再在当前 Profile 的白名单里按 `name` 认（唯一才算）。
- 认出的现读 `SKILL.md`，写对话事件 `skill`：`{id, name, location, body, truncated}`。写在反应里，所以位置章自然是这一轮的附带内容（`input`）或这一步之后（`steer`），排在用户的话前面（第 11 条）。正文超过 20,000 token 截断，写明全文地址。渲染给模型的样子：`<skill id="…" name="…" location="skills://…/SKILL.md">` 加正文，末尾一句“这个 Skill 的文件在 skills://<id>/，按正文的说明使用”。
- 认不出或读不了的写扩展事件 `skillMissing`：`{token, reason: "not-found" | "not-allowed" | "unreadable"}`，不进请求，只给界面显示。未就绪的照样带上正文（正文本身可读，脚本跑不了时模型会看到报错），界面在选的时候已经问过要不要初始化。
- 正文是事实：之后 Skill 改了，已经写下的轮不变（第 15 条）。

### 压缩之后放回 Skill（`agent/backend/agent.ts` 的 `restore` 接线，`agent/backend/skills/restore.ts`，新）

- 在套件的 `CompactionRestore.run` 外面包一层：放回文件与计划之后，从压缩前的路径里找 `nbook.agent.skills/skill` 事件，最近的在前、按 id 去重，现读正文，每个前 5,000 token、合计 25,000（第 11 条），写成同一种 `notice`，`restored` 加 `{kind: "skill", target: location, tokens, truncated}`。没有换掉对话（`shake`）时不放，同文件。
- 不改套件：Skill 是 NeuroBook 的概念，接在宿主的 `restore` 上。

### 初始化（`agent/backend/skills/install.ts`，新）

- `planInit(id)`：要装多少个包（`bun.lock` 里的包数；没有锁时按 `package.json` 的直接依赖数，并说明“将按最新版本解析依赖并生成锁文件”）、要联网。只对 `user.*` 的 Skill 有意义：内置与插件的随构建带齐（第 7 条），没有初始化。
- `init(id, {resolve})`：同一个 Skill 进程内排队，再在 Skill 目录建锁文件（已在装得 `busy`）；`<bun> install --frozen-lockfile --ignore-scripts`，没有 `bun.lock` 时要 `resolve: true` 才用 `install --ignore-scripts` 生成锁；成功写标记，失败把原因（输出的最后若干行）写进标记的 `error`；有时限（10 分钟）。状态变化经目录推出去。
- 应用里与命令行用同一个模块；命令行离线可用、不要求应用在运行（第 19 条），应用的监视看到标记变了就更新状态。

### 资源地址 `skills://`（`agent/backend/schemes.ts`）

- 根：列出目录里全部 Skill，每项写 id、名字、说明、状态（坏的写原因），对读它的会话的 Profile 标“能用 `$`”或“不在白名单”。
- `skills://<id>/` 挂到它的真实目录，Agent 只读（写得 `permission-denied`）；用户自己的 Skill 用户经 `user://skills/` 改。

### 远程（`shared/remote.ts`、`backend/remote.ts`）

查询 `skills()`、事件 `skillsChanged`；`skillInitPlan({id})`、`initSkill({id, resolve?, commandId})`。失败码：`skill-not-found`、`not-initializable`（不是用户的 Skill 或没有依赖）、`busy`、`lock-missing`（没有 `bun.lock` 又没给 `resolve`）、`install-failed`。

### 命令行（`src/cli/skill.ts`，新；`src/cli/run.ts` 登记）

`nbook skill init <id> [--yes] [--json]`：`<id>` 可以写 `user.<name>` 或 `<name>`；先列计划（包数、要联网、是否生成锁），交互终端里确认，非交互又没给 `--yes` 时得 `confirmation-required`；然后调用同一个初始化模块。输出照 `output.ts` 的 `--json` 约定。

### 对话视图（`packages/nb-agent-ui`）与输入框分词（`packages/nb-markdown`）

- `nb-markdown`：`${…}` 的写法允许 `.`，用来写 id（重名时插入 `${user.reviewer}`）；新开纯 TS 子路径（例如 `./prompt/syntax`）导出取 `$` 标签的函数，编辑器与服务端共用。
- 用户消息带上这一轮附带的 Skill：`UserMessageView` 加 `skills?: Array<{id, name, missing?: reason}>`，harness 适配器从同一轮的 `skill`、`skillMissing` 事件取；样子在评审板定（第 0 片）。

### Agent 插件的浏览器端（`agent/web/`）

- `HOST_TRIGGERS` 加 `$`；`resolveTriggerMenu` 对 `$` 列当前 Profile 白名单里的 Skill（名字与说明；重名写 id；未就绪的标状态，第 12 条），插入 `$name `，重名时 `${id} `。白名单为空时菜单写“这个 Profile 还没有可用的 Skill”，带去设置的入口。
- 选了未就绪的：先问要不要初始化（列包数、要联网；没有锁时说明会生成锁），确认后经远程初始化，完成或失败都把标签插进去（第 16 条）。
- `skill.open`：用户的 Skill 打开 `user://skills/<name>/SKILL.md`（可改），其余打开 `skills://<id>/SKILL.md`（只读）。
- 设置窗口加“Skill”页（`settings.pages`，分类 ai，同 Profile 页的注册方式）：按来源分组列出，每行名字、说明、状态与原因，用户的 Skill 有“初始化”“打开”；页头有“打开 Skill 文件夹”。样子在评审板定。
- Lab：Skill 页、`$` 菜单的各状态、初始化确认、用户消息带 Skill 的场景。

### 插件的 Skill

拆到 [t33](../t33-plugin-skills/README.md)（第 20 条）：贡献点 `agent.skills` 与插件 SDK 的构建。本 Task 的目录服务按“来源”设计，插件只是多一个来源。

## Spec 与文档改动

- 新建 `docs/specs/agent/skills.md`（`planned`，capability `agent.skills`）：包格式与字段、来源与 id、坏掉的、就绪与标记、白名单、`$` 与附带内容、放回、初始化（三个入口、锁、失败）、`skills://`、远程与失败码、命令行；注册表“待实现规范”加一行。
- `agent/resources.md`：`skills://` 的根与挂载、只读（改原来的“只有说明”一行）。
- `agent/compaction.md`：放回加 Skill（去掉“放回不含加载过的 Skill”），`restored` 的 `kind` 加 `skill`。
- `agent/conversation.md`：`$` 菜单、未就绪的询问、用户消息带的 Skill、`skill.open`（改“`$` 还没有”两处）。
- `agent/contributions.md`：Profile 声明加 `skills`。`agent/profile-settings.md`：加“Skill”一节。
- `ui/agent-conversation-view.md`：`UserMessageView.skills`、`$` 菜单为空时的写法。`ui/prompt-editor.md`：`${…}` 允许 `.`。
- 设置窗口的页登记处（`settings` 的 Spec）加“Skill”页；w00035 的命令行清单记 `skill init` 已实现。

## 切片

| 片 | 内容 | 提交边界与自跑验证 |
|---|---|---|
| 0 | 评审板（Skill 页、`$` 菜单各状态、初始化确认、用户消息带 Skill、Profile 页的 Skill 一节）与 `skills.md` 及上面各 Spec 的改动；计划设计审查（Opus）与开发者看板同时进行 | 主工作区提交；`docs:check` |
| 1 | `nb-markdown` 的 `${id}` 与纯 TS 分词导出；目录服务（解析、来源、坏的隔离、就绪、监视）、`skills://`、远程 `skills`、`skillsChanged` | `nb-markdown` 与 Agent 插件的单测、typecheck |
| 2 | 白名单：声明、设置、换算、Profile 页一节 | 单测与 DOM 测试 |
| 3 | 扩展 `nbook.agent.skills`（带上与 `skillMissing`）、放回、`UserMessageView.skills` | 真实内核的测试（本机假端点看请求里正文的位置）、适配器单测 |
| 4 | 初始化模块、远程、命令行 | 真跑 `bun install`（本地夹具的 Skill、离线包，见“验证”）；命令行测试 |
| 5 | 浏览器端：`$` 菜单、初始化确认、`skill.open`、Skill 页、Lab 场景 | 宿主测试、DOM 测试、Lab |
| 6 | e2e（`agent-skills.e2e.ts`）与收口；实现审查前后端各一次 | 受影响的 e2e |


## 验收场景（写进 `skills.md` 的“验收与 Smoke”）

1. `user://skills/` 放一个合法的、一个 `name` 与目录名不同的：目录里一个可用、一个 `broken` 带原因，诊断里有一条；改好之后不重启就变成可用。
2. 主创的输入框打 `$`：列出白名单里的 Skill；选一个发出去，模型收到的这一轮里 Skill 正文在用户的话前面；之后改 `SKILL.md`，已经发出的那一轮不变，下一次 `$` 用新的。
3. 打一个不存在、或不在白名单里的 `$x`：不带正文，用户消息上标出没找到。
4. 带 `package.json` 与 `bun.lock` 的 Skill：`$` 菜单标未初始化；选它时问要不要初始化，确认后装好、标记写下、状态变成可用；`bun.lock` 改了又变回未初始化。
5. 命令行 `nbook skill init user.x --yes` 与设置页同时装同一个：只有一个在装，另一个得 `busy`。
6. 用过两个 Skill 后压缩：放回里有这两个 Skill 的现行正文，各不超过 5,000 token。
7. Profile 设置页去掉一个 Skill：`$` 菜单不再列它，打它的名字得“不在白名单”。

Smoke：`packages/neuro-book/e2e/agent-skills.e2e.ts`（场景 2、3、4）。

## 验证

- 单测与真实内核的测试覆盖目录、白名单换算、附带内容的位置与正文、放回预算、初始化的锁与标记。
- 初始化要真跑 Bun：测试夹具的 Skill 只依赖仓库里的本地包（`file:` 依赖）或空依赖，不联网；联网的安装只在开发者试用时看。
- e2e 走真实服务端与浏览器：打 `$`、选、发出去、看假端点收到的请求；未就绪的询问与初始化。
- 未验证边界：Windows 上的锁文件与监视；插件的 Skill 在 t33。

## 不做与风险

- 不做：模型自己启用 Skill、Skill 说明进提示词、Skill 参数与“带参数自动执行脚本”（第 2、3 条）；Python 与系统程序的安装（第 4 条）；额外的 Skill 目录（第 10 条）；书专属的 Skill；目录变化实时提醒会话（第 15 条）。
- 风险：`$` 的分词换成纯 TS 导出时不能改变编辑器现有的标签行为（先补对照测试再搬）；`bun install` 在离线或代理环境里慢或失败，失败原因要写得清楚；监视在大目录（带 `node_modules`）上的开销，监视要跳过 `node_modules`。

## 开发者已定（2026-11-10，README 第 17–21 条）

1. 没声明白名单就没有可用的 Skill；主创声明“全部”，临时帮手不声明。
2. 父 Agent 的话里有 `$x` 也算触发，不特殊处理。
3. `nbook skill init` 离线可用，锁文件挡并发。
4. 插件的 Skill 与 SDK 构建拆到 t33。
5. 先出一轮界面静态稿，后端几片与评审并行。

## 现状（调研摘要，2026-11-10）

- 输入框：`$` 已登记（`nb-agent-ui/src/vue/builtin-composer.ts`），宿主不在 `interaction.triggers` 里列就不开菜单；`SKILL_TOKEN_PATTERN` 认 `$name`、`${name}`，不认 `.`。
- 内核：`conv` 事件的位置章由内核盖（`kernel/dispatch/core.ts` 的 `positionFor`）；`reminder` 是在 `turnStarted` 写附带内容的先例；反应可以异步，全部完成后才发下一次请求。
- 放回：套件 `kit/compaction/restore.ts` 只放最近文件、计划与日志地址。
- 白名单与设置页：`profile-agents.ts`、`ProfileToolsSection` 的 `kind` 可以照搬；设置页经 `settings.pages` 登记。
- 命令行：`src/cli/run.ts`（commander），只有 `start` 与 `plugin`；运行期没有跑过 `bun install`。
