---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: agent.skills
owners:
  - nbook.agent
---

# Skill

## 目标与非目标

用户把 Skill（一个带 `SKILL.md` 的文件夹）放进 `user://skills/`，或由应用内置、由插件带来，在对话里用 `$` 选它：这一轮把它的正文交给模型，压缩之后放回最近用过的；带 Bun 依赖的 Skill 能初始化（设置里的 Skill 页、`$` 选它时的询问、命令行三处是同一件事）；每个 Profile 有自己可用的 Skill；模型能读 Skill 的文件，并在 shell 里运行它的脚本。

不承诺：

- 模型不能自己启用 Skill，Skill 的说明不进提示词；没有 Skill 参数，带参数也不自动执行脚本。
- Python 依赖与系统程序只检测、只报告，不代替用户安装。
- 来源只有内置、插件与 `user://skills/`：没有额外的 Skill 目录，没有书专属的 Skill；内置插件不经 `agent.skills` 带 Skill（内置的走 `builtin` 来源）。
- Skill 目录变了不实时提醒正在进行的会话；`$` 菜单与 Skill 页随时是最新的。
- 插件的 Skill 由 `nbooke build` 打包（[`runtime/plugin-api.md`](../runtime/plugin-api.md) 的“作者工具”）：依赖按工作目录、环境变量或写死的路径找数据文件时，构建查不出，装好之后脚本才失败。（planned）
- 命令行发起的安装在另一个进程里，不进后台任务的清单；应用里只看到它“正在初始化”与之后的状态。
- 已知限制：安装时不运行包的安装脚本，需要安装脚本的包（例如带原生模块的）装完也可能用不了；没有初始化的 Skill，它的脚本仍可能被运行起来，结果不保证；排队中的话在“看上下文”的预览里看不到 Skill 正文（预览不跑反应）；“打开 Skill 文件夹”只知道系统的打开程序有没有起来，它起来之后没能打开文件夹（例如没有文件管理器）时界面上看不出来。Skill 已有 `bun.lock`、之后手改 `package.json` 加了依赖时，锁文件过期，按锁的安装必然失败（`install-failed`，原因在 Bun 的安装输出里）；应用与命令行都不重新生成锁，要在 Skill 文件夹里跑一次 `bun install`（或删掉 `bun.lock` 再初始化）；用 `bun add` 加依赖时锁会跟着更新，不会这样。

## 术语与参与者

- **Skill 包**：一个目录，入口是目录下的 `SKILL.md`（YAML frontmatter 加 Markdown 正文）。
- **Skill 目录**：应用当前认得的全部 Skill 包，每个一条目录条目。
- **来源**：`builtin`（应用内置）、`plugin`（插件经 `agent.skills` 贡献的）、`user`（`user://skills/` 下的）。**id**：`<来源前缀>.<name>`，内置是 `builtin.<name>`，用户的是 `user.<name>`，插件的是 `<插件 id>.<name>`；来源以条目的 `source` 为准，不从 id 前缀推断。
- **状态**：`ready`（可用）、`needs-init`（未初始化）、`initializing`（正在初始化）、`invalid`（无效）。
- **初始化**：在 Skill 目录里按锁文件装好它的 Bun 依赖；**初始化标记**：装好后写下的 `node_modules/.nbook-skill-deps.json`。
- **Skill 标签**：提示词里的 `$name` 或 `${名字或 id}`（[`ui/prompt-editor.md`](../ui/prompt-editor.md)）。
- **白名单**：一个 Profile 能用 `$` 带上哪些 Skill。

## 输入与前置条件

**`SKILL.md` 的字段**（Agent Skills 标准的 6 个，加 `when-to-use`）：

| 字段 | 必填 | 规则 |
|---|---|---|
| `name` | 是 | 1–64 个小写字母、数字与连字符，不以连字符开头或结尾，没有连续的连字符；等于目录名 |
| `description` | 是 | 1–1024 字 |
| `license` | 否 | 字符串 |
| `compatibility` | 否 | 至多 500 字 |
| `metadata` | 否 | 字符串到字符串 |
| `allowed-tools` | 否 | 只解析，不生效 |
| `when-to-use` | 否 | 字符串；也认 `when_to_use` |

其余字段忽略。

**来源**：内置的随应用分发；用户的在 `user://skills/<name>/`；插件的在插件包里，由顶层贡献 `agent.skills` 声明（输出 30）。同名的不同来源各是一个 Skill，不互相覆盖。

**依赖**：Skill 目录里有 `package.json` 的要初始化；锁文件只认 `bun.lock`（只有 `bun.lockb`、`package-lock.json` 的按没有锁算）。

**白名单**：Profile 声明 `skills?: {allowed: string[] | "all"}`（[`contributions.md`](contributions.md)），`"all"` 是目录里的全部 Skill；用户在 Profile 设置里按 Profile 增删，存在 `profileSettings` 每项的 `skills?: {added: string[], removed: string[]}`（[`profile-settings.md`](profile-settings.md)）。合成：声明的（`"all"` 时取当前目录的全部 id），加 `added`，减 `removed`。没有声明、用户也没加的 Profile 没有可用的 Skill。内置 Profile 中主创声明 `"all"`，临时帮手不声明（[`builtin-profiles.md`](builtin-profiles.md)）。

**远程**（`nbook.agent` 的远程服务）：查询 `skills()` 与事件 `skillsChanged`；`skillInitPlan({id})`；`initSkill({id, resolve?})`；`openSkillsFolder()`。

**命令行**：`nbook skill init <id> [--yes] [--json]`，不要求应用在运行。

## 输出与可观察行为

### 目录

1. `skills()` 列出全部 Skill，每条 `{id, name, description, whenToUse?, source, location, status, problem?, external?}`：`location` 是 `skills://<id>/SKILL.md`；`problem` 是不可用或上次初始化失败的原因；`external` 是外部依赖的检测结果（输出 4）。
2. 无效的 Skill 只隔离它一个：照样列出，状态 `invalid`，`problem` 写原因，并写一条诊断；别的 Skill 不受影响。算无效的：没有 `SKILL.md`（下一层有的，原因写“可能多套了一层文件夹”）、frontmatter 读不懂、必填字段缺或不合规、`name` 与目录名不同、Skill 目录是链接。可选字段不合规的只忽略那个字段并写诊断，Skill 照常可用。
3. 状态：没有 `package.json` 的是 `ready`。有的看初始化标记：标记的输入与现状一致、平台相同、没有 `error` 才是 `ready`；否则是 `needs-init`，标记里有 `error` 时 `problem` 写这次失败的原因。本应用正在装、或别的进程拿着这个 Skill 的安装锁时是 `initializing`。现状的输入是 `package.json` 里影响安装的字段（各类依赖、`overrides`、`resolutions`、`patchedDependencies`、`trustedDependencies`）与 `bun.lock` 的内容；它们改了，Skill 回到 `needs-init`。
4. 外部依赖只检测、只报告，不改变状态：有 `pyproject.toml`、`requirements.txt`、`uv.lock`，或 Skill 目录两层以内有带 `# /// script` 内联依赖的 `.py` 文件的，`external.python` 为真，`PATH` 上没有 `uv` 时 `external.uvMissing` 为真；`external.compatibility` 是 `compatibility` 的原文。
5. 用户在 `user://skills/` 里加、删、改 Skill，或命令行装好了依赖，不重启应用，`skills()` 很快反映出来，并发出 `skillsChanged`。

### 认标签

6. 提示词里的 Skill 标签按 [`ui/prompt-editor.md`](../ui/prompt-editor.md) 的写法取出：行内代码与代码块里的 `$…` 不算；`$name` 首字符是字母；`${…}` 里首字符可以是数字，可以有 `.`，用来写数字开头的名字与 id。编辑器显示成小块的与服务端认出的是同一套。
7. 一个标签先按 id 认；认不出再在整个目录里按 `name` 认（区分大小写）：同名的里恰好一个在白名单里就是它；不止一个在白名单里是 `ambiguous`；都不在白名单里是 `not-allowed`；没有同名的是 `not-found`。认到的 Skill 是无效的，结果是 `invalid`。按 id 认到、但不在白名单里的，同样是 `not-allowed`。
8. 白名单里的 id 在目录里找不到时不报错：`$` 菜单不列它，Profile 设置里列在“已删除或不可用”一组。

### 这一轮带上 Skill

9. 用户的话、插话、父 Agent 发给子代理的话里有 Skill 标签时，按出现顺序去重，逐个按输出 7 认（白名单取这个会话的 Profile 的）。认到的，这时读它的 `SKILL.md`，写对话事件 `skill{id, name, location, body, truncated}`；正文超过 20,000 token 截断，`truncated` 为真，并写明全文的地址。
10. 位置：用户的话引出的 Skill 是这一轮的附带内容，排在用户的话前面；插话引出的紧跟在这句插话后面。
11. 同一个 Skill 正文没变、上一份还在上下文里时，再次带上只写一条 `skill{id, name, location, sameAs: true}`，不带正文，模型看到的是“Skill「名字」见前文”。压缩之后算不在上下文里。
12. 认不出的写 `skillMissing{token, reason}`，`reason` 是 `not-found`、`not-allowed`、`ambiguous`、`invalid` 或 `unreadable`（读 `SKILL.md` 失败）。模型看到一条 system-reminder，位置同输出 10，写明这个 `$` 没有带上与原因；界面上不另外标出（输出 28）。一个标签失败不影响同一句话里别的标签。
13. 没有初始化的 Skill 照样带上正文。
14. 模型看到的格式：`<skill id="…" name="…" location="skills://…/SKILL.md">` 加正文，末尾说明这个 Skill 的文件在 `skills://<id>/`（shell 里能直接写这个地址），脚本里的相对路径按 Skill 目录算，shell 的工作目录不是 Skill 目录。
15. 已经写下的 `skill` 事件是事实：之后 Skill 改了或删了，已经发出的轮不变；下一次 `$` 或放回时读到新的。

### 压缩之后放回

16. 压缩换掉了对话时（[`compaction.md`](compaction.md) 输出 7、8），在文件与计划之后放回 Skill：从压缩前的路径里找带正文的 `skill` 事件，跳过压缩后仍在上下文里的，最近用过的在前、按 id 去重，读它现在的正文。每个至多 5,000 token，Skill 合计至多 25,000；放回的全部内容（文件、计划、Skill）合计不超过模型窗口的 25%，文件与计划先放，Skill 用剩下的。超了截断，放不下的不放。
17. 放回的 Skill 写成同一种 `notice{code: "restored"}`，`restored` 里一项 `{kind: "skill", target: id, tokens, truncated}`。一个 Skill 读不到或已不在，跳过并写诊断 `restore-skipped`，不影响别的，也不让压缩失败。

### 初始化

18. `skillInitPlan({id})` 交回：要装几个包（按 `bun.lock`；读不了时写“未知”）与直接依赖的名字、要联网、包的安装脚本不会运行；没有 `bun.lock` 时交回直接依赖的个数与名字，并说明会按最新版本解析依赖、生成锁文件。只有来源是 `user`、不是无效的、有 `package.json` 的 Skill 能初始化，其余得 `not-initializable`。
19. `initSkill({id, resolve?})`、Skill 页的“初始化”、`$` 选它时的确认、命令行，做的是同一件事：在 Skill 目录里按 `bun.lock` 安装，不运行安装脚本；没有 `bun.lock` 时要 `resolve: true` 才解析并生成锁文件，否则得 `lock-missing`。成功时写初始化标记，Skill 变成 `ready`；失败时标记的 `error` 写 `{code: "install-failed", detail}`（`detail` 是安装输出的最后几行），Skill 回到 `needs-init`，得 `install-failed`。一次安装至多 10 分钟，超时按失败算。
20. 同一个 Skill 同一时间只装一次：同一个应用里再次请求，并入正在进行的那一次、得到同一个结果；别的进程正在装时得 `busy`。正在装的进程无论怎样结束，锁都会放掉，下一次照常能装。
21. 应用停止时，正在进行的安装被结束，标记的 `error` 写 `{code: "interrupted"}`，请求得 `interrupted`；还没开始装的不装、不写标记，同样得 `interrupted`。命令行收到中断时同样处理。
22. `nbook skill init <id>`：`<id>` 写完整 id，或只写名字（只在来源是 `user` 的里找）；先打出计划（输出 18），在交互终端里确认，非交互又没给 `--yes` 时得 `confirmation-required`；然后按输出 19 安装。`--json` 时输出遵守命令行的机读约定。应用开着时，应用很快看到结果（输出 5）。

### 资源地址

23. `skills://` 的根列出目录里的全部 Skill，每项写 id、名字、说明、状态（无效的写原因），对读它的会话的 Profile 标出“能用 `$`”或“不在白名单”。
24. `skills://<id>/` 是这个 Skill 的目录：能读、能列、能取真实路径（模型能在 shell 里运行它的脚本）；Agent 写入得 `permission-denied`。用户的 Skill 同时在 `user://skills/<name>/`，用户经那里改；两个地址的行锚与授权各按各的地址算。

### 界面

25. 设置里的 Skill 页：按来源分组，我的在前、内置在后；一行一个 Skill，先是名字，下面一行说明（无效的、上次初始化失败的写原因）；状态不是可用时出状态徽标（未初始化、正在初始化、无效）；“初始化”只在未初始化时出现，“打开”常在；许可、兼容性、外部依赖、`metadata`、上次安装的输出（上次初始化失败时）、位置收在行的展开里。徽标与按钮每行落在同一列，没有的那一格空着。页头只有“打开 Skill 文件夹”：用系统的文件管理器打开 `user://skills/` 对应的文件夹（还没有就先建）；应用所在的机器没有桌面（SSH 会话、没有图形会话）时得 `no-desktop`，打开没有成功时得 `open-failed`，两种都发一条通知写出文件夹的路径。没有 Skill 时写一句怎样放进来。
26. 输入框打 `$`：菜单列出白名单里、目录中有、不是无效的 Skill，名字与一行说明；最近用过的在前（本窗口里经菜单选过的，刷新后清空），其余按名字；查询词按名字找，带 `.` 时按 id 找；重名时显示 id（同名的另一个即使无效，只要在白名单里也算重名）；每行行尾留一列状态图标，未初始化、正在初始化的各画一个图标，指针停在图标上时显示它的意思。白名单为空时写一句说明；刚打 `$` 时另带去 Profile 设置的入口，`$` 后面已经有字时不带（回车照常发送）。选了插入 `$名字 `，名字写不出 `$名字` 或有重名时插 `${id} `。
27. 选了未初始化的 Skill 时先问：写明要装几个包（没有锁时是直接依赖，并说明会生成锁文件）、要联网、不运行安装脚本。确认后按输出 19 初始化；装的时候能关掉对话框，安装照常进行，进度与结果见输出 29；失败写原因并能重试。对话框中间一块在确认前与安装中列出直接依赖，失败后是安装输出的最后几行；安装中不显示实时输出。确认、关掉、失败、选“先不初始化”，标签都插进输入框。对话框在确认、正在安装、失败几种状态之间尺寸与版式相同，只换文字与按钮（[UI 规范](../../../packages/nb-ui/docs/ui-development-spec.md)“几何、排版与动效”）。
28. 用户消息里的 Skill 标签照常显示，带上了的与没带上的样子相同；点标签打开它的 `SKILL.md`：用户的经 `user://skills/<名字>/SKILL.md`（能改），其余经 `skills://<id>/SKILL.md`（只读）；标签按名字现认（输出 7，白名单取这个会话的 Profile 的），认不到时提示这个 Skill 已不在或不能用。
29. 应用里开始的初始化（Skill 页、`$` 的确认）登记成一件后台任务（[`workbench/background-tasks`](../workbench/background-tasks.md)）：标题“初始化 Skill 名字”，进展写要装几个包（没有锁时写正在解析依赖），不确定进度，能取消。成功时结束为成功，进展“已可用”；失败时结束为失败，原因“安装没有成功”，详情是安装输出的最后几行，能重试（按同样的 `resolve` 再初始化一次）；用户取消时结束安装，按输出 21 写标记，任务结束为已取消。并入正在进行的那一次的请求不另登记；应用停止时任务按后台任务的规则转为已中断。

### 插件来源

30. 插件用顶层贡献 `agent.skills` 声明插件包里的一个目录：声明是 `{directory}`，写插件包里的相对路径，用 `/` 分段，不是绝对路径、不带协议或盘符、没有空段与 `.`、`..`，不合规的贡献被拒；贡献 id 以插件 id 加 `.` 开头。目录里每个子文件夹是一个 Skill，规则同输出 2，id 是 `<插件 id>.<文件夹名>`，`source` 是 `plugin`，条目另带 `plugin: {id, title}`（`title` 是插件的显示名，没写时为 null）。（planned）
31. 贡献发布后它的 Skill 出现在目录里，并发出 `skillsChanged`；贡献撤回（插件停用、注销）后消失，`$` 认它得 `not-found`。声明的目录不在插件包里、不是目录或经过链接时，这个贡献不出 Skill，写诊断 `skills-root-unavailable`。插件的 Skill 目录不监视：换插件版本要重启。（planned）
32. 插件的 Skill 装好就是 `ready`，不用初始化，请求初始化得 `not-initializable`。Skill 里有 `package.json` 的（插件没经 `nbooke build` 打包）是 `invalid`，原因 `plugin-skill-unbuilt`。（planned）
33. 同一个插件的两个 `agent.skills` 贡献里有同名文件夹时，按贡献 id 的码元顺序先到的生效，后到的不列，写诊断 `skill-duplicate`。（planned）
34. 界面：Skill 页在“我的”与“内置”之间每个插件一组，组头写插件名（没有显示名时写插件 id）；插件的 Skill 没有“初始化”，“打开”经 `skills://<id>/SKILL.md` 只读。Profile 设置的 Skill 一节同样分组。`skills://<id>/` 指向插件安装目录里的这个 Skill，Agent 写入得 `permission-denied`。（planned）

## 状态与转换

| 状态 | 进入 | 离开 |
|---|---|---|
| `ready` | 没有 `package.json`；或初始化成功、标记与现状一致 | `package.json` 或 `bun.lock` 改了 → `needs-init`；文件改坏 → `invalid` |
| `needs-init` | 有 `package.json`，没有标记、标记与现状不一致或带 `error` | 开始初始化 → `initializing` |
| `initializing` | 本应用在装，或别的进程拿着安装锁 | 成功 → `ready`；失败、超时、中断 → `needs-init`（带原因） |
| `invalid` | 输出 2 列出的情况 | 改好 → 按依赖情况进入 `ready` 或 `needs-init` |

时序与寿命：

- 目录在 Agent 插件启动时扫一遍，之后按文件变化重扫变了的 Skill；`skillsChanged` 在重扫完成之后发出，此后 `skills()` 交回新的内容。
- Skill 正文不缓存：每次带上、每次放回都现读；同一轮里两次读到的可能不同，以写进事件的为准。
- 同一个应用里对同一个 Skill 的两次初始化请求得到同一个结果；两个进程同时请求，后到的得 `busy`，不等待。
- 命令行装好之后，应用不用重启：状态变化经输出 5 反映。
- 插件停止时，正在进行的安装结束（输出 21），文件监视停止；停止之后不再发 `skillsChanged`。
- 插件的 Skill 随 `agent.skills` 贡献的发布与撤回出现、消失，变化同样经 `skillsChanged` 通知；撤回在发布之后才到时，按撤回算。（planned）

## 副作用与数据

- **初始化标记** `node_modules/.nbook-skill-deps.json`：`{schema: 1, runtime: "bun", inputs, platform, bun, installedAt, error?}`，`error` 是 `{code: "install-failed", detail}` 或 `{code: "interrupted"}`。`inputs` 是输出 3 所说输入的哈希，`platform` 含操作系统与 CPU 架构，`bun` 是装它的 Bun 版本。标记与 `node_modules` 同生共死，不写进 Skill 的源文件；不认识的 `schema` 按没有标记算，下次初始化时改写。
- **锁文件**：状态根下 `agent/skills/locks/<id>.lock`，按 Skill 分文件，建好不删；锁靠系统的文件锁，不靠文件存在与否。
- **生成的锁文件**：`resolve: true` 时在 Skill 目录写 `bun.lock`，之后都按它装。
- **会话日志**：`skill`、`skillMissing` 事件，放回的 `notice` 与 `compaction.restored` 里的 Skill 项。
- **诊断**：无效的 Skill、可选字段不合规、`restore-skipped`。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `skill-not-found` | 没有这个 id | 刷新目录 |
| `not-initializable` | 不是 `user` 来源、无效，或没有 `package.json` | 不用初始化；无效的先按 Skill 页写的原因改好 |
| `busy` | 别的进程正在装这个 Skill | 等它装完再看状态 |
| `lock-missing` | 没有 `bun.lock`，又没给 `resolve: true` | 告诉用户会生成锁文件，确认后带 `resolve: true` 重试 |
| `install-failed` | 安装失败或超时 | 看原因，修好网络或依赖后重试 |
| `interrupted` | 应用停止或命令行被中断 | 重试 |
| `confirmation-required` | 命令行在非交互环境里没给 `--yes` | 加 `--yes` |
| `permission-denied` | Agent 写 `skills://` | 用户的 Skill 经 `user://skills/` 改 |
| `no-desktop` | 应用所在的机器没有桌面，打不开文件管理器 | 按通知里的路径自己打开 |
| `open-failed` | 有桌面，但系统的打开程序起不来 | 同上；原因在通知的详情里 |

标签认不出（输出 12）不是失败：这一轮照常进行，只是不带那个 Skill。

## 边界与兼容

- 公开格式：`SKILL.md` 的字段（输入与前置条件）；初始化标记 `schema: 1`；Profile 声明的 `skills`、`profileSettings` 的 `skills`；远程的查询、事件与失败码；命令行；`skills://<id>/` 的地址形式。
- 信任：默认信任 Skill 的作者。Skill 的脚本只经模型的 shell 运行，受工具授权管（[`permissions.md`](permissions.md)）；安装时从不运行包的安装脚本。

## 验收与 Smoke

1. Given `user://skills/` 里一个合法的、一个 `name` 与目录名不同的、一个多套了一层文件夹的；Then 目录里一个可用、两个 `invalid` 各带原因，诊断里各一条；When 改好；Then 不重启就变成可用。
2. Given 主创的会话；When 输入框打 `$`、选一个 Skill 发出去；Then 模型收到的这一轮里 Skill 正文在用户的话前面；When 改它的 `SKILL.md`；Then 已经发出的那一轮不变，下一次 `$` 用新的。When 运行中插话带 `$x`；Then 正文紧跟在这句插话后面。
3. Given 一个不存在的 `$x`、一个不在白名单里的、一个重名的；When 发出去；Then 都不带正文，`skillMissing` 各写原因；行内代码里的 `$HOME` 不算标签。
4. Given 带 `package.json` 与 `bun.lock` 的 Skill；Then 它是 `needs-init`；When 初始化；Then 后台任务里有一件“初始化 Skill”在跑，之后装好、标记写下、变成 `ready`、任务结束为成功，模型经 shell 运行它的脚本能导入依赖；When `bun.lock` 改了；Then 回到 `needs-init`。
5. Given 另一个进程拿着某个 Skill 的安装锁；When 在应用与命令行里初始化它；Then 都得 `busy`，状态是 `initializing`；When 拿锁的进程被杀；Then 再初始化能成功。
6. Given 用过两个 Skill 的会话；When 压缩；Then 放回里有这两个 Skill 的现行正文，各不超过 5,000 token；这一轮里刚用过、仍在上下文里的不放第二份；64k 窗口时放回合计不超过窗口的 25%。
7. Given Profile 设置里去掉一个 Skill；Then `$` 菜单不再列它，打它的名字得 `not-allowed`。
8. Given 同一个会话；When 连续两轮 `$` 同一个没改过的 Skill；Then 第二轮只带“见前文”。

9. Given 一个用 `nbooke build` 构建、带一个 Skill 的插件，Skill 的脚本用到一个 npm 包；When 装好、重启；Then Skill 页的插件组里有它、可用；`$` 带上它的正文，模型经 shell 运行它的脚本得到那个包的输出；When 停用插件、重启；Then 它不在了。（planned）

Smoke：`packages/neuro-book/e2e/agent-skills.e2e.ts`（场景 2、3、4 在界面上的部分：经菜单选了发出、不存在的标签、确认后安装）；插话、白名单与重名、停止时中断由 `skills.test.ts`、`install.test.ts`、`catalog.test.ts` 覆盖。

## 实现合同

- **公开入口**：远程 `skills`、`skillsChanged`、`skillInitPlan`、`initSkill`、`openSkillsFolder`（`nbook.agent` 的会话合同）；Profile 声明的 `skills`（`agent.profiles`）与 `profileSettings[key].skills`；地址 `skills://`；扩展 `nbook.agent.skills`（事件 `skill`、`skillMissing`）；命令行 `nbook skill init`；`$` 标签的写法与分词经 `@notnotype/nb-markdown/prompt-text`（`promptSkillTokens`、`promptSkillText`）。
- **owner 与依赖方向**：`nbook.agent` 的服务端持有 Skill 目录、初始化与带上、放回；初始化登记到 `nbook.tasks` 的后台任务（可选依赖，没有时照常装）；`skills://` 是 `nbook.files` 的挂载；跨进程锁取自 `@notnotype/nb-flock`，放回接在 nb-harness 内核的放回参数（`kept`）之后。浏览器端的 `$` 菜单、确认框、Skill 页与 Profile 页一节在 Agent 插件的 `web/`，菜单行尾的状态列在 nb-ui 的 `SuggestionMenu`。
- **关键不变量**：
  - 认 `$` 标签只有一个规则（`shared/skills.ts` 的 `matchSkillToken`）：服务端带上、菜单插入的写法与点开标签共用，菜单插入的文字经同一套分词读回同一个 Skill（`catalog.test.ts`“认标签”，`skill-menu.test.ts`“插入的标签分词读回同一个 Skill”）。
  - 同一个 Skill 同一时间只装一次：进程内并入，跨进程靠按 Skill 分文件的系统文件锁（锁文件建好不删）；停止或取消在任一步到达都结束这次安装，锁只在一处放（`install.test.ts`“同一个进程里同时请求两次”“场景 5”“输出 21”“用户取消”）。
  - 目录的重扫一个接一个地做，每次之后对齐监视器；子目录被替换时重建它的监视器（`catalog.test.ts`“场景 1”）。
  - 正文不缓存，带上与放回时现读；“见前文”按截断后正文的哈希比对，压缩后复位（`skills.test.ts`“场景 2、8”）。
  - 放回的预算按包好之后的整段算，截断后正文不到 400 token 不放（`restore.test.ts`）。

## 证据

- 批准依据：[t15 的决定](../../../.agents/works/w00032-agent-integration/tasks/t15-skills/README.md#决定)与[计划](../../../.agents/works/w00032-agent-integration/tasks/t15-skills/plan.md)；开发者 2026-11-10 确认计划，2026-11-13 批准晋升为 `implemented`。
- 实现入口：[`backend/skills/catalog.ts`](../../../packages/neuro-book/src/plugins/agent/backend/skills/catalog.ts)、[`install.ts`](../../../packages/neuro-book/src/plugins/agent/backend/skills/install.ts)、[`extension.ts`](../../../packages/neuro-book/src/plugins/agent/backend/skills/extension.ts)、[`restore.ts`](../../../packages/neuro-book/src/plugins/agent/backend/skills/restore.ts)、[`shared/skills.ts`](../../../packages/neuro-book/src/plugins/agent/shared/skills.ts)、[`web/skills.ts`](../../../packages/neuro-book/src/plugins/agent/web/skills.ts)、[`cli/skill.ts`](../../../packages/neuro-book/src/cli/skill.ts)
- 合同测试：[`catalog.test.ts`](../../../packages/neuro-book/src/plugins/agent/backend/skills/catalog.test.ts)、[`install.test.ts`](../../../packages/neuro-book/src/plugins/agent/backend/skills/install.test.ts)、[`restore.test.ts`](../../../packages/neuro-book/src/plugins/agent/backend/skills/restore.test.ts)、[`skills.test.ts`](../../../packages/neuro-book/src/plugins/agent/skills.test.ts)（真实内核与本机假端点）、[`skill-menu.test.ts`](../../../packages/neuro-book/src/plugins/agent/skill-menu.test.ts)、[`skills-page.dom.test.ts`](../../../packages/neuro-book/src/plugins/agent/web/skills-page.dom.test.ts)、[`profile-view.test.ts`](../../../packages/neuro-book/src/plugins/agent/web/profile-view.test.ts)
- Smoke：[`agent-skills.e2e.ts`](../../../packages/neuro-book/e2e/agent-skills.e2e.ts)
