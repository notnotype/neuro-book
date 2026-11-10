# t15 Skill：实施计划

## Context

t15 的设计在 2026-10-30 讨论定稿（[README](README.md) 第 1–16 条，五轮），当时定“不做设计审查，实施时再审查”。2026-11-10 开发者看了计划第一稿，定第 17–21 条；随后做了一次计划设计审查（Opus，22 条：重要 10、建议 12，见 [`evidences/plan-review.txt`](evidences/plan-review.txt) 与[处理](evidences/plan-review-handling.txt)），本稿已按处理改过。

要交付的是：用户把 Skill 放进 `user://skills/`（或由内置带来；插件的在 [t33](../t33-plugin-skills/README.md)），在对话里用 `$` 选一个，它的正文作为这一轮的附带内容交给模型；压缩之后最近用过的 Skill 放回；带依赖的 Skill 能一键初始化（界面、`$` 时的询问、命令行三处是同一件事）；每个 Profile 能管自己可用的 Skill；模型能读 Skill 的文件、在 shell 里跑它的脚本。

已有的骨架（调研结论，详见文末“现状”）：输入框已登记 `$` 触发符、草稿里 `$name` 已渲染成技能标签、点标签发 `skill.open`；宿主没有开 `$`；`skills://` 只有占位根；压缩放回只认文件与计划；Profile 声明与 `profileSettings` 都没有 Skill 字段；命令行没有 `skill` 子命令；运行期没有执行过 `bun install`。

依据：第 1–21 条决定；内核的位置章（[`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md) 输出 13、14）与反应（[`harness/extensions.md`](../../../../../docs/specs/harness/extensions.md) 输出 11–18）；放回（[`agent/compaction.md`](../../../../../docs/specs/agent/compaction.md)）；资源地址与挂载（[`agent/resources.md`](../../../../../docs/specs/agent/resources.md)、[`workspace/resources.md`](../../../../../docs/specs/workspace/resources.md)）；白名单的形状（[t05 计划](../t05-profile/plan.md)“给 t14、t15 留的”）；命令行（[w00035](../../../w00035-nbook-cli/README.md) 第 2 条）。

工作方式：先写 Spec 与界面静态稿（评审板），定了再前后端一起实施，一个分支、一次合入；worktree `.worktree/w00032-t15-skills`、分支 `feat/w00032-t15-skills`；主会话写代码，按切片提交；审查后端派 Claude Opus、前端派 Sonnet。

## 技术选型

| 问题 | 选用 | 理由与否决 |
|---|---|---|
| `SKILL.md` 的 frontmatter | `yaml`（`^2.8.2`，仓库根与 dev-panel 已在用，`neuro-book` 新加依赖） | 标准就是 YAML；手写解析否决 |
| 提示词里的 `$` 标签 | `nb-markdown` 现有的分词（`prompt-text.ts`），从包的根入口（已是纯 TS，后端已在用）导出取标签的函数 | 草稿里显示成标签的与服务端认出的必须是同一套；服务端另写正则、新开子路径都否决 |
| `bun.lock` | `Bun.JSONC`（带尾逗号，`JSON.parse` 读不了） | 手写去逗号否决 |
| 装依赖 | 应用自己的 Bun（`process.execPath`，应用与命令行都以 Bun 运行）经 `Bun.spawn` | 第 16 条；`owned-process` 只有旧应用在用 |
| 同一个 Skill 同时只装一次 | 进程内并入正在跑的那一次（同一个 Promise）；跨进程用 nb-harness 的 `tryLock`（`flock` 与 Windows 的 `LockFileEx`，进程怎么结束都由系统放锁），锁文件放状态根、按 Skill 分文件、建好不删 | 在 Skill 目录 `wx` 建、装完删的锁会在崩溃后留下（审查第 8 条）；`proper-lockfile` 要判旧，否决。`tryLock` 现在只在内核内部，新增公开导出 |
| 监视 | `node:fs` 的非递归 `watch`：`user://skills/` 根、每个 Skill 目录、每个 Skill 的 `node_modules`（存在时） | 递归监视在 `node_modules` 上要登记上千个 inotify，跳过事件也省不掉（审查第 7 条）；标记写在 `node_modules` 顶层，非递归监视它就看得到命令行写的标记 |
| 命令行 | 现有 `commander`（`src/cli/run.ts`） | 已在用 |

## 关键设计

### Skill 包与目录（`agent/backend/skills/catalog.ts`，新）

- 包：一个目录，入口 `SKILL.md`（frontmatter 加正文）。字段只收标准 6 个加 `when-to-use`（也认 `when_to_use`）：`name` 必填，1–64 个小写字母、数字、连字符，不以连字符开头或结尾、没有连续的连字符，必须等于目录名；`description` 必填，1–1024 字；`license`；`compatibility` 至多 500 字；`metadata` 字符串到字符串；`allowed-tools` 只解析不生效。其余字段不收（忽略）。第一版的表现固定：模型不能自己启用、说明不进提示词、用户用 `$` 触发（第 3 条）。
- 来源与 id（第 9、10、13 条）：内置 `builtin.<name>`（包里的 `skills/` 目录，打包进 `dist/skills/`，定位方式同 `docs-root.ts`；这次不带内置 Skill，只有机制）；`user://skills/<name>/` 是 `user.<name>`；插件的在 t33。不做同名覆盖。来源以目录条目的 `source` 为准，不看 id 前缀（插件发布者也可以叫 `user`，审查第 12 条）。
- 坏掉的只隔离它一个：目录里列出、状态 `broken`、带原因，写诊断（第 14 条）。算坏的：没有 `SKILL.md`（下一层有的提示“可能多套了一层目录”）、frontmatter 读不懂、必填字段缺或不合规、`name` 与目录名对不上、Skill 目录是链接（`skills://` 的挂载点不能是链接，审查第 22 条）。可选字段不合规的只忽略那个字段并写诊断，Skill 照常可用。
- 就绪状态：没有 `package.json` 的是 `ready`；有的看标记 `node_modules/.nbook-skill-deps.json`（第 8 条：`schema`、`runtime`、`inputs`、`platform`（含 CPU 架构）、`bun`、`installedAt`、失败时 `error`）。`inputs` 是 `package.json` 里影响安装的字段（各类 dependencies、`overrides`、`resolutions`、`patchedDependencies`）加 `bun.lock` 的哈希，安装之后按现状重算（生成锁的那次也对得上）。标记与现状一致、`platform` 相同、没有 `error` 才是 `ready`；否则 `needs-init`（失败过的带原因）；本进程在装，或锁被别的进程拿着，是 `initializing`。只认 `bun.lock`，只有 `bun.lockb` 或 `package-lock.json` 的按“没有锁”算。
- 外部依赖只检测、只报告（第 4 条）：有 `pyproject.toml`、`requirements.txt`、`uv.lock`，或 Skill 目录（两层以内）有带 `# /// script` 的 `.py` 文件的，标“要自己装 Python 依赖”，并看 `uv` 在不在 `PATH`；系统程序没法通用地检测，展示 `compatibility` 的原文。状态不因此变。
- 目录变化：启动时扫一遍，之后按“技术选型”的监视（防抖）重扫变了的 Skill；变了推 `skillsChanged`。正文不缓存：每次 `$` 与放回都现读（第 15 条）。插件停止时关掉监视器、取消防抖。
- 交出：`list()`（条目 `{id, name, description, whenToUse?, source, location, status, problem?, external?: {python?, uvMissing?, compatibility?}}`，`location` 是 `skills://<id>/SKILL.md`）、`resolve(id)`（服务端用的真实目录）、`resolveToken(token, allowed)`（见下）、`onChanged`。

### 认标签（`resolveToken`）

`$` 标签的文字先按 id 认；认不出再在整个目录里按 `name` 认（区分大小写）：同名的里恰好一个在白名单里就是它，多于一个在白名单里是 `ambiguous`（界面提示改用 `${id}`），都不在白名单里是 `not-allowed`，没有同名的是 `not-found`；坏掉的是 `broken`（审查第 11 条）。草稿、发送、点开三处用同一个规则。

### `$` 的写法（`packages/nb-markdown`）

- 行内代码与围栏代码里的 `$…` 不算标签（编辑器同步改：代码里的 `$HOME` 不再显示成技能小块）；其余规则不变（审查第 5 条）。
- 花括号写法 `${…}` 放宽：首字符可以是数字，中间可以有 `.`，用来写数字开头的名字与带前缀的 id；不带花括号的 `$name` 仍要字母开头（`$5` 这类价格不受影响，审查第 6 条）。`$` 菜单插入时，`$name` 写不出来或重名的一律插 `${id}`。
- 取标签的函数从根入口导出，编辑器与服务端共用；先补对照测试再改。

### Profile 的 Skill 白名单（`shared/profile-skills.ts`，新；`shared/points.ts`、`shared/contracts.ts`、`shared/settings.ts`）

- Profile 声明加 `skills?: {allowed: string[] | "all"}`；`profileSettings` 每项加 `skills?: {added, removed}`；换算同 `profile-agents.ts`（`profileSkills`、`changeSkillsBinding`，声明 `"all"` 时 `declared` 取当前目录的全部 id）。没声明就没有可用的 Skill；主创声明 `"all"`，临时帮手不声明（第 17 条）。
- 白名单里的 id 现在不在目录里的不报错，`$` 菜单不列；设置页列成“已删除或不可用”一行，能去掉。
- 设置页：Profile 页加“Skill”一节，复用 `ProfileToolsSection`（`kind` 加 `skills`）；`profile-view.ts` 加 `skillsField`，`profile-page.ts` 写 `profileSettings`。

### 这一轮带上 Skill（扩展 `nbook.agent.skills`，`agent/backend/skills/extension.ts`，新）

- 由 `input`、`steer` 事件引出的反应；用户与父 Agent 发的话一样处理（第 18 条）。取出 `$` 标签按顺序去重，逐个 `resolveToken`（白名单取 `ctx.session.profile` 的）。
- 认出的现读 `SKILL.md`（带 `ctx.signal`），写对话事件 `skill`：`{id, name, location, body, truncated}`，正文超过 20,000 token 截断并写明全文地址。每个标签单独收错：读失败写 `skillMissing{reason: "unreadable"}`，不让别的 Skill 跟着丢（审查第 2 条）。
- 位置：`input` 引出的写在这一轮的附带内容里，排在用户的话前面（第 11 条）；`steer`（含异步提问的回答转成的插话）引出的写在这句插话后面——内核的位置章没有“附在某条事件之前”，只为插话加这个能力不值得（审查第 1 条，要告诉开发者）。
- 同一个 Skill 正文没变、上一份还在上下文里（压缩之后算不在）时，只写一条短的 `skill`（`sameAs: true`，不带正文，渲染成“Skill「x」见前文”），不重复附全文（审查第 19 条，要告诉开发者）。用一个随压缩清空的 path 片记“已附的 id 与正文哈希”。
- 认不出的写扩展事件 `skillMissing`：`{token, reason: "not-found" | "not-allowed" | "ambiguous" | "broken" | "unreadable"}`，不进请求，只给界面显示。未就绪的照样带上正文。
- 渲染给模型的样子：`<skill id="…" name="…" location="skills://…/SKILL.md">` 加正文，末尾说明这个 Skill 的文件在 `skills://<id>/`（shell 里可以直接写这个地址），脚本里的相对路径按 Skill 目录算、shell 的工作目录不是 Skill 目录（审查第 10 条）。
- 正文是事实：之后 Skill 改了，已经写下的轮不变（第 15 条）。`preview()` 不跑反应，排队中带 `$` 的话在“看上下文”里看不到 Skill 正文，写进已知限制。

### 压缩之后放回 Skill（`agent/backend/skills/restore.ts`，新；内核放回参数加一项）

- 内核：`CompactionRestoreArgs` 加“压缩之后仍在上下文里的事件”（判断函数或切点），`runtime.md` 输出 48 补一句。没有它就分不出这一轮里刚用过、仍在附带内容里的 Skill，会放回第二份（审查第 4 条）。
- 宿主：在套件的 `CompactionRestore.run` 之后接着放 Skill：从压缩前的路径里找 `nbook.agent.skills/skill`（带正文的那种），跳过仍在上下文里的，最近的在前、按 id 去重，现读正文。预算：每个至多 5,000 token、合计至多 25,000，并且放回的合计（文件、计划、Skill）不超过窗口的 25%（`compaction.md` 现有的口径）——文件与计划先放，Skill 用剩下的。所以 180k 以上的窗口是第 11 条的完整数字，小窗口按比例收（审查第 3 条，要告诉开发者）。
- 写成同一种 `notice`，`restored` 加 `{kind: "skill", target, tokens, truncated}`。逐个 Skill 收错误、写 `restore-skipped`，不外抛（内核在放回抛错时整次放回作废）。没有换掉对话（`shake`）时不放。

### 初始化（`agent/backend/skills/install.ts`，新）

- `planInit(id)`：要装多少个包（`bun.lock` 里的包数，读不了写“未知”；没有锁时按 `package.json` 的直接依赖数，并说明“将按最新版本解析依赖并生成锁文件”）、要联网、`--ignore-scripts` 下安装脚本不会运行。只对 `source: "user"` 且有 `package.json` 的 Skill 有意义，其余得 `not-initializable`。
- `init(id, {resolve})`：本进程已在装就并入那一次；否则拿锁（`<状态根>/agent/skills/locks/<id>.lock`），拿不到得 `busy`；`<bun> install --frozen-lockfile --ignore-scripts`，没有 `bun.lock` 时要 `resolve: true` 才用 `install --ignore-scripts` 生成锁（否则 `lock-missing`）；成功写标记，失败把原因（输出的最后若干行）写进标记的 `error`；时限 10 分钟。
- 停止：插件停止时杀掉在跑的子进程、标记写 `error: "interrupted"`、放锁；命令行收到 Ctrl-C 同样处理。进程被杀时锁由系统放掉，下次照常能装（审查第 8、17 条）。
- 应用里与命令行用同一个模块；命令行离线可用、不要求应用在运行（第 19 条），应用经监视 `node_modules` 看到标记变了就更新状态。
- 已知限制（写进 Spec）：`--ignore-scripts` 让需要安装脚本的包（`sharp`、`esbuild` 这类）装完也用不了；Bun 在没有 `node_modules` 时可能自动联网取包，未初始化的脚本可能照样跑起来（审查第 18 条，切片 4 实测后定写法）。

### 资源地址 `skills://`（`agent/backend/schemes.ts`；`nbook.files` 的挂载合同）

- 挂载合同（`plugins/files/shared/schemes.ts` 的 `MountDeclaration`）加可选的 `container`：这个挂载点自己的容器目录（注册方给出的真实目录，`nbook.files` 照常核对容器与挂载点都不是链接），挂载点在容器里的目录名可以另给（`directory`，缺省是挂载点名）。`skills://user.x/` 的容器是 `<状态根>/user/skills`、目录名 `x`；内置的容器是 `dist/skills`。改的是 `nbook.files` 的跨插件合同，Spec 一起改（审查第 9 条）。
- 能力：`read`、`list`、`realPath`（模型在 shell 里能跑 Skill 的脚本），挂载点 `create: false`；Agent 写得 `permission-denied`。用户自己的 Skill 用户经 `user://skills/` 改；同一个目录有两个地址，行锚与授权按各自的地址算（审查第 10 条）。
- 根：列出目录里全部 Skill，每项写 id、名字、说明、状态（坏的写原因），对读它的会话的 Profile 标“能用 `$`”或“不在白名单”。

### 远程（`shared/remote.ts`、`backend/remote.ts`）

查询 `skills()`、事件 `skillsChanged`；`skillInitPlan({id})`、`initSkill({id, resolve?, commandId})`。失败码：`skill-not-found`、`not-initializable`、`busy`、`lock-missing`、`install-failed`、`interrupted`。

### 命令行（`src/cli/skill.ts`，新；`src/cli/run.ts` 登记）

`nbook skill init <id> [--yes] [--json]`：`<id>` 写完整 id，或只写名字（只在 `source: "user"` 的里找）；先列计划，交互终端里确认，非交互又没给 `--yes` 时得 `confirmation-required`；然后调用同一个初始化模块。输出照 `output.ts` 的 `--json` 约定。Agent 的 shell 里能不能找到 `nbook` 取决于 w00035 t01，本 Task 只保证命令行本身（审查第 21 条，写进未验证边界）。

### 对话视图（`packages/nb-agent-ui`）

- 用户消息带上这一轮附带的 Skill：`UserMessageView` 加 `skills?: Array<{token, id?, missing?: reason}>`，harness 适配器从同一轮的 `skill`、`skillMissing` 取；同一轮里有 `nbook.agent.skills` 的 `extensionFailed` 时，消息上的 `$` 标签都标“没能带上”（`reason: "failed"`）。样子在评审板定。
- `skill.open` 的载荷扩成 `{name, id?}`：已发送的消息用同一轮事件里的 `id` 打开，不在了就提示“这个 Skill 已不在”（审查第 15 条）。
- 压缩：`CompactionView.restored.kind` 加 `skill`，适配器收它，压缩详情写出放回的 Skill，压缩后用量算上它（审查第 14 条）。

### Agent 插件的浏览器端（`agent/web/`）

- `HOST_TRIGGERS` 加 `$`；`resolveTriggerMenu` 对 `$` 列当前 Profile 白名单里的 Skill（排序与各状态的样子在评审板定），插入 `$name ` 或 `${id} `。白名单为空时菜单写说明，带去设置的入口。
- 选了未就绪的：先问要不要初始化（`planInit` 的内容），确认后经远程初始化，完成或失败都把标签插进去（第 16 条）。
- `skill.open`：按条目的 `source`，用户的 Skill 打开 `user://skills/<name>/SKILL.md`（可改），其余打开 `skills://<id>/SKILL.md`（只读）。
- 设置窗口加“Skill”页（`settings.pages`，分类 ai，同 Profile 页的注册方式）；样子在评审板定。
- Lab：Skill 页、`$` 菜单的各状态、初始化确认、用户消息带 Skill 的场景。

## Spec 与文档改动

- 新建 `docs/specs/agent/skills.md`（`planned`，capability `agent.skills`）：包格式与字段、坏掉的、来源与 id、就绪与标记、外部依赖的检测、认标签、白名单、`$` 与附带内容（位置、截断、`sameAs`、`skillMissing`）、放回、初始化（三个入口、锁、停止、失败）、`skills://`、远程与失败码、命令行、已知限制；注册表“待实现规范”加一行。
- `agent/resources.md`：`skills://` 的根、挂载、`realPath`、只读。`workspace/resources.md`（或定义 `MountedSchemeSpec` 的 files Spec）：挂载点可以有自己的容器与目录名。
- `agent/compaction.md`：放回加 Skill、合计口径；`restored` 的 `kind` 加 `skill`。`harness/runtime.md` 输出 48：放回参数加“仍在上下文里的事件”。
- `agent/conversation.md`：`$` 菜单、未就绪的询问、用户消息上的 Skill、`skill.open`。`agent/contributions.md`：Profile 声明加 `skills`。`agent/profile-settings.md`：加“Skill”一节。
- `ui/agent-conversation-view.md`：`UserMessageView.skills`、`skill.open {name, id?}`、压缩详情的 Skill。`ui/prompt-editor.md`：代码里的 `$` 不算标签、`${…}` 的放宽。
- 设置窗口的页登记处加“Skill”页；`docs/modules/monorepo-boundaries.md`：nb-harness 新增 `tryLock` 的导出；w00035 的命令行清单记 `skill init` 已实现。

## 切片

| 片 | 内容 | 提交边界与自跑验证 |
|---|---|---|
| 0 | 评审板（注意力排序先定）与 `skills.md` 及上面各 Spec 的改动 | 主工作区提交；`docs:check` |
| 1 | `nb-markdown`：代码里不认 `$`、`${…}` 放宽、根入口导出（先补对照测试）；`nbook.files` 的挂载合同加容器与目录名；目录服务（解析、来源、坏的隔离、就绪、外部依赖检测、监视）、`skills://`（含 `realPath`）、远程 `skills`、`skillsChanged` | `nb-markdown`、files、Agent 插件的单测与 typecheck |
| 2 | 白名单：声明、设置、换算、Profile 页一节 | 单测与 DOM 测试 |
| 3 | 扩展 `nbook.agent.skills`（带上、`sameAs`、`skillMissing`、逐个收错）、内核放回参数、Skill 放回、`UserMessageView.skills`、压缩详情 | 真实内核的测试（本机假端点看请求里正文的位置与次数、小窗口的放回）、适配器单测 |
| 4 | `tryLock` 导出、初始化模块、远程、命令行；实测 Bun 的自动安装 | 真跑 `bun install`（本地 `file:` 依赖，不联网）；锁的测试起一个子进程拿锁 |
| 5 | 浏览器端：`$` 菜单、初始化确认、`skill.open`、Skill 页、Lab 场景 | 宿主测试、DOM 测试、Lab |
| 6 | e2e（`agent-skills.e2e.ts`）与收口；实现审查前后端各一次 | 受影响的 e2e |

## 验收场景（写进 `skills.md` 的“验收与 Smoke”）

1. `user://skills/` 放一个合法的、一个 `name` 与目录名不同的、一个多套了一层目录的：目录里一个可用、两个 `broken` 各带原因，诊断里各一条；改好之后不重启就变成可用。
2. 主创的输入框打 `$`：列出白名单里的 Skill；选一个发出去，模型收到的这一轮里 Skill 正文在用户的话前面；之后改 `SKILL.md`，已经发出的那一轮不变，下一次 `$` 用新的。运行中插话带 `$x`：正文紧跟在这句插话后面。
3. 打一个不存在的 `$x`、一个不在白名单里的、一个重名的：都不带正文，用户消息上各标出原因。行内代码里的 `$HOME` 不算标签。
4. 带 `package.json` 与 `bun.lock` 的 Skill：`$` 菜单标未初始化；选它时问要不要初始化，确认后装好、标记写下、状态变成可用；模型经 shell 运行它的脚本并成功导入依赖；`bun.lock` 改了又变回未初始化。
5. 锁被另一个进程拿着时，设置页与命令行的初始化都得 `busy`、状态显示正在初始化；拿锁的进程被杀之后，再初始化能成功。
6. 用过两个 Skill 后压缩：放回里有这两个 Skill 的现行正文，各不超过 5,000 token；这一轮里刚用过、仍在上下文里的不放第二份；64k 窗口时放回合计不超过窗口的 25%。
7. Profile 设置页去掉一个 Skill：`$` 菜单不再列它，打它的名字得“不在白名单”。
8. 同一个会话里连续两轮 `$` 同一个没改过的 Skill：第二轮只带一句“见前文”。

Smoke：`packages/neuro-book/e2e/agent-skills.e2e.ts`（场景 2、3、4）。

## 验证

- 单测与真实内核的测试覆盖目录、认标签、白名单换算、附带内容的位置与次数、放回的去重与预算、初始化的锁与标记。
- 初始化要真跑 Bun：测试夹具的 Skill 只依赖仓库里的本地包（`file:` 依赖）或空依赖，不联网；联网的安装只在开发者试用时看。
- e2e 走真实服务端与浏览器：打 `$`、选、发出去、看假端点收到的请求；未就绪的询问与初始化。
- 未验证边界：Windows 上的锁与监视；Agent 经 shell 执行 `nbook skill init`（依赖 w00035 t01）；插件的 Skill 在 t33。

## 不做与风险

- 不做：模型自己启用 Skill、Skill 说明进提示词、Skill 参数与“带参数自动执行脚本”（第 2、3 条）；Python 与系统程序的安装（第 4 条）；额外的 Skill 目录（第 10 条）；书专属的 Skill；目录变化实时提醒会话（第 15 条）；插件的 Skill（t33）。
- 风险：`nb-markdown` 的分词改动影响编辑器现有的标签行为（先补对照测试）；`bun install` 在离线或代理环境里慢或失败，失败原因要写得清楚；`nbook.files` 的挂载合同是跨插件改动，`sessions://` 等现有方案的行为不能变。

## 开发者已定（2026-11-10，README 第 17–21 条）

1. 没声明白名单就没有可用的 Skill；主创声明“全部”，临时帮手不声明。
2. 父 Agent 的话里有 `$x` 也算触发，不特殊处理。
3. `nbook skill init` 离线可用，锁挡并发。
4. 插件的 Skill 与 SDK 构建拆到 t33。
5. 先出一轮界面静态稿，后端几片与评审并行。

## 现状（调研摘要，2026-11-10）

- 输入框：`$` 已登记（`nb-agent-ui/src/vue/builtin-composer.ts`），宿主不在 `interaction.triggers` 里列就不开菜单；`SKILL_TOKEN_PATTERN` 认 `$name`、`${name}`，首字符要是字母，不认 `.`，行内代码里的也认。
- 内核：`conv` 事件的位置章由内核盖（`kernel/dispatch/core.ts` 的 `positionFor`）；`input` 引出的反应写在这一轮的附带内容里、排在用户的话前面，`steer` 引出的排在插话后面；反应可以异步，全部完成后才发下一次请求；反应失败时整批丢弃。
- 放回：套件 `kit/compaction/restore.ts` 只放最近文件、计划与日志地址，合计 `min(20,000, 窗口 × 25%)`；放回参数里没有切点。
- 挂载：`MountedSchemeSpec` 只有一个容器，挂载点是“容器/名字”，不能是链接；`skills` 方案只有 `read`、`list`。
- 白名单与设置页：`profile-agents.ts`、`ProfileToolsSection` 的 `kind` 可以照搬；设置页经 `settings.pages` 登记。
- 命令行：`src/cli/run.ts`（commander），只有 `start` 与 `plugin`；运行期没有跑过 `bun install`；`tryLock` 只在 nb-harness 内核内部。
