# nbdev 文件格式

每个由 nbdev 写的文件都带 `schema`（`nbdev.*/v1`）；主版本不认识就报 `schema_unsupported`（读列表时只给警告），不猜。

## 记录的读法

Work 与 Task 的 README 由 Work 规则定义（`.agents/works/README.md`）。nbdev 读：

| 内容 | 来源 | `origin` |
|---|---|---|
| 标题 | 正文第一个一级标题 | |
| 状态 | frontmatter `status`；Task 取 `planned`、`active`、`done`、`shelved`，Work 取后三种 | `recorded`；没有字段为 `unset`；取值不在集合里为 `invalid`（带 `raw`） |
| Work 目标 | `## 目标` 一节的正文 | `recorded`；没有这一节时取一级标题后的第一段，为 `inferred`；都没有为 `unset` |
| 最近更新 | frontmatter `updated`（`YYYY-MM-DD`，本机本地日期）；Task 的产物目录（`artifacts/`）或 Task 目录第一层文档（README 之外的 `.md`）最后一次提交的日期更晚时取较晚的 | `recorded`；没有字段时取最后一次碰这个 Task（或 Work）目录的提交日期，为 `commit`；取了产物目录或文档的日期也为 `commit`；都没有为 `unset` |

- 不从正文推断 Task 状态。
- nbdev 写记录时只按行改 `status` 与 `updated`，不重新序列化整个 frontmatter。发布、答复、确认与面板编辑 Task 里的其它文档都不改 README 的 `updated`（改了就要把会话正在改的 README 一起提交），所以“最近更新”另看产物目录与文档的提交日期。面板编辑 README 本身时由核心把 `updated` 改成当天。
- 只读 README 与 Task 目录这一层的目录项，不递归 `evidences/`；产物只读 `artifacts/<id>/` 下的 `versions/` 与 `answers/` 两层（见下文“产物”）。

## 来源

`status` 输出里每个 Work 与 Task 带 `source`：

- `master`：已提交到 `master` 的记录，从主工作区读。只在主工作区工作树里、还没提交的，标 `uncommitted: true`。
- `branch`：过渡期内记录还在分支上维护的 Work，带 `branch` 与 `checkout`，从执行 worktree 的工作区读（含未提交内容）；`otherCopies` 列出其余副本。判定：某个已检出 worktree 的 `HEAD` 上，有路径同时出现在 `git diff --no-renames --diff-filter=AM master...HEAD` 与 `git diff --no-renames master HEAD` 里。分支把记录恢复成 `master` 的版本后，自动回到 `master` 来源。
- 来自分支的 Work 里，只在 `master` 上有的 Task 与登记表里 `claimed` 的 Task（经 nbdev 新建）来源为 `master`，其余为 `branch`。

## 登记表 `.local/agent/registry.json`

```json
{
    "schema": "nbdev.registry/v1",
    "works": [
        {
            "workId": "w00022-dev-panel",
            "status": "imported",
            "at": "2026-10-12T18:00:00.000Z",
            "by": null,
            "home": null,
            "tasks": [
                {"taskId": "t06-cli-core", "status": "claimed", "at": "2026-10-12T18:05:00.000Z", "by": null, "home": null}
            ]
        }
    ]
}
```

- 只记领号的事实。条目按完整 id 记，同号不同名的各占一条；按 id 排序。
- `status`：`claimed` 是经 nbdev 领的，`imported` 是扫描补登的，`abandoned` 是领了不用的；三种号都不再发。
- `by`：领号会话 `{key, agent, sessionId, label, parentSessionId, nestedSessionId}`（`nestedSessionId` 是后加的，没有这个键的条目按 `null` 读）；开发者在面板上领的号是 `{key: "developer:local", agent: "developer", sessionId: null, label: "local", parentSessionId: null, nestedSessionId: null}`（`local` 在 t13 换成配对设备的名字）；未知调用者与 t07 之前写的条目为 `null`，读取时原样保留。`home`：执行位置提示，`worktree new` 写，是 worktree 的**绝对路径**（读者按 `git worktree list` 给出的 `checkout.root` 比较）；没有为 null。
- 写入在锁内完成，先写同目录临时文件再改名。
- 登记表不是可重新生成的原始输出：`registry import` 只能从扫描重建 `imported` 条目，`claimed`、`abandoned`、`home`、`by` 会丢失。丢失后，同步过 `master` 的分支上经 nbdev 建的 Task 会被当成分支记录、拒绝写入。

## 锁与临时目录

都在主工作区的 `.local/agent/` 下，不入库：

```text
.local/agent/
├── registry.json            # 登记表
├── panel.json               # 在跑的面板（nbdev.panel/v1），见“面板的运行时文件”
├── registry.json.lock/      # 写事务的锁目录（事务进行中才有）
│   └── owner.json           # 持锁者：nbdev.lock-owner/v1，token、pid、进程启动时刻、命令行、cwd
└── run/
    ├── leases/<leaseId>.json  # 租约（nbdev.lease/v1），见下一节
    ├── panel.lock             # 面板锁：同一个主工作区同一时刻只跑一个面板
    ├── panel-open/            # 没有 $XDG_RUNTIME_DIR 时 panel open 的跳转页（目录 700、文件 600，10 分钟后删），见 panel.md
    ├── procs/<runId>.json     # 经 nbdev 起的进程（nbdev.proc/v1），见“进程登记”
    ├── procs.lock/            # 写进程登记的锁目录（与记录锁同一套做法）
    └── tmp/                   # 写事务的临时目录 <txid>/，以及组装中或接管下来的锁目录；用完删除
```

- 锁目录先在 `run/tmp/` 里连同 `owner.json` 组装好，再改名到位，所以锁目录一出现就带着持锁者信息。
- 持锁者是否存活按 `/proc/<pid>/stat` 的进程启动时刻判断（pid 在、且启动时刻与 `owner.json` 一致），不靠心跳：持锁者长时间等 Git 也不会被判过期。
- 持锁者已退出（或 `owner.json` 读不出）时，等待者把锁目录改名成 `run/tmp/` 里唯一的墓碑名再接管，只有改名成功、且改走的正是它看到的那个目录的一方继续；改走的若是别人刚建的活锁就原样改回去。接管时给 `lock_taken_over` 警告。
- 写登记表之前发现锁已不属于本进程（`owner.json` 的 token 不是自己的），就重新取锁、从头再算，给 `lock_reacquired` 警告；写了登记表之后才发现则报 `lock_compromised`。
- 放锁前先核对 token，锁已属于别人时什么也不动，只给 `lock_release_skipped` 警告。
- 等锁最多 30 秒，超时报 `lock_timeout`，带上持锁者的 pid、启动时间、命令行与 cwd。
- `run/tmp/` 必须与 `.agents/works/` 在同一个文件系统上（新目录靠 `rename` 原子地落位），否则报 `cross_device`。
- 中断的事务可能留下 `run/tmp/<txid>/`，不自动清理。

## 面板的运行时文件

`panel serve` 起来以后写 `.local/agent/panel.json`，退出时删掉：

```json
{
    "schema": "nbdev.panel/v1",
    "pid": 12345, "startTicks": "987654", "startedAt": "2026-10-13T08:00:00.000Z",
    "instanceId": "1f2e3d4c5b6a7980",
    "url": "http://127.0.0.1:4400", "artifactUrl": "http://127.0.0.1:4401",
    "token": "<64 位 hex 的启动令牌>"
}
```

- 权限 600：`token` 是登录用的启动令牌（`panel open` 用它签一次性登录票据），只在这份文件里。
- 先写临时文件再改名（原子）；退出时只删 `pid` 与 `startTicks` 都是自己的那份。读的一方按 `pid` 加启动时刻判断面板是否真的在跑。
- `run/panel.lock` 记持锁的面板进程（`pid`、`startTicks`、`startedAt`），独占创建；持锁者已退出时接管。

## 进程登记

`.local/agent/run/procs/<runId>.json`（`nbdev.proc/v1`，目录 700、文件 600，写临时文件再改名），由 `dev start` 写（t14）。一份运行由三样组成：监管进程（`dev start` 自己）、`setsid` 起的组长（`pid` 等于 `pgid`）、从组长沿 ppid 收集到的后代快照（含另起进程组、另起会话的）。

```json
{
    "schema": "nbdev.proc/v1", "runId": "dev-20261013T131502Z-a3f9c2d1", "kind": "dev",
    "checkout": "/…/.worktree/w00017-t83-dnd-titlebar", "checkoutKey": "w00017-t83-dnd-titlebar", "package": "packages/neuro-book", "script": "dev",
    "argv": ["bun", "run", "dev"], "readyPattern": null, "sample": false, "workId": null, "taskId": null,
    "logPath": "/…/.local/agent/logs/dev/w00017-t83-dnd-titlebar-dev-20261013T131502Z-a3f9c2d1.log", "bootId": "…",
    "startedAt": "…", "startedBy": {"key": "claude:…", "agent": "claude", "label": null, "process": {"pid": 123, "startTicks": "…"}},
    "supervisor": {"pid": 456, "startTicks": "…"}, "pid": 789, "pgid": 789, "startTicks": "…",
    "descendants": [{"pid": 790, "startTicks": "…"}],
    "url": "http://127.0.0.1:4217/", "readyAt": "…", "lastProbeStatus": 200,
    "stoppingAt": null, "stoppedBy": null, "endedAt": null, "endedReason": null, "exitCode": null, "signal": null, "leftovers": null, "leftoverPids": []
}
```

- `runId` 是 `dev-<YYYYMMDDTHHMMSSZ>-<8 位十六进制>`，日志名带它。
- 登记在锁里先写好 `pid`、`startTicks` 再放锁（锁内起服务）；读到没有 `pid` 的登记时，监管进程活着算 `starting`，不活算 `ended`（`never_started`）。
- `descendants`：监管进程每 2 秒重收一次，新出现的并进来，上限 256 个。后代被收养到 PID 1 之后 ppid 链就断了，所以要在还连着的时候记下。组长还在时，它进程组里的进程也一并记下；组长退出、监管进程给它收尸时再收一次组里剩下的（这时组里还有进程的话组号不会被复用）。读者只凭这里的组员认进程组（见“状态”）。
- `sample`：起时带了 `--sample`，开发脚本的环境里有 `NBDEV_SAMPLE=1`（t18）；不带时 nbdev 从环境里去掉这个变量。t18 之前的登记没有这个字段，按 `false` 读，schema 不变。
- `startedBy`：认不出的调用者为 null。`stoppedBy`：`dev stop` 的调用者会话键（`--force` 时后缀“（--force）”），或 `signal:<名>`。
- 监管进程与 `dev stop` 都在 `run/procs.lock/` 里读改写，各改各的字段。
- **状态**（读取时现算）：下面任一条成立就算还活着：监管进程 pid 在且启动时刻相同；组长 pid 在且启动时刻相同；进程组仍是我们那一组（组长不在、`/proc/<pgid>` 也不在，`kill(-pgid, 0)` 成功，且快照里至少有一个进程 pid 与启动时刻都对得上、并在这个组里。我们的组还有成员时 Linux 不把这个号分给新进程，组空了以后号可以再分给别的组长：`/proc/<pgid>` 在而启动时刻与登记的组长不同，就是号已被复用；EPERM 是别的用户的组。这两种都不算我们的组）；快照里有进程 pid 在且启动时刻相同。
  - `starting`：活着、还没就绪；`running`：活着、已就绪、监管进程在；
  - `orphaned`：活着但监管进程不在，原因 `supervisor_gone`（组长还在）或 `leader_exited`（组长已退、组里或快照里还有进程）；
  - `ended`：都不成立，原因 `exited`、`stopped`、`supervisor_killed`（没有 `endedAt`、也没有 `stoppingAt`）、`rebooted`（`bootId` 不是本次开机的）、`never_started`。有 `endedReason`、没有 `endedAt` 时按写下的原因。
- **停完核对不过**（`stop_incomplete`）：还有我们的进程没收掉时不写 `endedAt`，`leftoverPids` 记它们的 pid，带启动时刻的残留并进 `descendants`：状态按上面的判据是 `orphaned`（`leader_exited`），再 `dev stop` 还能收，残留自己没了之后按 `endedReason` 算已结束。只是就绪地址仍有回应、我们的进程都已不在时，那个地址上的服务不是这份运行的进程：照写 `endedAt`，`leftoverPids` 为空，只在命令的输出里报 `stop_incomplete`（`urlResponding: true`）。
- 不自动清理；面板与 `dev status` 只列还活着的与 24 小时内结束的。

## 租约

`.local/agent/run/leases/<leaseId>.json`，`nbdev.lease/v1`。租约是运行时数据，不入库；`leaseId` 是 `sha256(会话 key + 换行 + workId + / + taskId)` 的前 24 位 hex，一个会话在一个 Task 上只有一份。

```json
{
    "schema": "nbdev.lease/v1",
    "leaseId": "3f2a0c…",
    "workId": "w00022-dev-panel",
    "taskId": "t07-session-leases",
    "session": {
        "key": "claude:d02974de-…", "agent": "claude", "sessionId": "d02974de-…", "label": null, "parentSessionId": null, "nestedSessionId": null,
        "process": {"pid": 1506927, "startTicks": "122098494"},
        "herdr": {"socketPath": "/home/…/.config/herdr/herdr.sock", "paneId": "w1:p16", "terminalId": "term_…"}
    },
    "acquiredAt": "2026-10-12T19:00:00.000Z",
    "lastActivityAt": "2026-10-12T19:05:00.000Z",
    "lastAction": "task status",
    "releasedAt": null,
    "releaseReason": null
}
```

- **取得与续期**是同一个动作，每次都用本次认出的调用者重写整个 `session`。旧记录已释放、超过 24 小时、进程变了（`claude --resume` 沿用会话 id 但换了进程），或旧进程已不在时，按重新取得处理，`acquiredAt` 改为当下。
- **有效性在读取时现算**，按顺序：
  1. 已释放（`releasedAt` 不为空）：`released`；
  2. 所属 Task 现在的状态是 `done` 或 `shelved`：`task_closed`；
  3. 超过 24 小时没有 Task 相关操作：`expired`；
  4. 记了 `process` 而进程已不在或启动时刻不同：`session_gone`；
  5. 同一个进程后来出现了别的会话 id（`/clear`、后台副本）：较早的会话为 `superseded`；
  6. 其余：`valid`。
- **herdr 不判失效**：herdr 的列表里找不到这个会话只表示 `managed: false`（现在不能通知）。只在租约记的 `socketPath` 与本次评估用的 socket 相同时才算 `managed`。
- `stale`：超过 2 小时没有 Task 相关操作，只用于淡化显示。
- **写法**：先写同目录临时文件（名字带 pid 与随机数）再改名；读取时只认 `^[0-9a-f]{24}\.json$`，并逐字段校验（`leaseId` 必须与文件名一致；三个时间是 ISO 时间；`releasedAt` 与 `releaseReason` 同时有或同时为 `null`；`session.process`、`session.herdr` 的形状），读不了或不合规的文件给 `unreadable_lease` 警告后跳过。租约不进写事务的锁，有效性现算，所以写入的竞争不会让已关闭的 Task 重新有人“在动”。仍可能出现的偏差：同一份租约的续期与释放互相覆盖时，丢一次 `lastActivityAt` 更新，或刚续期的租约被记成已释放，要到这个会话下一次 Task 相关操作才恢复。按 Task 释放（改成 `done`、`shelved` 之后）时先重读 Task 状态，已被改回就不释放，并只释放最近活动不晚于重读时刻的租约；每份写之前再重读一次，剩下的窗口是毫秒级。
- 失效与释放的文件不删。常规读取跳过修改时间早于 24 小时之前的文件（每次续期、释放都会重写文件，这样的租约必然已过期或已释放），`lease list --all` 才全读；续期时顺手删掉 24 小时前崩溃留下的 `.tmp-*` 临时文件。`releaseReason` 取 `released`（`nbdev release`）、`task_done`、`task_shelved`。

## 产物

产物属于 Task，放在 `.agents/works/<workId>/tasks/<taskId>/artifacts/<artifactId>/`（Work 级的放 Work 目录下同名的 `artifacts/`，只索引、不能经命令行写）。`artifactId` 是 kebab-case（`^[a-z0-9]+(-[a-z0-9]+)*$`，最长 48 个字符）；`questions` 保留给 Task 的提问集。

```text
artifacts/<artifactId>/
├── index.html  r1/  assets/ …     # 页面文件：会话直接写
├── versions/v<N>.json             # 发布记录：nbdev 写，之后不改
└── answers/
    ├── <答复 id>.json              # 答复：只追加
    └── ack-<id>.json              # 确认
```

- `versions/`、`answers/` 只由 nbdev（以后加上面板）写；会话只写页面文件。
- 读取时产物只读 `versions/` 与 `answers/` 两层，不读页面文件（发布时才读）。
- Task 目录第一层除 `README.md` 外的 `.md` 是**文档类产物**：按文件索引（`{path, title}`，`title` 取第一个一级标题），没有发布记录；Work 目录第一层同样处理。

### 发布记录 `versions/v<N>.json`

```json
{
    "schema": "nbdev.artifact-version/v1",
    "workId": "w00022-dev-panel", "taskId": "t03-design", "artifactId": "review",
    "version": 2, "supersedes": 1, "action": "publish",
    "kind": "design", "title": "开发面板评审板", "state": "open",
    "entry": "index.html", "contentHash": "<sha256>",
    "files": ["assets/home.png", "index.html", "r1/index.html", "style.css"],
    "questions": [
        {"id": "home-layout", "type": "single", "label": "首页的 Work 区用卡片还是表",
         "options": [{"value": "cards", "label": "A 每个 Work 一张卡片"}, {"value": "table", "label": "B 一张表"}],
         "required": true, "recommend": ["cards"], "origin": "markup", "page": "index.html", "about": null,
         "since": 1, "outcome": null}
    ],
    "publishedAt": "2026-10-12T21:30:00.000Z"
}
```

- `action`：这一版由哪个动作产生，`publish`、`close`、`ask`、`withdraw`、`supersede`。非发布动作沿用上一版的 `kind`、`title`、`entry`、`contentHash`、`files`，页面不重新解析。
- `kind`：`design`、`report`、`review`；Task 提问集为 `questions`（`entry`、`contentHash` 为 `null`）。`state`：`open` 或 `closed`。
- 每道题：`origin` 是 `markup`（来自页面标记）或 `ask`（来自 `nbdev ask`）；`page` 是题所在的页面（`ask` 登记的、或已答后从页面删掉的为 `null`）；`about` 是 `--about` 记的仓库根相对路径；`since` 是题号第一次出现的版本。
- `outcome`：`null`（活的）；`{kind: "withdrawn", in: N, reason: "explicit" | "closed"}`；`{kind: "superseded", in: N, by: null | {workId, taskId, artifactId, questionId}}`（`by` 是完整 id；`null` 表示被这一版的页面取代）。
- **最新一版带全部题**，被取代、撤回的也在；状态只看最新一版与答复。最新一版读不出时不退回旧版，读取给警告、写入报 `invalid_record`。
- `files`：这一版的**文件集**（见下），路径相对产物目录、按 UTF-8 字节序排序。只有 `publish` 写新的清单；Task 的提问集为 `null`；没有这个字段的旧记录读成空清单。发布记录先落盘、`git add` 后执行，所以提交失败时面板与下一次发布仍能按这份清单找回完整的集合。
- `contentHash`：文件集的摘要。路径相对产物目录、按 UTF-8 字节序排序，对“路径、NUL、文件内容的 sha256、换行”逐行求 sha256。遇到符号链接拒绝发布。

**文件集**是发布时提交、求摘要、找提问标记的范围，其余文件不提交（列在 `unreferenced_files_not_committed` 里）：

- 候选：产物目录里 Git 不忽略的文件（`git ls-files -z --cached --others --exclude-standard`），去掉 `versions/`、`answers/`，只算磁盘上还在的。文件集只从候选里取。
- 种子：入口；已跟踪的文件（`git ls-files --cached`）；上一版的 `files`；上一版题表里 `page` 不为 `null` 的页面；本次的 `--include`。已经发布或提交过的文件因此不会因为页面不再链接它而掉出去。
- 闭包：从全部种子出发，对纳入的每个文件收集引用，直到集合不再增长。
  - `.html`、`.htm`：元素的 `src`、`href`、`poster`、`srcset`（`script`、`style`、`template`、`noscript` 自己的属性也收；`<template>` 的内容与 `<noscript>` 里的元素同样收，只是不在里面登记题）；内联 `<style>` 与 `style` 属性里的 `url(...)`、`@import`；内联的 `<script type="module">`（没有 `src`）里的 import。
  - `.css`：`url(...)` 与 `@import "…"`，按 CSS 的分词规则识别：注释与其它字符串里写的不算；地址按 CSS 的转义解码（`url(pic\ name.png)` 指向 `pic name.png`）；坏的 `url(...)`（不带引号的地址中间有空白、引号或左括号）不算。
  - `.js`、`.mjs`：字面量的 `import … from "…"`、`import "…"`、`export … from "…"`、`import("…")`，按记号识别：注释、字符串、模板字符串与正则里写的不算，记号之间可以夹注释（`import /* x */ "./lib.js"`）；只认 `./`、`../`、`/` 开头的与带协议的地址，裸模块名与拼出来的地址追踪不到，要用 `--include` 列出。
  - `srcset` 按 HTML 的候选语法解析：地址是一段不含空白的字符，后面是描述符，候选之间用逗号分隔；地址里的逗号（`assets/a,b.png 1x`）与 `data:` 地址不会被切开。
  - 引用的归一化：跳过带协议的、`//` 开头的与只有 `#` 的；去掉 `?`、`#` 之后的部分，按引用所在文件的目录解析，百分号解码（解码失败按字面）；`/` 开头的与解析后指向产物目录之外的不进文件集。引用检查（`missing_reference`、`reference_outside_artifact`）用的是同一份引用。

### 新版本的题表

发布时由上一版与页面标记生成（全在写事务的锁内）：

| 情形 | 处理 |
|---|---|
| 页面里的题号在上一版里是活的 | 沿用 `since`，题目与选项用新的定义 |
| 页面里的新题号 | `since` 为本版 |
| 上一版来自页面、这次页面里没有了、还没答 | 记为被本版取代，`--keep <题号>` 可以原样保留（之前几版的题写 `--keep` 报 `keep_not_applicable`：保留了也不能再答，要重新问就放回页面） |
| 同上，但已经答过 | 保留，`page` 记 `null` |
| 已撤回或已取代的题号又出现在页面里 | 结局不变，不复活 |
| 产物已关闭、这次发布重新打开它 | 因关闭而撤回的题里，页面里还在的与 `nbdev ask` 登记的恢复成活的 |
| 页面里的题号与 `nbdev ask` 登记的同号 | `duplicate_question`，发布失败 |

关闭（`artifact close`）把还没答的题记成 `{kind: "withdrawn", reason: "closed"}`，已答的不动。Task 的提问集不能关闭。

### 状态现算

1. `outcome` 不为 `null`：`withdrawn` 或 `superseded`。
2. 否则取这道题最新的一份答复（按答复 id）：取值**按最新一版的题目定义**校验合法，为 `answered`，并标出这份答复针对哪一版；不合法就回到 `open`，同时把那份旧答复列进 `stale`（不往前找更早的答复），`stale.code` 写明原因：按它针对的那一版合法、按最新一版不合法（选项后来改了）为 `stale_value`；按它针对的那一版也不合法（手改坏的文件，或那一版读不出）为 `invalid_value`。
3. 否则 `open`。

产物另算：`waiting`（等开发者答的题数：`open`、不是之前几版的题（它们答复作废时也是 `open`，但不再收答复），必答题没答就算，选答题在它出现之后没交过答复才算：交过一次说明开发者看过这块板，没答的是不想答）；**未确认的答复**是集合差，答复 id 不在任何一份确认的 `answers[]` 里就算未确认；采纳状态：有未确认的答复为 `waiting`（等会话采纳），有答复且都已确认为 `adopted`，没有答复为 `none`。收件箱只放算进 `waiting` 的题与正在发生的撞号（`live`）。一次也没答的板要开发者关掉（产物页的“关闭评审”，或 `nbdev artifact close`）才离开收件箱。

## 提问标记

写在产物文件集（见“发布记录”）里任意一个 `.html` 页上，题号在整个产物内唯一；没被链接、也没被跟踪的页面要用 `--include` 列出。例子见 [`examples/questions.html`](examples/questions.html)（包的测试会解析它）。

| 属性 | 含义 |
|---|---|
| `data-nbdev-question="<题号>"` | 一道题的范围，放在包住这道题的元素上，必须写显式的结束标签。题号 `^[a-z0-9][a-z0-9-]{0,62}$`；题意变了就换题号 |
| `data-nbdev-type` | 必填：`single`、`multi`、`text`、`confirm`（答复是 `true` 或 `false`） |
| `data-nbdev-label` | 题目；没有时取范围内第一个 `h1` 到 `h6` 的文字（不进入选项元素）。最长 200 字 |
| `data-nbdev-option="<值>"` | 选项元素。选项名依次取它的 `data-nbdev-label`、它里面第一个标题、它自己的文字；最长 80 字 |
| `data-nbdev-options` | 题上的一行写法：若干个 `值:名称`，用竖线分隔（没有名称时名称就是值）；或 `@review`（改 `fix`、不改 `skip`、要讨论 `discuss`）。不与 `data-nbdev-option` 混用 |
| `data-nbdev-required` | 必答：只给不定下来就做不下去的题；题缺省是选答（开发者 11-05）。已发布的页面上留着的 `data-nbdev-optional` 不再有含义，照常是选答 |
| `data-nbdev-recommend="<值>[,<值>]"` | 推荐的选项 |
| `data-nbdev-skip` | 取题目、选项名的文字时跳过这个元素（徽标、按钮） |

- 前缀用 `data-nbdev-`：`data-nb-` 已被 nb-ui 用了十几种属性。
- `single`、`multi` 至少两个选项，选项值在题内唯一、用与题号相同的字符集，选项名在题内也不能重复（`duplicate_option_label`）；`text`、`confirm` 不能有选项；推荐的值必须是选项之一。
- 题不能嵌套。题外的选项报 `option_outside_question`：多半是 HTML 自动闭合把它挤了出去（例如 `<p>` 里放了块级元素）。范围元素没有显式结束标签报 `question_not_closed`。
- 不合规就整体不发布（`invalid_questions`），`details.problems[]` 是 `{page, line, column, questionId, code, message}`。
- 取题目与选项名的文字时，行内元素直接拼接，块级元素与 `br` 处补一个空格，连续空白折叠成一个空格。
- 写在内联 `<script>`、`<template>`、`<noscript>` 或产物目录的 `.js`、`.mjs` 文件里的标记解析不到，给 `questions_in_script` 警告；`<template>`、`<noscript>` 里的资源照样进文件集。这里只认属性写法（`data-nbdev-question=`）：脚本里按属性查询、`<style>` 里的属性选择器不算。
- 扁平的板（标题后跟兄弟元素）要先给每道题包一层元素（通常是 `section`）。

## 答复与确认

### 答复 `answers/<答复 id>.json`

```json
{
    "schema": "nbdev.answer/v1",
    "workId": "w00022-dev-panel", "taskId": "t03-design", "artifactId": "review",
    "answerId": "20261012T213012345Z-1a2b3c4d",
    "artifactVersion": 2, "contentHash": "<那一版的 contentHash>",
    "submittedAt": "2026-10-12T21:30:12.000Z",
    "submittedBy": {"kind": "developer", "device": "desk"},
    "values": {"home-layout": "cards"},
    "comments": {"home-layout": "卡片更清楚"},
    "note": null
}
```

- **答复 id**：`<UTC 时间，精确到毫秒>-<8 位 hex>`。在写事务的锁内重新读时钟生成并保证单调：时间取 `max(当下, 这个 answers/ 目录里最大的 id + 1 毫秒)`，所以字典序就是落位的顺序。`submittedAt` 是开发者按下提交的时刻，与 id 分开。
- `submittedBy`：`{kind: "developer", device}`（面板），或 `{kind: "agent-transcribed"}`（`answers record` 代录）。入库的答复里没有会话；谁代录的记在 provenance 里。
- `values` 只含这次填的题；`comments` 可选，逐题写理由。改答案就再写一份，旧的不删。
- 写入时取值按答复针对的那一版校验（`single` 是选项值；`multi` 是不重复的选项值数组、至少一个；`text` 非空、最长 10000 字；`confirm` 是布尔值），只能答活的题，而且只能答这一版里的题：之前几版的题（来自页面、已答、后来的页面里没有了，`page` 为 `null`）留在题表里只为答案查得到，再答报 `question_earlier`（t15 阶段 4）。`ask` 登记的题与 `--keep` 保留的题照常能答。

### 确认 `answers/ack-<id>.json`

```json
{
    "schema": "nbdev.answer-ack/v1",
    "workId": "w00022-dev-panel", "taskId": "t03-design", "artifactId": "review",
    "ackId": "20261012T214000000Z-5e6f7a8b",
    "answers": ["20261012T213012345Z-1a2b3c4d"],
    "through": "20261012T213012345Z-1a2b3c4d",
    "included": [".agents/works/w00022-dev-panel/tasks/t03-design/README.md"],
    "ackedAt": "2026-10-12T21:40:00.000Z"
}
```

- `answers` 是这次确认覆盖的答复：锁内算出的未确认答复里 id 不大于 `--through`（会话读答复时的游标）的那些，没给 `--through` 时为全部未确认的答复。`through` 是其中最大的 id，只用于显示。`included` 是同一个提交里的其它路径（写了决定的 Task README）。id 的生成同答复。

## provenance

`.local/agent/run/provenance/<与入库文件相对 .agents/works/ 的路径相同>`，`nbdev.provenance/v1`，运行时、不入库：某个入库文件（发布记录、代录的答复、确认）是哪个会话写的。

```json
{
    "schema": "nbdev.provenance/v1",
    "path": ".agents/works/w00022-dev-panel/tasks/t03-design/artifacts/review/versions/v2.json",
    "sha256": "<入库文件内容的 sha256>",
    "action": "publish",
    "leaseId": "3f2a0c…",
    "session": {"key": "claude:d02974de-…", "…": "同租约里的会话快照"},
    "recordedAt": "2026-10-12T21:30:00.000Z"
}
```

- 写入后先续期调用者的租约，再记 provenance；调用者未知时不记，失败只给 `provenance_write_failed` 警告。
- **提问者**：题的 `since` 那一版的 provenance，`sha256` 与磁盘上的发布记录一致才认（发布记录被删掉又重建时，旧记录不会冒认）。找不到时为 `null`：别的机器上、删过 `.local`、记录被重建过。

## 通知的尝试记录

`.local/agent/run/notify/<时刻>-<attemptId>-intent|result.json`，`nbdev.notify/v1`，运行时、不入库：面板对哪几份答复、向哪个会话做过什么（t11，见 [panel.md](panel.md#通知与会话页t11)）。待发的通知不落盘，每次现算；这些记录只用来去重与显示历史。

```json
{
    "schema": "nbdev.notify/v1",
    "attemptId": "a1b2c3d4e5f6",
    "at": "2026-10-13T08:00:00.000Z",
    "workId": "w00022-dev-panel", "taskId": "t03-design",
    "sessionKey": "claude:d02974de-…",
    "askerKey": "claude:d02974de-…",
    "paneId": "w1:p16",
    "answers": ["20261013T075959123Z-…"],
    "result": "delivered",
    "code": null,
    "message": "已投递",
    "manual": false
}
```

- `sessionKey` 是发给谁；`askerKey` 是提问者（手动另选会话时两者不同，这份对提问者也算办完）。
- 每次尝试两份：调 herdr 之前独占创建一份 `result: "pending"` 的意图，拿到结果后另写一份同一个 `attemptId` 的结果。只有意图、没有结果的按 `uncertain` 算（面板在投递途中退出）。开发者选“不通知”只写一份 `skipped`（`paneId` 为 null）。
- `result`：`delivered`（`code: unwatched` 是面板这时没订阅到这一格的状态事件，没核对回车前后有没有弹出确认界面）、`delivered_into_blocked`（投递时弹出了确认界面，回车可能确认了它；`code: passed_blocked` 是投递后经过了确认界面、又回到了工作。更早的记录里可能有 `code: state_jumped`，那是按状态序号的差值判的，别的会话同时变状态就会误报）、`delivered_maybe_wrong_session`（投递的瞬间换了会话）、`uncertain`（`code` 是 `agent_prompt_stalled`、`timeout` 或 `client_timeout`：写进去了但没看到会话开始工作，不重发）、`skipped` 算办完；`agent_blocked`、`not_deliverable`、`session_changed`、`failed` 没写进去，下次照常排队。
- 目录 700、文件 600，独占创建（与租约目录同样的写法）；不自动清理。读不出的跳过并给 `unreadable_notify_record`。

## 审计

`${XDG_CONFIG_HOME:-~/.config}/nbdev/`（目录 700），由包脚本 `audit-init` 建（见 [panel.md](panel.md#审计)）：

- `init.json`（600）：`{"schema": "nbdev.audit-init/v1", "at": "<初始化的时刻>"}`。这个时刻也是通知的启用时刻：答复 id 里的时刻早于它的答复不自动通知。再运行 `audit-init` 不改它。
- `audit.jsonl`（600）：只追加，一行一个 JSON：

```json
{"schema":"nbdev.audit/v1","at":"2026-10-13T08:00:00.000Z","instance":"<面板实例 id>","actionId":"9f8e7d6c5b4a3921","phase":"intent","action":"notify","device":"local","target":{"paneId":"w1:p16","sessionKey":"claude:…","workId":"w00022-dev-panel","taskId":"t03-design"},"detail":{"text":"[nbdev] …","answers":["…"],"manual":false,"askerKey":"claude:…"}}
```

- `action`：`notify`、`prompt`、`keys` 各写一行意图（`phase: "intent"`，`detail` 是整行文字、整段文字或键名）与一行结果（`phase: "result"`，`detail.result`、`detail.code`），用同一个 `actionId` 关联；`answer`、`create_work`、`create_task`、`status`、`edit` 只写一行结果（`detail` 是 `committed` 与 `sha`，或失败理由与路径；不记文件内容）。
- **网页终端（t12）**：
  - `takeover` 一行意图：`target` 加 `terminalId`；`detail` 是请求的 `cols`、`rows`，接管前读到的 pty 尺寸 `before`（`{cols, rows}`，读不到为 null；本面板另一个浏览器换手时是它记下的那份），是否带了 `--takeover`（`takeover`），登录会话 id 的前 8 位（`loginSession`）。
  - `takeover` 一行结果（同一个 `actionId`）：`detail.result` 是 `attached`、`controlled_elsewhere`（别处在控制，等开发者确认“抢过来”）或 `failed`（`why`：`timeout` 握手 5 秒没回应、`pane_closed`、`refused` 带了 takeover 仍被拒、`disconnect` 起 control 之前连接关了、`panel_exit` 起 control 之前面板要退出；这几种都没有改过尺寸。control 接上之后连接才关的，记 `attached` 再加一行释放）。
  - 接管成功之后，释放时再写一行 `release` 结果（同一个 `actionId`，没有意图行）：`detail.reason`（`user`、`hidden`、`disconnect`、`heartbeat`、`idle`、`taken_over`、`pane_closed`、`panel_exit`、`session_closed`）、`durationMs`，统计 `inputs`、`inputBytes`、`enters`、`pastes`、`pasteBytes`、`resizes`、`buttons`，`restored`（释放前发出了改回原尺寸的指令）与没改回时的 `notRestored`（`size_unknown` 接管前读不到尺寸、`handed_off` 交给了本面板的另一个浏览器、`stream_ended` 流已经结束）。**键盘输入的内容不写**（见 [panel.md](panel.md#网页终端t12)）。
  - 有 `takeover` 的 `attached`、同一个 `actionId` 却没有 `release` 行：面板在接管中异常退出（被 SIGKILL 或崩溃）。控制权已随子进程释放（子进程经 `setpriv --pdeathsig` 起，父进程一死就收到 SIGTERM），但 pty 的尺寸没有改回。面板启动时不补写这一行。
  - 观看不写审计。
- `device` 在 t13 之前一律 `local`。

## 进程的启动时刻

会话进程与运行的身份都用 `/proc/<pid>/stat` 的第 22 项（进程启动时刻，时钟周期数）配合 pid，防 pid 被复用。换算成时间用 `/proc/stat` 的 `btime + startTicks / 100`：Linux 的 USER_HZ 固定为 100，Node 拿不到 `sysconf(_SC_CLK_TCK)`，这个假设只影响显示的启动时间。
