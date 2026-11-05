# nbdev 命令行合同

`nbdev` 是 Agent 用的入口；面板（后续）与它共用 `src/core/` 的同一套实现。命令行在任何 checkout 里都能运行：它用 `git worktree list` 找到主工作区，记录一律读写主工作区。

## 安装与调用

- 用户级入口 `~/.local/bin/nbdev` 是一个 shim，由 `bun run --cwd packages/dev-panel install-shim` 写入，内容只有 `exec <bun 的绝对路径> "<主工作区>/packages/dev-panel/src/cli.ts" "$@"`。shim 跑的是主工作区里的代码：worktree 分支里可能没有这个命令，或者是旧版本。
- 没装 shim 时直接运行 `bun <主工作区>/packages/dev-panel/src/cli.ts <命令>`。不要用 `bun run --cwd`：它会把 cwd 换成包目录，命令行就不知道调用者在哪。
- `install-shim` 的参数：`--bin-dir <目录>`（缺省 `~/.local/bin`）、`--target <checkout>`（缺省主工作区）、`--force`（覆盖不是本脚本写的同名文件或符号链接；目标是目录时一律不覆盖）、`--json`（`schema` 为 `nbdev.install-shim/v1`）。相对路径按当前目录解析；经 `bun run --cwd packages/dev-panel install-shim -- …` 调用时当前目录是包目录，所以 `--bin-dir`、`--target` 最好写绝对路径。
- 另外几个包脚本也不进 nbdev 的命令面（它们是开发者用的，不是 Agent 用的）：`audit-init` 初始化审计目录（`nbdev.audit-init/v1`，见 [panel.md](panel.md#审计)），`install-service` 把面板装成 systemd 用户服务（`nbdev.install-service/v1`，见 [panel.md](panel.md#常驻t11)），`service`（与便捷入口 `service:status`、`service:start`、`service:stop`、`service:restart`、`service:logs`）管理装好的服务（不带 `--json`，systemctl、journalctl 的输出直接到终端、退出码照传，见 [panel.md](panel.md#常驻t11)）。

## 命令

| 命令 | 参数 | `schema` |
|---|---|---|
| `nbdev work new <slug>` | `--title`、`--goal`、`--task <slug>` 必填；`--task-title`（缺省用 Work 标题）、`--issue <正整数>`、`--status`（首个 Task 的状态，缺省 `planned`）、`--no-lease`、`--as` | `nbdev.work-new/v1` |
| `nbdev task new <workRef> <slug>` | `--title` 必填；`--goal`、`--status`、`--no-lease`、`--as` | `nbdev.task-new/v1` |
| `nbdev work status <workRef> <status>` | `--include-uncommitted` | `nbdev.work-status/v1` |
| `nbdev task status <workRef> <taskRef> <status>` | `--include-uncommitted`、`--as` | `nbdev.task-status/v1` |
| `nbdev lease take <workRef> <taskRef>` | `--as` | `nbdev.lease-take/v1` |
| `nbdev lease list` | `--work <workRef>`、`--task <taskRef>`（要求同时有 `--work`；与 `status` 一样，找不到报 `work_not_found`、`task_not_found`）、`--all` | `nbdev.lease-list/v1` |
| `nbdev release [<workRef> <taskRef>]` | `--as` | `nbdev.release/v1` |
| `nbdev registry import` | 无 | `nbdev.registry-import/v1` |
| `nbdev status` | `--work <workRef>`、`--task <taskRef>`（要求同时有 `--work`） | `nbdev.status/v1` |
| `nbdev artifact publish <workRef> <taskRef> <artifactId>` | `--kind`（第一次必填：`design`、`report`、`review`）、`--title`、`--entry`（缺省 `index.html`）、`--include <路径>`（可重复，相对产物目录）、`--keep <题号>`（可重复）、`--force-version`、`--as` | `nbdev.artifact-publish/v1` |
| `nbdev artifact close <workRef> <taskRef> <artifactId>` | `--as` | `nbdev.artifact-close/v1` |
| `nbdev ask <workRef> <taskRef>` | `--id`、`--type`、`--label`，`--option <值>[=<名称>]`（可重复，或 `@review`）、`--required`（题缺省是选答；`--optional` 还收，不起作用）、`--recommend <值>`（可重复）、`--artifact <artifactId>`、`--about <路径>`；或 `--from <JSON 文件>`（不与单题参数混用）；`--as` | `nbdev.ask/v1` |
| `nbdev ask withdraw <workRef> <taskRef> <提问>` | `--as` | `nbdev.ask-withdraw/v1` |
| `nbdev ask supersede <workRef> <taskRef> <提问>` | `--by <提问>` 必填、`--as` | `nbdev.ask-supersede/v1` |
| `nbdev answers [<workRef> [<taskRef> [<artifactId>]]]` | `--pending` 或 `--unacked`；`--wait`、`--timeout <秒>`、`--since <答复 id>`（`--wait` 不与 `--pending` 同用）；`--as` | `nbdev.answers/v1` |
| `nbdev answers ack <workRef> <taskRef> <artifactId>` | `--through <cursor>`、`--include <路径>`（可重复）、`--as` | `nbdev.answers-ack/v1` |
| `nbdev answers record <workRef> <taskRef> <artifactId>` | `--set <题号>=<值>`（可重复，至少一个；`multi` 用逗号分隔，`confirm` 写 `yes` 或 `no`）、`--comment <题号>=<文字>`（可重复）、`--note`、`--as` | `nbdev.answers-record/v1` |
| `nbdev panel serve` | `--host`（只接受 `127.0.0.1` 与 `localhost`，缺省 `127.0.0.1`）、`--port`（缺省 4400）、`--artifact-port`（缺省 4401）、`--no-build`（不构建，用现有的 `dist/web`）或 `--static-dir <目录>`（用现成的前端产物） | `nbdev.panel-serve/v1` |
| `nbdev panel open` | `--print`（只打印登录链接，不打开浏览器） | `nbdev.panel-open/v1` |
| `nbdev dev start` | `--checkout <key 或路径>`（缺省调用者所在的 checkout）、`--package`（缺省 `packages/neuro-book`）、`--script`（缺省 `dev`）、`--work <workRef> --task <taskRef>`（日志放进这个 Task）、`--ready-pattern <正则>`、`--ready-timeout <秒>`（缺省 180）、`--sample`（让应用准备样例数据，见“开发服务”的“样例”）、`--sample-timeout <秒>`（只与 `--sample` 一起给，缺省 60）、`--grace <秒>`（停时的宽限期，缺省 10）、`--as` | `nbdev.dev-start/v1`（长命令，见“开发服务”） |
| `nbdev dev status` | `--checkout`、`--package`、`--script`、`--all`（全部 checkout）、`--wait-ready`、`--timeout <秒>` | `nbdev.dev-status/v1` |
| `nbdev dev stop [<runId>]` | 不给 runId 时按 `--checkout`、`--package`、`--script` 找；`--force`、`--grace <秒>`、`--as` | `nbdev.dev-stop/v1` |
| `nbdev worktree new <workRef> <taskRef>` | `--slug <短名>`（缺省 Task 的 slug）、`--type`（缺省 `feat`）、`--from`（缺省 `master`）、`--as` | `nbdev.worktree-new/v1` |
| `nbdev find <词>` | `--in <checkout key 或 all>`（缺省 all）、`--name`（只找文件名，不跑内容搜索，条数与截断只算文件名）、`--limit <n>`（每个 checkout，缺省 20） | `nbdev.find/v1` |
| `nbdev shot [-- <参数…>]` | `--checkout`、`--package`（缺省 `packages/neuro-book`）、`--work <workRef> --task <taskRef>`、`--url <地址>`、`--page <同源路径>`（截产品页面，交给 `page:shot`）；`--` 之后的参数原样交给 `lab:shot`（带 `--page` 时交给 `page:shot`） | `nbdev.shot/v1` |

- `workRef` 是完整 id（`w00022-dev-panel`）或编号（`w00022`）；`taskRef` 是完整 id 或编号（`t06`、`t100`）。
- `<提问>` 写 `<artifactId>#<题号>`；Task 提问集里的题可以只写题号。`--by` 另可写 `<workRef>/<taskRef>/<artifactId>#<题号>` 指向别的 Task。
- 每个命令都接受 `--json`。

### 写什么

- `work new`：领下一个 Work 号，在主工作区建 Work README（`status: active`、`updated`、“目标”一节）与首个 Task README（`status: planned`、`updated`），在 `master` 上提交这两个文件。
- `task new`：领该 Work 的下一个 Task 号，建 Task README 并提交。Work README 必须已提交到 `master`（否则 `work_not_committed`）；记录还在分支上维护的 Work 也一律写进 `master`。不改 Work README。
- `work status`、`task status`：只改 frontmatter 的 `status` 与 `updated` 两行并提交。取值与现值相同时不写不提交。记录来自分支、或 Work README 未提交时拒绝。目标文件是暂存区里一次改名或复制的一端时一律拒绝（`staged_rename`：只提交它会拆开那次改名）。目标文件在主工作区有未提交改动时默认拒绝（`uncommitted_changes`，`details` 带 `currentHash`、`status`、`staged`（`git diff --cached`）、`unstaged`（`git diff`）、`untracked`），`--include-uncommitted` 才连同这些改动一起提交。调用方给了期望的哈希（面板）时先比哈希、再查未提交改动。
- `registry import`：按扫描结果补登 `imported` 条目，只写 `.local/agent/registry.json`，可以重复运行。
- `status`：只读，不取锁，不写任何文件，不加载页面解析器；herdr 只调只读方法，总时限 2.5 秒。
- `artifact publish`：页面文件由会话直接写在主工作区的产物目录里；在写事务的锁内读上一版、从入口等种子出发按引用算出文件集、解析文件集里页面的提问标记、算 `contentHash`、生成新的题表，写 `versions/v<N>.json`，与文件集里 Git 有变化的文件（不含删除项与 `answers/`）一起提交。没被引用、也没被跟踪的文件不提交，给 `unreferenced_files_not_committed`；页面要用的就在页面里引用，或用 `--include` 列出（列过的记进发布记录的 `files`，以后不用再列）。`--include` 的文件不存在、被 Git 忽略或在 `versions/`、`answers/` 里时报 `usage`，不写任何东西。文件集的规则见 [文件格式](file-formats.md#发布记录-versionsvnjson)。内容与题都没变时不出新版本（`unchanged: true`），`--force-version` 照样出。格式与题表规则见 [文件格式](file-formats.md#产物)。
- `artifact close`、`ask`、`ask withdraw`、`ask supersede`：各写一版新的发布记录，沿用上一版的内容字段，页面不重新解析。`ask` 不给 `--artifact` 时记进 Task 的提问集（`artifacts/questions/`，第一次登记时建它）；指向已关闭的产物报 `artifact_closed`。Task 的提问集不能 `artifact close`（`usage`）：它不能发布，关了就没法重新打开，不要的题逐题 `ask withdraw`。`--about` 只校验路径格式，主工作区与调用者的 checkout 里都找不到时给 `about_not_found` 警告。
- `panel serve`、`panel open`：见 [面板](panel.md)。`panel serve` 在前台运行，收到 SIGINT、SIGTERM、SIGHUP 时收口退出（退出码 0）。
- `answers record`：写一份代录的答复（`submittedBy.kind: "agent-transcribed"`）；`--set`、`--comment` 的题号不合格式、或同一道题给了两次时报 `usage`。`answers --since` 不是答复 id 的写法时报 `usage`。`answers ack`：写一份确认，并把 `--include` 列出的记录（相对主工作区根，只收 `.agents/works/` 下的普通文件；目录与被 `.gitignore` 忽略的文件在写任何东西之前报 `usage`）放进同一个提交。`--through` 填读答复时输出里的 `cursor`：只确认 id 不大于它的未确认答复（同一个 `answers/` 目录里 id 在锁内单调生成，不大于游标就是会话读之前已落位），比它新的留着、给 `newer_answers_unacked`。不给 `--through` 时确认锁内看到的全部未确认答复，其中可能有会话没读过的，给 `ack_without_through`。要确认的答复为空时不写，给 `already_acked`，`--include` 的文件也不提交；但有上次提交失败的残留时照样把残留与 `--include` 的文件一起补交（见下文“提交失败后的补救”）。
- 这些写入都要求：Work README 与 Task README 已提交到 `master`（否则 `work_not_committed`、`task_not_committed`）；Task 的来源是 `master`（判定同 `task status`：来自分支的 Work 里，只在 `master` 上的 Task 或经 nbdev 领号的 Task 可以写，否则 `branch_maintained_record`）。发布、答复、确认都不改 Task README 的 `updated`。
- 写完之后续期调用者在这个 Task 上的租约，再把“谁写的”记进运行时的 provenance（见 [文件格式](file-formats.md#provenance)）；入库的文件里没有会话。
- 写进记录的文字（标题、目标、说明、备注、文字答复）拒绝 C0 控制字符（允许制表符）；换行只在正文类字段里允许，标题必须是一行。标题报 `invalid_title`，其余报 `invalid_text`（`details.field`）。面板的写接口用同一份规则。
- 每次写事务在 `git add` 之前重读本次写入的每个文件：与写入的内容不同（别的进程在落位之后又改了它）就不提交，报 `changed_after_write`（`details.writtenPaths`），文件留在工作区；提交里混进了不是这次写的内容时给 `commit_included_foreign_changes`。

### 开发服务、worktree、查找与截图（t14）

**`dev start`** 自己就是监管进程，留在前台，由 Agent 的后台机制托管（Claude Code 的 `run_in_background`、omp 的 `proc://`），会话结束时随会话退出（全局规则“后台与长驻进程”）。要活过会话的服务不在本命令范围内。它的输出不要接 `head` 之类会提前关闭管道的命令，否则开发服务随之退出；要看启动输出就放后台，或者读它的日志文件。

- **起法**：在 `<checkout>/<package>` 里运行 `setpriv --pdeathsig TERM -- setsid bun run <script>`。服务的 stdout、stderr 直接是日志文件的描述符，监管进程不在了也不会 BrokenPipe。找不到 `setpriv` 或 `setsid` 报 `tool_missing`，`package.json` 里没有这个脚本报 `script_not_found`，`package.json` 不是合法 JSON 报 `invalid_record`（`details.path`）。
- **日志**：带 `--work --task` 时是主工作区 `.local/agent/works/<W>/tasks/<T>/logs/<runId>.log`，否则是 `.local/agent/logs/dev/<checkout key>-<runId>.log`，独占创建；不自动清理。
- **就绪**：
  - 读日志的新增部分，`\r` 与 `\n` 都算行尾，去掉 ANSI 的 CSI 与 OSC；
  - 内置两种就绪行：w00017 一系的 `[dev] page-ready <url>`（就绪以随后的 `[dev] backend-ready` 为准），以及 listhen 的 `➜ Local: <url>`（master、nb-ui 与 Lab 的 Nuxt）；`--ready-pattern` 给了就只认它，第一个捕获组是地址；
  - 认出地址之后 HTTP 探测，2xx、3xx、4xx 算就绪，5xx（nuxi 构建失败时对每个请求回 500）继续探测。
- **输出**：长命令，不套一次性的外壳。stdout 是按行的事件，`--json` 时每行一个 JSON 对象（`event` 字段）：
  - `READY <url> run=<runId> [reused] [owner=<会话键>]`（`ready`）；
  - `NOT_READY <日志> run=<runId> [status=<最后一次的状态码>] [reused]`（`not_ready`）：到 `--ready-timeout` 还没就绪，服务照留、照常监管。监管进程之后照样读日志、探测（探测放慢到 2 秒一次），就绪时补写登记的 `url`、`readyAt`，**再打一行 `READY`**：`NOT_READY` 之后可能还会有 `READY`；
  - `EXITED <退出码或信号> run=<runId> [leftovers=<n>]`（`exited`）：服务退出，`leftovers` 是组长退出后补收的进程数（快照里与进程组里还活着的，按 pid 去重）。
  - `SAMPLE <地址> run=<runId>`（`{"event": "sample", "url", "runId"}`）与 `SAMPLE_FAILED <原因> run=<runId>`（`{"event": "sample_failed", "reason", "runId"}`）：只在带 `--sample` 时出现，见下面的“样例”。
  - 起来之前就失败（参数、checkout、脚本、工具）照常输出错误外壳与退出码。
- **样例**（`--sample`，t18）：让应用在开发服务里准备一份样例数据，告诉 nbdev 打开它的地址。约定只有下面三条，任何应用都可以按它实现；应用知道样例是什么、放在哪、怎样算准备好，nbdev 不知道应用的路由。
  - nbdev 给开发脚本的环境设 `NBDEV_SAMPLE=1`；不带 `--sample` 时从环境里去掉 `NBDEV_SAMPLE`，所以登记里的 `sample` 就是应用实际收到的。
  - 应用准备好之后在日志里打一行 `[dev] open-path <同源路径>`（例如 `[dev] open-path /?project=sample`）；失败或超时打一行 `[dev] sample-failed <原因>`，服务照常运行。“本代”的结果是最后一行 `[dev] backend-ready` 之后的第一行结果（日志里没有 `backend-ready` 的应用从头算）；后端重启（新的一行 `backend-ready`）就是新的一代。
  - nbdev 用 `new URL(<同源路径>, <READY 的地址>)` 拼出地址。路径是绝对 URL、以 `//` 开头、含反斜杠，或拼出来与 `READY` 的地址不同源，就当作失败，原因是“open-path 不是同源路径：<路径>”。

  样例结果不与 `READY` 绑在一起：应用在服务就绪之后才在后台准备，结果可能比 `READY` 晚到。何时打：
  - 新起的服务：`READY` 之后接着读日志，读到本代的结果就打 `SAMPLE` 或 `SAMPLE_FAILED`；`READY` 之后到 `--sample-timeout` 还没有结果就打 `SAMPLE_FAILED`，原因是“应用没有报告样例结果（不支持 NBDEV_SAMPLE，或还没准备好）”，这一代之后再到的结果不补打。时限只算开始读时的那一代：它还没报结果后端就重启了，就不再计时，不会把超时记到新的一代上。之后后端每重启一代、报了结果就再打一行；一次读到几代的输出，每一代的结果都各打一行。
  - 复用的服务：打过 `READY` 之后只读开始读时日志末尾的 4 MiB（读到开始读时的长度为止，之后写进来的不算），找最后一行 `backend-ready` 之后的结果，有就立刻打；没有就接着读新写入的，到 `--sample-timeout` 打上面那条 `SAMPLE_FAILED`；打过一行就以 0 退出。复用的服务起时没有带 `--sample` 时，应用不会报结果，立即打 `SAMPLE_FAILED`（原因“复用的服务起时没有带 --sample，应用没有准备样例”）。等的时候它结束了就打 `EXITED`、以 1 退出（与等就绪时一样）。
  - 没有 `READY` 就不打；`EXITED` 之后不再打。样例失败不改变退出码。
- **监管进程的退出码**：服务被 `dev stop` 或信号停掉为 0；服务自己退出为 1（`dev_exited`，不论之前有没有就绪）；停完核对不过为 1（`stop_incomplete`）。服务自己的退出码只在 `EXITED` 行里。
- **复用**：键是（checkout、package、script）。
  - 只复用组长还活着的同键运行（状态 `starting`、`running`，或 `orphaned` 且原因是 `supervisor_gone`）。`leader_exited`（开发脚本已退、只剩没收掉的进程）的服务早就不在了：先按下面的停法收掉（监管进程不在，按属主判据不要 `--force`），给 `leftovers_stopped`，再起新的；收不干净报 `stop_incomplete`。
  - 在 `run/procs/` 的锁里查，有能复用的就不起新的，按同一套就绪规则读它的日志、打 `READY` 或 `NOT_READY`，带 `reused`，退出码 0；认出就绪时把 `url`、`readyAt` 写回登记（只在还没有 `readyAt` 时写）。等的时候每秒重读登记，复用的服务在就绪之前结束了就打 `EXITED`（退出码取它登记里的，监管进程还没写时为空）、以 1 退出，不再等满时限；没有就在锁里起服务、写好含 pid 的登记再放锁，两个会话同时起只有一份。
  - 登记里已就绪的，先按就绪的判据探测一次地址：连得上才打 `READY … reused`；连不上报 `dev_unresponsive`（3），不替别人停服务，按提示先 `dev stop` 再起（不是你起的、属主还在要加 `--force`）。
  - 复用别人起的给 `reused_other_owner`（它随属主的会话结束而停，要独立的一份请换 checkout）；复用没人监管的（`supervisor_gone`）给 `supervisor_gone`（用完请 `dev stop`）；给的 `--ready-pattern`、`--work --task` 与它起时不同，或带不带 `--sample` 与它起时不同，给 `reused_with_different_options`（`details.differences` 列出 `ready-pattern`、`work/task`、`sample`）。
- **停法**（`dev stop`、监管进程收到 SIGTERM、SIGINT、SIGHUP，以及组长自己退出之后的补收，都用同一套）：
  1. 先写登记的 `stoppingAt`、`stoppedBy`；
  2. 组长还在就**只给组长发 SIGTERM**（`bun run` 转给开发脚本，按它自己的顺序收口：master 的 source-dev 经 owned-process 收掉另一个会话里的运行时）；组长已不在就给进程组与后代快照里还活着的发 SIGTERM；
  3. 宽限期内每 250 毫秒重收后代，到期对快照里仍活着、启动时刻对得上的进程逐个 SIGKILL，再对进程组 SIGKILL；
  4. 快照与进程组都不在、就绪地址连不上才算停干净，否则报 `stop_incomplete`，列出残留的 pid。还有进程没收掉时登记不记为结束，状态是 `orphaned`，可以再 `dev stop`；只是地址仍有回应、我们的进程都不在时照记为结束（见 [文件格式](file-formats.md#进程登记)）。

  只碰登记的组长、它的进程组与收集到的后代快照，每个都核对 pid 与启动时刻；进程组按 [file-formats.md](file-formats.md#进程登记) “还活着”里的判据确认仍是我们那一组才发信号（组号可能已被别的组长复用）；不按命令行文本找进程。Claude Code 的 TaskStop 给整棵树同时发 SIGTERM、约 1.5 秒后整棵 SIGKILL，所以收到信号时先写登记、再发 SIGTERM，剩下的尽力而为。
- **`dev stop` 与属主**：已结束的（含 PID 被复用、重启过）不发任何信号，只补 `endedAt`，回 `skipped`。下面任一条成立就不要 `--force`：监管进程不在（没人监管）、属主会话已不在、调用者就是属主；否则报 `run_owned_by_other`（`details.owner` 写明属主）。认不出的调用者可以起服务（登记的 `startedBy` 为 null），停这样的、监管进程还在的服务要 `--force`。
- **`dev status`**：缺省列出调用者所在 checkout 上还活着的与 24 小时内结束的运行，`--all` 列全部 checkout。状态见 [文件格式](file-formats.md#进程登记)。`--wait-ready` 等这份服务就绪，超时报 `dev_not_ready`（退出码 4），没有这份服务报 `run_not_found`。

**`worktree new`**：按 Work 规则“创建与执行”一节建 `.worktree/<Work 编号>-<Task 编号>-<短名>` 与分支 `<type>/<Work 编号>-<Task 编号>-<短名>`。

- `worktree add` 一律用 `/usr/bin/git`，直接起子进程、不经 shell：omp 会接管会话 shell 里的 `git worktree add`。`/usr/bin/git` 不存在报 `git_failed`，不退回 `PATH` 里的 git。其余 Git 调用照旧走 `PATH`。
- 路径已存在或分支已存在报 `target_exists`（退出码 3，`details` 写明是哪一个），不自动改名、不覆盖；两个会话同时建同一个，后失败的那一个也报 `target_exists`。
- `--type` 只收根 CONTRIBUTING 的 `feat`、`fix`、`docs`、`refactor`、`test`、`build`、`ci`、`chore`。
- 建好之后在登记表写这个 Task 的 `home`（绝对路径，先补登登记表里没有的 Task）并续期调用者的租约；写 `home` 失败只给 `home_not_written`，不回滚。**不装依赖**，输出最后一行提示 `cd <路径> && bun install`；Task README 的执行位置由会话自己写。

**`find`**：与面板的搜索同一套实现。记录（Work、Task、产物的编号与标题）加各 checkout 里跟踪的与未被忽略的文件的文件名与内容；每个 checkout 缺省 20 条、合计最多 200 条，截断时 `truncated: true`。没有命中也是退出码 0。

**`shot`**：只做薄包装，截图逻辑全在目标 checkout 的包脚本里：缺省是 `lab:shot`（Lab 场景），带 `--page <同源路径>` 时是 `page:shot`（产品页面，t18）。

- 地址：`--url`，没有就取这个 checkout 上经 nbdev 起、能复用（判据同 `dev start` 的复用）、已就绪且地址此刻按就绪判据连得上的服务的地址；都没有报 `dev_not_running`（退出码 5）。
- 输出目录：带 `--work --task` 时是 `.local/agent/works/<W>/tasks/<T>/shots/<UTC 时间>/`，否则是 `.local/agent/shots/<UTC 时间>/`。
- `TMPDIR` 指到 `/dev/shm/nbdev-shot-<随机>`，跑完删掉：`/tmp` 是带配额的内存盘，Chrome 的临时数据会把它占满。
- 参数：交给 `lab:shot` 的是 `--url <地址> --out <目录>`，交给 `page:shot` 的是 `--url <地址> --path <路径> --out <目录>`，再接 `--` 之后的参数，原样、顺序不变（`page:shot` 的点击、等待步骤按出现的顺序执行）。路径是否同源由 `page:shot` 自己核对。
- 不要在 `--` 之后再给 `--out`：输出目录由 nbdev 定，再给一个会让它报 0 个文件。
- 不注入浏览器路径。`package.json` 里没有要用的脚本报 `shot_unavailable`（3，`details.script` 是缺的脚本名 `lab:shot` 或 `page:shot`），`package.json` 不是合法 JSON 报 `invalid_record`（1，`details.path`）；脚本失败报 `shot_failed`（1），带它 stderr 的末尾。

### 会话与租约

- **调用者是谁**（每个命令都在边界上解析一次，`status --json` 的 `data.caller` 给出结果）：
  1. `--as <标签>`：外部会话 `external:<标签>`。标签要唯一，两个外部会话用同一个标签会被当成一个会话；在 herdr pane 里用 `--as` 时不写 pane 标签。
  2. `CLAUDE_CODE_SESSION_ID`：只在 `CLAUDE_PID` 存在、进程还活着、id 是 UUID、并且是调用者进程的祖先时才信，否则给 `claude_env_untrusted` 警告（`details.reason` 为 `invalid` 或 `not_ancestor`）并忽略。环境变量是继承来的：herdr server、tmux 若是从某个 Claude 的 Bash 里起的，里面所有 pane 都会带着那个仍活着的 `CLAUDE_PID`。子代理与 Claude 会话派出的进程（包括 `omp -p`）都继承它，记在同一个会话名下；嵌套的 `claude -p`（外层的 `CLAUDE_PID` 是内层 claude 的祖先）归到外层会话，`parentSessionId` 记外层的 id，`nestedSessionId` 记调用者环境里的内层 id。
  3. 只有 `HERDR_PANE_ID`（omp 等）：用那格 pane 上 herdr 认出的 Agent 会话，进程记 pane 的前台主进程；读不到 pane 的进程信息时进程记 `null`，给 `herdr_partial` 警告。
  4. 都没有：未知调用者。写命令照常完成但不取得租约（`caller_unknown` 警告）；`lease take`、`release` 报 `caller_unknown`。
- **自动取得与续期**：`work new`、`task new` 之后取得新 Task 的租约（提交失败但文件已写、号已领时也取）；`task status` 改成别的状态时续期调用者的租约。例外：`work new`、`task new` 带 `--no-lease`（先记下、还不开工的 Task）时不取得租约、不写 pane 标签，提交失败时也不取，`data.lease` 为 `null`，未知调用者也不给 `caller_unknown`；调用者照常解析，登记表里的 `by` 照记调用者。
- **自动释放**：Task 改成 `done` 或 `shelved` 时释放这个 Task 的全部租约，与由谁调用无关（面板以开发者身份改状态时同样释放）。
- `lease take` 遇到已 `done` 或 `shelved` 的 Task 报 `task_closed`。
- **不带参数的 `release` 释放调用者的全部租约**。子代理与父会话是同一个身份，子代理这样做会释放父会话的全部租约。
- **pane 标签**：调用者在 herdr 里（不是 `--as`）时，取得或续期后给它自己的 pane 写 `work`、`task` 两个 token（`w00022`、`t07`，24 小时后过期）；释放时只有它最近活动的那份有效租约被释放才改写成下一份，没有就清空。别的会话 pane 上的标签不动。写或清之前先用 `pane.process_info` 确认调用者的会话进程（Claude 是外层的 `CLAUDE_PID`，omp 是前台进程组组长）就在这格 pane 的前台：`HERDR_PANE_ID` 与 herdr 记的会话都可能过时（后台会话、被别的会话占用的 pane），不在前台就不写，给 `herdr_tag_skipped`。
- 租约的有效性在读取时现算，规则见 [文件格式](file-formats.md#租约)。

提交消息为 `docs(<Work 编号>): …`，以主工作区的 Git 身份提交，只提交本次事务的路径；主工作区暂存区里别人的改动原样留着。

## `--json` 外壳

stdout 只有一个对象，诊断走 stderr：

```json
{"schema": "nbdev.task-new/v1", "ok": true, "data": {}, "warnings": [], "errors": []}
```

- `warnings`、`errors` 的元素是 `{code, message, details?}`，调用方按 `code` 判断，不看 `message`。
- 不带 `--json` 时，stderr 的 `警告 [<code>] …`、`错误 [<code>] …` 一行之后，下面几种逐条列出明细（缩进两格，最多 20 条，超出的写“另有 N 条，加 --json 看全部”），其余的码只有那一行：
  - `invalid_questions`：`<页面>:<行>:<列> 题 <题号>…原因 [<code>]`，`nbdev ask` 登记的题没有页面与行号，从“题 <题号>”写起；
  - `unreferenced_files_not_committed`：文件路径；
  - `missing_reference`、`reference_outside_artifact`：`<页面>:<行> <引用>`，没有行号时只写页面。
- 不带命令、命令不认识或参数在分派到命令之前就出错时，`schema` 为 `nbdev.cli/v1`（错误码 `usage`，退出码 2）；`nbdev help --json`（或 `--help --json`）同样用 `nbdev.cli/v1`，`data.usage` 是用法文本。
- 写命令的 `data`：`workId`、`taskId`、`paths`、`commit`、`conflicts`（`work new`、`task new` 只列涉及这次领的号的撞号：Work 号按 `wNNNNN`，Task 号按完整 Work id 加 `tNN`）、`otherConflicts`（`work new`、`task new`：与这次领号无关的撞号组数，普通输出写“另有 N 组撞号与这次领号无关，见 nbdev status”；完整列表看 `status` 或 `registry import`）、`registryOnly`（登记表里有、但哪里都找不到的 id；本次刚领的号不算），以及 `lease`（取得或续期后的租约，未知调用者为 `null`）与 `released`（这次释放的租约）。`commit` 是下列之一：
  - `{"committed": true, "sha", "paths", "viaOtherCommit"}`：`viaOtherCommit` 为真表示文件被别的会话不带路径的提交一起带走了，内容已在 `master`；
  - `{"committed": false, "reason": "nothing_to_commit", "paths"}`：写入的内容与 `HEAD` 相同，无需提交；
  - `{"committed": false, "reason": "git_lock_timeout" | "git_failed", "writtenPaths", "detail"}`：文件已写在主工作区但没有提交，退出码 1。不要重跑 `task new`（号已领），先处理 Git 的问题，再手动提交 `writtenPaths`。`git_lock_timeout` 只在等 `index.lock` 约 10 秒仍被占着时出现；其它失败（钩子拒绝、对象库不可写等）是 `git_failed`，`detail` 里有 Git 的输出。Git 退出码 128 而一直没见到 `index.lock` 时，连续 5 次就停止重试。
- 写命令在取锁之前先查 Git 提交身份（`git var GIT_AUTHOR_IDENT`、`GIT_COMMITTER_IDENT`），缺了就报 `git_identity_missing`，不写任何东西。
- 状态命令的 `data`：`workId`、`taskId`、`path`、`previous`、`next`、`changed`、`commit`；`task status` 另有 `lease`、`released`。
- `lease take` 的 `data`：`workId`、`taskId`、`lease`、`released`；`release` 的 `data`：`lease`（`null`）、`released`；`lease list` 的 `data`：`leases[]`（租约加现算的 `state`、`stale`、`managed`）。
- `status` 的 `data`：`mainRoot`、`callerRoot`、`callerBranch`、`caller`、`works[]`（`workId`、`title`、`issueId`、`goal`、`status`、`updated`、`source`、`branch`、`checkout`、`executionRule`、`otherCopies`、`uncommitted`、`activeLeases`、`taskCounts`、`tasks[]`，Task 另有 `leases`）、`conflicts[]`、`registryOnly[]`、`nextWorkNumber`（例如 `w00023`）、`sessions[]`、`unownedRuns[]`、`ignoredProcesses`、`herdr`。`goal`、`status`、`updated` 是 `{value, origin}`，`origin` 的含义见 [文件格式](file-formats.md#记录的读法)。
- `status` 的临时数据（会话结束或进程退出就消失）：
  - `caller`：`{kind: "session", ref, via, process, herdr}` 或 `{kind: "unknown", reason, herdrPaneId}`；
  - `activeLeases`、`leases`：有效租约 `{sessionKey, agent, label, taskId, lastActivityAt, stale}`，`stale` 表示超过 2 小时没有 Task 相关操作（淡化显示）；
  - `sessions[]`：有有效租约或有运行的会话，`{key, agent, sessionId, label, parentSessionId, nestedSessionId, alive, managed, herdr: {paneId, status}, leases, runs}`；`alive` 是会话进程是否还在（不知道时为 `null`），`managed` 表示 herdr 现在的列表里有它（能通知）；
  - 运行 `{pid, startedAt, command, cwd, checkout, owner, ownerVia, paneId, unit, sessionHint, sessionAlive, descendants}`；`unownedRuns` 是普通 shell pane 里起的进程、systemd 服务单元（`systemd-run`）里的进程，以及会话已不在、但带着它的工具标记的进程（`sessionHint` 为标记里的会话键，`sessionAlive` 为 `false`）。归属规则见 [herdr 适配](herdr.md#运行的归属)。
- `status` 的 `data` 另有：
  - `inbox[]`：只放要开发者动手的事，`{kind: "question", workId, taskId, artifactId, artifactTitle, questionId, label, type, version, since, askedBy}`（等开发者答的题，口径见 [文件格式](file-formats.md#状态现算)；`artifactTitle` 是产物最新一版的标题，可能为 `null`；`askedBy` 是运行时的会话键，读不到为 `null`）与 `{kind: "number_conflict", label, live, ids}`（只放正在发生的撞号，只在旧副本里的留在 `conflicts[]`；`ids` 同下面 `conflicts[]` 的元素：各个 id、是否 `live` 与所在位置，首页据此写明撞号的原因）；带 `--work` 时只列范围内的；
  - Task 的 `artifacts[]`：`{artifactId, kind, title, version, state, publishedAt, waiting, adoption}`，没有发布记录的 `state` 为 `unpublished`；Task 与 Work 的 `documents[]`：`{path, title}`；Work 的 `artifacts[]`（Work 级产物，只索引）；
  - Task 的 `updated`：frontmatter 的 `updated`、产物目录与 Task 目录第一层文档（README 之外的 `.md`）最后一次提交的日期中最晚的那个；frontmatter 的值不合规（`origin: invalid`）时原样给出。
- `artifact publish` 的 `data`：`workId`、`taskId`、`artifactId`、`unchanged`、`version`、`path`、`questions`（新版本的全部题）、`dropped`（被这一版取代的题）、`retiredInPage`、`restored`、`committedFiles`、`previous`（`{version, publishedAt, publishedBy}`，`publishedBy` 读 provenance）、`lease`、`commit`、`waitCommand`（这一版有活的题时是等答复的命令 `nbdev answers <W> <T> <产物> --wait`，没有为 `null`；文字输出同样多一行，写怎样挂着等，见 [`answers --wait`](#answers---wait)）。`artifact close`、`ask`、`ask withdraw`、`ask supersede` 的 `data`：`workId`、`taskId`、`artifactId`、`unchanged`、`version`、`path`、`questions`、`affected`、`lease`、`commit`；`ask` 另有 `waitCommand`，同 `artifact publish`。
- `answers` 的 `data`：`artifacts[]` 与 `cursor`（范围内最大的答复 id）。每个产物：`workId`、`taskId`、`artifactId`、`kind`、`title`、`version`、`state`、`publishedAt`、`waiting`、`adoption`（`none`、`waiting`、`adopted`）、`questions[]`（`{question, state, answer, stale}`，`answer` 带 `answerId`、`value`、`artifactVersion`、`submittedAt`、`comment`；`stale` 是按最新一版不合法、作废了的最新答复，字段同 `answer` 外加 `reason`（文案）与 `code`（`stale_value`：按它针对的那一版合法、选项后来改了；`invalid_value`：按那一版也不合法），没有时为 `null`，按 `code` 分支）、`answers[]`、`acks[]`、`unacked[]`、`cursor`。`--pending` 只留有待答的必答题（`open`、必答、不是之前几版的题；口径见 [文件格式](file-formats.md#状态现算)）的产物、题也只留这些；`--unacked` 只留有未确认答复的产物；`--since` 只留有更新答复的产物、答复也只留这些。指定了 Task 时续期调用者的租约。
- `answers ack` 的 `data`：`acked`、`ack`、`path`、`newer`（比 `--through` 新、没有确认的答复 id）、`lease`、`commit`；`answers record` 的 `data`：`answer`、`path`、`lease`、`commit`。
- **提交失败后的补救**：写入的文件已经在主工作区，`data.commit.writtenPaths` 列出它们。`versions/`、`answers/` 只由 nbdev 写，那里还没进 HEAD 的文件（未跟踪或已暂存未提交）只可能是提交失败的残留，所以之后每次写同一个产物（发布、关闭、登记、撤回、取代、代录、确认）都把它们顺带提交，给 `residual_records_committed`。发布、关闭与确认重跑同一条命令即可：内容没变、已经关闭、或答复都已确认时不写新记录，只补交残留（发布连同有变化的页面文件，确认连同 `--include` 的文件）。`ask`、`ask withdraw`、`ask supersede`、`answers record` 不要重跑（会报题号重复、已撤回、已取代，或再写一份），等下一次写这个产物时补交，或手动提交这些路径（`git commit -- <路径>`）。
- `registry import` 的 `data`：`added`、`nextWorkNumber`、`nextTaskNumbers`（按 Work id）、`conflicts`、`registryOnly`。
- `conflicts[]` 的元素：`{kind, label, workId?, live, ids: [{id, live, locations}]}`；`locations` 的元素是 `{source: "main" | "worktree" | "ref", checkout?, ref?, head?}`。一个 id 只出现在 `master` 改名或删除后留下的旧副本里时不算 `live`；一组撞号至少两个 id `live` 时这组 `live`。

## 退出码

| 退出码 | 含义 | 错误码 |
|---|---|---|
| 0 | 成功，含带警告的成功与撞号 | |
| 1 | 运行失败 | `lock_timeout`、`lock_failed`、`lock_compromised`、`cross_device`、`git_failed`、`git_identity_missing`、`commit_failed`、`write_failed`、`schema_unsupported`、`invalid_record`、`number_exhausted`、`build_failed`、`request_aborted`、`herdr_unavailable`、`systemctl_failed`、`journalctl_failed`、`dev_exited`、`stop_incomplete`、`tool_missing`、`shot_failed`、`internal` |
| 2 | 用法错误 | `usage`、`invalid_slug`、`invalid_status`、`invalid_title`、`invalid_text`、`invalid_record_edit`、`caller_unknown`、`invalid_artifact_id`、`invalid_questions`、`invalid_answer`、`unsafe_host`、`payload_too_large`、`unsupported_media_type`、`key_not_allowed` |
| 3 | 需要人决定的冲突 | `main_not_on_master`、`main_busy`、`branch_maintained_record`、`ambiguous_work`、`ambiguous_task`、`work_not_committed`、`task_not_committed`、`target_exists`、`target_missing`、`task_closed`、`hash_mismatch`、`uncommitted_changes`、`staged_rename`、`changed_after_write`、`unsafe_path`、`shim_exists`、`duplicate_question`、`artifact_closed`、`question_closed`、`question_earlier`（之前几版的题，页面上已经没有，只读）、`stale_version`、`not_editable`、`panel_running`、`port_in_use`、`audit_unavailable`、`session_changed`、`not_deliverable`、`agent_busy`、`not_in_repository`、`key_rate_limited`、`service_exists`、`pane_controlled`（这格正被你在面板里接管键盘，t12）、`history_unavailable`（读不了更早的输出：有会话的 Agent pane 里只有 omp 能读，t12；没有会话键的 pane 前台是全屏程序、没有回滚时也是，t15）、`run_owned_by_other`、`dev_unresponsive`、`shot_unavailable` |
| 4 | 等待没有结果（`answers --wait`、`dev status --wait-ready`）：超时或被信号打断 | `wait_timeout`、`wait_interrupted`、`dev_not_ready` |
| 5 | 找不到对象 | `repository_not_found`、`records_root_not_found`、`master_not_found`、`work_not_found`、`task_not_found`、`shim_target_not_found`、`service_not_installed`、`artifact_not_found`、`question_not_found`、`entry_missing`、`no_answers`、`panel_not_running`、`run_not_found`、`script_not_found`、`dev_not_running`、`pane_not_found`（面板的 pane 级接口里，这格 pane 不在了） |

## 警告

| `code` | 含义 |
|---|---|
| `registry_initialized` | 登记表原本不存在，这次按扫描结果整表导入 |
| `unregistered_ids` | 扫描到登记表里没有的号，已补登为 `imported`；说明有人绕过了 nbdev |
| `number_conflicts` | 有撞号，详见 `conflicts`；`status` 只在有正在发生的（`live`）时给，`work new`、`task new` 只在有涉及这次领号的撞号时给 |
| `prunable_worktree` | 某个已登记的 worktree 目录已不存在，跳过 |
| `caller_unknown` | 认不出调用者，没有取得租约 |
| `claude_env_untrusted` | 环境里的 Claude 会话 id 不可信，已忽略 |
| `herdr_unavailable` | 连不上 herdr 或读不出它的 pane 列表；租约照常按会话进程与 24 小时判断 |
| `herdr_partial` | 部分 pane 的进程信息没读到：`status` 按没有这格处理；只靠 `HERDR_PANE_ID` 认的调用者不记会话进程 |
| `herdr_tag_failed` | 写 pane 标签失败，或写之前读 pane 的进程信息失败（只影响显示） |
| `herdr_tag_skipped` | 没有写标签：pane 开在别的仓库里（`details.reason`：`other_repository`，在临时仓库里运行 nbdev 时常见）、herdr 不知道 pane 的目录（`pane_cwd_unknown`）、调用者的会话进程不在那格 pane 的前台（`caller_not_in_foreground`、`caller_process_unknown`）、pane 已不存在（`pane_not_found`） |
| `lease_write_failed` | 取得、续期、释放租约或读调用者自己的租约失败（权限、磁盘满等）；记录操作不受影响，命令照常成功并带回 `data.commit` |
| `lease_release_skipped` | Task 改成 `done` 或 `shelved` 之后、释放租约之前，别的会话又把它改回去了，这次不释放 |
| `unreadable_lease` | 某个租约文件（或整个租约目录）读不了或内容不合规，已跳过 |
| `worktree_skipped` | 某个 worktree 读不出相对 master 的记录改动（HEAD 还没有提交、与 master 没有共同祖先、浅克隆截断了历史），跳过；`details.reason` 写明原因 |
| `uncommitted_branch_records` | 某个 worktree 只有未提交的记录改动，没有算作“来自分支” |
| `invalid_status_value` | 记录的 `status` 不在取值集合里 |
| `unreadable_record` | README 缺失或 frontmatter 无法解析 |
| `main_not_on_master` | `status` 时主工作区不在 `master`，照常读工作区 |
| `commit_via_other_commit` | 本次的文件被别的提交带走 |
| `commit_paths_mismatch` | 本次提交的路径与预期不一致 |
| `commit_included_foreign_changes` | 提交里有不是这次写的内容：落位后的核对通过之后、`git add` 之前别的进程又改了这个文件（`details.paths`） |
| `lock_release_failed` | 放锁失败 |
| `lock_release_skipped` | 放锁时锁已属于别的进程，没有动它 |
| `lock_taken_over` | 取锁时接管了已退出进程留下的（或损坏的）锁 |
| `lock_reacquired` | 写入之前发现锁被别的进程拿走，已重新取锁并重算 |
| `tmp_cleanup_failed` | 删除本次事务的临时目录失败 |
| `questions_dropped` | 页面里没有了、还没答的题记为被这一版取代；暂时删掉的用 `--keep` 保留 |
| `retired_question_in_page` | 已撤回或已取代的题号又出现在页面里，结局不变 |
| `artifact_reopened` | 发布重新打开了已关闭的产物，恢复了因关闭而撤回的题里页面还在的与 `ask` 登记的 |
| `questions_in_script` | 文件集里的脚本、模板、`noscript` 或 `.js` 文件里写了提问标记（属性写法 `data-nbdev-question=`），解析不到 |
| `missing_reference` | 页面引用的本地文件不存在 |
| `reference_outside_artifact` | 页面引用了产物目录之外的文件 |
| `image_too_large` | 文件集里有超过 300 KiB 的图片 |
| `task_images_too_large` | 这个 Task 的 `artifacts/` 与 `evidences/` 里的图片合计超过 5 MiB |
| `artifact_deletions_not_committed` | 产物目录里有被删的文件，没有随发布提交 |
| `unreferenced_files_not_committed` | 产物目录里有没被引用、也没被跟踪的文件，没有随发布提交（`details.paths`）；页面要用就引用它，或用 `--include` 列出 |
| `build_failed` | `panel serve`：前端构建失败，用的是旧的产物（没有旧产物时是错误） |
| `open_failed` | `panel open`：没能用 `xdg-open` 打开浏览器，打印跳转页的路径（`details.page`），手动在浏览器里打开它或改用 `--print` |
| `no_display` | `panel open`：没有桌面环境（`DISPLAY`、`WAYLAND_DISPLAY` 都没设），没有调 `xdg-open`；按消息里的命令从你的电脑转发两个端口，再用 `--print`（`details.panelPort`、`details.artifactPort`） |
| `already_closed` | 产物已经关闭，没有出新版本 |
| `wait_scope_empty` | `answers --wait` 开始时范围里还没有产物；照常等，等待期间新建的产物会加入范围 |
| `already_acked` | 要确认的答复（给了 `--through` 时为不比它新的）都已确认，没有写新的确认；有残留时照样补交残留与 `--include` 的文件 |
| `residual_records_committed` | 产物的 `versions/`、`answers/` 里有上次提交失败留下的文件，这次一起提交了 |
| `newer_answers_unacked` | 有比 `--through` 新的未确认答复，这次没有确认它们；先读再确认 |
| `ack_without_through` | 没给 `--through`，确认了锁内看到的全部未确认答复，其中可能有会话没读过的 |
| `about_not_found` | `--about` 的文件在主工作区与当前 checkout 里都找不到 |
| `open_questions` | Task 改成 `done` 或 `shelved` 时还有题在等开发者答（口径见 [文件格式](file-formats.md#状态现算)）（不自动撤回） |
| `provenance_write_failed` | 记 provenance 失败，只影响“谁问的”这条线索 |
| `unreadable_artifact_record` | 某个发布记录、答复或确认读不出，已跳过 |
| `unreadable_provenance` | 某个 provenance 文件读不出，按没有处理 |
| `schema_unsupported` | 读列表时遇到不认识主版本的文件，已跳过 |
| `audit_write_failed` | 面板：写仓库成功了，但审计初始化过却写不进去（权限、属主不对），这次没记上 |
| `unreadable_notify_record` | 面板：某份通知的尝试记录读不出或格式不对，已跳过（只影响去重与历史） |
| `reused_other_owner` | `dev start` 复用了别的会话（或认不出的调用者）起的服务：它随属主的会话结束而停 |
| `reused_with_different_options` | `dev start` 复用了已在跑的服务，给的 `--ready-pattern`、`--work --task`、带不带 `--sample` 与它起时不同、没有生效（`details.differences`） |
| `unreadable_proc_record` | 某份进程登记读不出或格式不对，已跳过 |
| `proc_record_write_failed` | `dev start` 收到信号时没能写登记（之后的读者按 `supervisor_killed` 判） |
| `supervisor_gone` | `dev start` 复用了监管进程已不在的服务：没有人监管它，用完请 `dev stop` |
| `leftovers_stopped` | `dev start` 先收掉了同键的残留（开发脚本已退、只剩没收掉的进程），再起新的 |
| `proc_snapshot_failed`、`ready_watch_failed`、`sample_watch_failed` | 监管进程记后代快照、读日志认就绪、读日志等样例结果时出错（诊断用） |
| `stop_incomplete` | 监管进程收尾时还有进程没收掉（`details.leftoverPids`）；`dev stop` 遇到同样情形报同名错误 |
| `home_not_written` | `worktree new` 建好了 worktree，但没能在登记表写 `home` |

## `answers --wait`

- 等到选中的答复不为空，或者等着的产物被关闭、题都被撤回了（开发者在面板上结束评审，产物的 `state` 是 `closed` 或 `questions[]` 里没有 `open` 的题）就退出（退出码 0），输出与不带 `--wait` 时相同。只等一个产物、它已经关了时立即返回。缺省按未确认的答复选：已有未确认的答复时立即返回，所以发布之后、挂上等待之前到达的答复不会被漏掉。只想等之后的新答复时加 `--since <cursor>`（`cursor` 取上一次输出里的值）。
- 开始时完整读一次范围内的产物，在 stderr 报一行“等待中”；之后每秒只 `readdir` 主工作区里这些产物的 `answers/` 与 `versions/`，不跑 Git，目录有变化才重读那个产物。没指定产物时还 `readdir` 范围内各 Task 的 `artifacts/`，等待期间新建的产物（例如先挂等待、后 `ask` 建出的 Task 提问集）加入范围。范围里一个产物都没有时照常等，给 `wait_scope_empty`。
- `--timeout` 缺省 1800 秒，到点退出码 4（`wait_timeout`）；收到 SIGTERM、SIGINT 或 SIGHUP（终端或挂着它的会话关掉）退出码同样是 4（`wait_interrupted`），照常输出外壳。被 SIGKILL 结束时来不及输出，stdout 为空：调用方把“退出码不是 0、stdout 为空”当作需要重挂。Claude Code 的 TaskStop 先发 SIGTERM，所以通常仍有外壳。
- **重挂办法**：退出码 4（或被宿主结束）时按原参数重挂；退出码 0 时先处理答复并 `answers ack --through <cursor>`，或带 `--since <cursor>` 重挂，否则按原参数重挂会立刻返回。
- Claude Code 会话用 `run_in_background` 挂着，命令一退出会话就被唤醒；单个后台任务能活多久没有核实，被宿主结束时照样按原参数重挂，不会丢答复。

## 失败时留下什么

- 取锁之前或锁内校验失败（退出码 2、3、5，以及 `lock_timeout`）：不写任何记录。
- 登记表已写、落位或提交失败：号已经是 `claimed`，不会再发；已落位的文件留在主工作区，输出 `writtenPaths`。落位之后文件又被别的进程改了（`changed_after_write`）同样不提交，文件留在工作区。
- `invalid_text`、`invalid_record_edit`、`payload_too_large`、`unsupported_media_type`、`stale_version`、`not_editable`、`request_aborted` 只有面板的写接口会遇到（`invalid_text` 命令行也会）；含义见 [面板](panel.md#写接口)。
- `.local/agent/run/tmp/` 里中断事务留下的目录不自动清理，确认没有 nbdev 在跑后可以删。
