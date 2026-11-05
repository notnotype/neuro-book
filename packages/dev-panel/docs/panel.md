# 面板

开发者项目面板的合同：两个来源、登录、请求校验与路径守卫、接口、写接口（t10）、通知与会话页（t11）、网页终端（t12）、现场（t14）、审计（t11）、缓存与刷新、`panel serve` 与 `panel open`、常驻（t11）、前端构建。命令行合同见 [cli.md](cli.md)，文件格式见 [file-formats.md](file-formats.md)，herdr 的订阅与对账见 [herdr.md](herdr.md#面板的订阅与对账)，投递的判据见 [herdr.md](herdr.md#投递t11)。读接口与 t09 相同；t10 加了答复、新建、状态切换与编辑的写接口，与命令行走同一个核心函数、同一把锁、同一种路径限定的提交；t11 加了答复之后通知提问的会话、会话页的屏幕与输入框与按键、审计与 systemd 用户服务；t12 加了会话页的实时终端与接管键盘（herdr 那边的终端流见 [herdr.md](herdr.md#终端流t12)）。

## 两个来源

| 来源 | 地址 | 内容 |
|---|---|---|
| 面板 | `127.0.0.1:4400` | 前端页面（`dist/web`，单页路由回退到 `index.html`）、`/api/*` 的 JSON、`/ws` 的推送、`/ws/terminal` 的网页终端（t12）、`/login` 的一次性登录 |
| 产物 | `127.0.0.1:4401` | 只读的静态文件：`/a/<随机前缀>/<checkout key>/.agents/works/…`，只给 `.agents/works/` 下的文件，没有接口 |

- **只绑回环**：`--host` 只接受 `127.0.0.1` 与 `localhost`，别的地址（含 `0.0.0.0` 与 `::1`）报 `unsafe_host`；这台机器上绑不了的地址也报 `unsafe_host`。不收 IPv6：本机的 `lo` 关了 IPv6，有 IPv6 的机器上 Chrome 的 CSP 也写不了 IPv6 字面量，产物页嵌不进来。端口被占报 `port_in_use`，不自动换端口。
- **产物来源的随机前缀**在服务启动时生成，只经 `/api/artifact` 交给面板：网页猜不到地址，读不走只在本机、或只在未推送分支上的产物；有了它才能回 `Access-Control-Allow-Origin: *`（沙箱 iframe 是不透明来源，模块脚本、`fetch` 与字体都按 CORS 取）。`/a/<前缀>/_nbdev/` 是保留路径，回 404（t10 不做页内答复，留着不让它与 checkout key 撞名）。
- 产物来源与面板来源用同一种主机名：请求是 `localhost:4400` 时，iframe 指 `localhost:4401`。

## 登录

回环对本机的其他账户与浏览器里的任意网页都开放（本机另有可登录的账户），所以 `/api/*`、`/ws` 与 `/ws/terminal` 都要登录。设备配对与分级在 t13。

1. `panel serve` 生成启动令牌，写进权限 600 的 `.local/agent/panel.json`。
2. `panel open` 读它、签一张一次性票据（`<nonce>.<过期时刻>.<HMAC>`，5 分钟过期，用一次作废），写一页跳转页再用 `xdg-open` 打开（见下）；`--print` 只打印登录链接 `/login?ticket=…`。
3. 服务核对票据，换成会话 cookie（`nbdev_panel_<面板端口>`，`HttpOnly; SameSite=Strict; Path=/`），重定向到 `/`。会话只在本次服务实例里有效，重启面板后要重新 `panel open`。cookie 名带端口：cookie 不按端口区分，同一个浏览器登录两个面板（不同仓库，或开发时的演示面板）时，名字相同就会互相踢下线。

页面本身与静态资源不要求登录；`/api/*` 没登录回 401（`unauthorized`），前端据此提示“用 nbdev panel open 打开”。前端任何 `/api/*` 请求回 401（读、写、预览、探测、流式搜索）都进入登录失效状态：停止推送、重连与取数，页面保持挂载（没保存的改动还在），上面盖一层提示（压在所有浮层之上：速览面板、nb-ui 的抽屉与对话框都在它下面）；在这个浏览器里用新链接登录之后点“我已重新登录”，重探 `/api/meta` 通过就全部重取、会话页的终端重连（只恢复观看，不自动重新接管）（t15）。

## 请求校验

两个来源都按顺序做，失败一律 4xx，不进业务逻辑：

1. 带转发头（`Forwarded`、`X-Forwarded-*`、`X-Real-IP`、`Tailscale-User-Login`、`Tailscale-User-Name`）的拒绝（403）：跨设备上线之前不接受经代理转进来的请求。
2. `Host` 必须是本来源的 `127.0.0.1:<port>` 或 `localhost:<port>`（421，防 DNS 重绑定；Bun 按 `Host` 头拼 `req.url`，所以直接比 `Host` 头）。
3. URL 解析器先按规范折叠 `.` 与 `..`（含 `%2e` 写法），折叠后的路径照常过下面的检查，所以 `/../x` 等同 `/x`、出不了根（`/../../etc/passwd` 落到单页回退，回 `index.html`，不是那个文件）。剩下的段逐段解码：编码过的 `/` 与 `\`、解码出 NUL、不合法的百分号编码与空段回 400，不让解码错误变成 500。
4. 面板来源，按这个顺序：
   - `/api/*` 与 `/ws`（不论方法）先要求 `Sec-Fetch-Site` 是 `same-origin` 或 `none`（缺这个头的按 `none` 处理，只有浏览器的跨站请求会带 `cross-site`、`same-site`），再要求登录 cookie（401）。跨站的 `<img src=…/api/search?q=…>` 两道都过不去。
   - 然后，非 `GET`、`HEAD` 的请求要求同源的 `Origin` 加 `X-Nbdev-Csrf` 头（值是服务启动时生成、写进页面 `<meta name="nbdev-csrf">` 的随机令牌）。CSRF 令牌写在不要求登录的 `index.html` 里，本机任何账户都读得到：它只防浏览器里的跨站请求，不是本机账户之间的秘密，写请求靠的是前一步的登录。通过之后 `/api/*` 交给写接口（见“写接口”），没有对应的写路由回 405；`/api` 之外的写请求一律 405。
   - `/ws` 与 `/ws/terminal` 的升级要求 `Origin` 是面板自己的来源（缺失与 `null` 都拒绝）。浏览器的 WebSocket 不能带自定义头，CSRF 由 `Origin` 加 `SameSite=Strict` 的 cookie 挡。
5. 产物来源只接受 `GET`、`HEAD`（405）。

响应头：面板来源的页面带 `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: <产物来源>; connect-src 'self' ws://<host>; frame-src <产物来源>; frame-ancestors 'none'; form-action 'none'; base-uri 'none'; object-src 'none'`；产物来源带 `Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups; frame-ancestors <面板来源>`。两边都带 `X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`。

## 路径守卫

面板的文件类接口与产物来源共用：

- **段检查**（`src/core/paths.ts`）：路径相对某个 checkout 的根，拒绝 `..`、`.`、空段、绝对路径、NUL，任何一段是 `.git`、`node_modules` 或以 `.env` 开头，以及第一段是 `.local`、`workspace`、`logs`、`server`（本机数据）。
- **真实路径**：`realpath` 之后必须仍在这个 checkout 的根下，并对真实路径的相对部分再做一遍段检查（仓库里指向 `.git/config` 或 `.env` 的符号链接也拿不到）；只给普通文件。
- **白名单**：`/api/docs/file` 只接受这个 checkout 的文档树（`/api/docs/tree`）或记录（Work 与 Task 的 README、文档类产物）列出的路径，其余 404；产物来源只给 `.agents/works/` 下的文件。
- **id 参数**：`workId`、`taskId`、`artifactId`、`version` 与 checkout key 只接受缓存里存在的值，不拿来拼路径。checkout key：主工作区是 `main`，worktree 用目录名，撞名时改用路径哈希（`h-<12 位>`）。
- 单页路由回退只给最后一段不带点、各段不以点开头的路径：`/.git/config`、`/x.js` 不会拿到 `index.html`。

## 接口

读接口全是 `GET`（写接口见下一节）。JSON 接口的外壳是 `{schema: "nbdev.panel-api/v1", ok, data, warnings, errors, instance, revisions}`：`instance` 是服务实例 id（重启后变），`revisions` 是各块数据（`records`、`activity`、`sessions`、`notify`）的版本号；前端只接受更新的数据。预热完成之前回 503（`warming_up`），`/api/meta` 除外。

| 接口 | 内容 |
|---|---|
| `/api/meta` | 实例 id、启动时刻、是否预热完成、`codeChanged`（面板代码已更新，重启后生效）、`service`（`{unit, restartCommand}`：作为 systemd 服务运行时的单元名与重启命令，前台运行时都是 null，见“常驻”）、前端构建是否失败、herdr 的状态（含 `autoNotify`：这个版本是否自动投递通知）、`audit`（`{enabled, initAt}` 或 `{enabled: false, reason, detail}`）、`notify`（`{pending, attention}`：排队的与要开发者处理的任务数）、各块数据的刷新时刻与错误、产物来源的地址、`mainWritable`（`{ok, code, message}`：主工作区现在能不能写，不在 master 或正在合并、变基时不能，前端据此隐藏写入口）、`terminal`（`{available, reason}`：网页终端能不能用，t12） |
| `/api/overview` | 首页与左栏：各 Work 与 Task 的摘要（状态、目标、最近更新、当前情况、来源、待答数、谁在动）、收件箱（提问带 `askedBy` 与 `askerActive`：提问者的租约是否还有效）、会话的计数（明细在 `/api/sessions`）；`sessionTitles` 含 Work 卡片“谁在动”的会话与收件箱的提问者（提问者已不在活动里也有） |
| `/api/work/:workId` | Work 页：完整的 Work（Task 表、产物与文档类产物、谁在动）与相关会话；`readmeHash`（README 的 sha256，状态切换带它）；每个 Task 带 `waiting`（与 `/api/overview` 同一个口径）；`sessionTitles` 含这个 Work 的租约与相关会话 |
| `/api/task/:workId/:taskId` | Task 页：Task 摘要（含 `readmeHash`）、README 原文、证据（第一层）、链到的 Spec、执行 checkout 的候选与选中的、执行 checkout 上的提交；`sessionTitles` 含这个 Task 的租约 |
| `/api/artifacts` | 产物列表：有发布记录的（设计稿、讲解与报告、审查、提问集）与没发布的、文档类产物、各 Task 的证据数 |
| `/api/artifact/:workId/:taskId/:artifactId?version=` | 产物页：版本列表、题与状态（`version` 只切换题表）、答复、确认、iframe 地址（产物来源上磁盘里的当前页面）、`unpublishedChanges`（磁盘内容与最新一版的 `contentHash` 不同）、记录来源（`source`、`branch`）。Work 级产物的 `taskId` 写 `-` |
| `/api/docs/tree?checkout=` | 文档树（按类型分组）；不是主工作区时附与 master 的差异（见下） |
| `/api/docs/file?checkout=&path=` | 一份文档：原文、frontmatter、标题、这个 checkout 上最近 5 次提交、哪些已检出的分支改了它（`changedIn`） |
| `/api/docs/diff?checkout=&path=` | 一份文档与 master 的差异（t15 阶段 4 第 4 批），与文档树的“改动”同口径：`change` 取自同一份文档树（新增、改动、删去、`master_only`，不在差异里为 null）；新增、改动、删去是合并基点（`mergeBase`）到这个 checkout 工作区的 `git diff`，含未提交，未跟踪的新文件整份当新增；`master_only` 是主工作区里那一份整份当新增。白名单是这个 checkout 的文档树、它的差异与记录里的文档之并，其余 404 |
| `/api/files?path=` | 编辑页：主工作区里一个文件的原文与 sha256、种类（Work README、Task README、文档类产物、主工作区文档）、能不能编辑与原因、未提交的改动（已暂存与工作区分开）、是不是暂存区里一次改名的一端、改过它的分支、根级治理入口的非空行上限。编辑白名单之外的路径回 404 |
| `/api/sessions` | herdr 的状态（可用、订阅还是轮询、漏事件数）与 pane（是否开在本仓库里、`scrollback` 能往回翻多少行，全屏程序或备用屏时是 0；`history` 是能读更早的输出时走哪个接口：`session` 是 `/api/sessions/:paneId/history`（只给 omp，回滚不是 0），`pane` 是 `/api/panes/:paneId/history`（没有会话键、回滚大于 0），读不到为 null，见 `src/server/delivery.ts` 的 `historySource`）、会话持有的租约与它的运行、无主的运行、checkout 列表（是哪个 Work 的执行 worktree）。pane 与会话各带 `title: {text, source} \| null`（t15 阶段 4 第 3 批，决定点 19）：从本机 Agent 的会话文件里读，Claude Code 取会话文件末尾一段里的 `custom-title`、`agent-name`、`ai-title`（先后如此），Codex 取 `session_index.jsonl` 的 `thread_name`（只读末尾 4 MiB，见“缓存与刷新”的会话标题），omp 取会话文件第一行的 `title`；只读、按文件大小与修改时间缓存、不写审计，读不出为 null（见 `src/server/session-titles.ts`）。t17 起取自活动快照里的会话标题（见“缓存与刷新”），与其它几页的 `sessionTitles` 是同一份 |
| `/api/runs` | “在跑”（t14）：经 nbdev 起的服务（`procs`，登记加现算的状态，还活着的与 24 小时内结束的）、会话派出的运行、无主的运行；后两块按登记的 pid 去重；`sessionTitles` 含各服务的 `startedBy` 与会话派出的运行的属主（属主只剩进程登记、不在活动里也有） |
| `/api/checkouts` | checkout 页（t14）：分支、HEAD、执行 worktree，加未提交（`tracked` 已跟踪的改动、`untracked` 未跟踪的条数，t15 阶段 4 第 4 批）、相对 master 的领先落后、在跑的服务、`home` 是它的 Task 与它是哪些 Task 的（`tasks`：`home` 加目录名认出的）；请求时现算，每个 checkout 留 10 秒，git 调用各自限时 3 秒，到点的标 `timedOut`、计数为 null |
| `/api/checkouts/:key/files` | 一个 checkout 的未提交文件（t15 阶段 4 第 4 批）：`staged`、`unstaged`（各带一个状态字母）、`untracked`（未跟踪的目录算一条，带末尾的 `/`），每段最多 300 条（`truncated`）；同样限时、只读，不缓存；key 不认识 404 |
| `/api/github` | GitHub 只读页（t14）：开着的 PR（检查汇总）与 Issue、状态与取的时刻；见“现场” |
| `/api/notify?workId=&taskId=` | 通知任务（`jobs`）与最近 24 小时的尝试（`recent`，同一次尝试的意图与结果合成一条，只有意图的标 `intentOnly`）、审计状态、这个 herdr 版本是否自动投递；两个参数可选（见“通知与会话页”） |
| `/api/sessions/:paneId/screen?session=` | 一格会话的屏幕末尾（`agent.read` 的 `visible`，去掉转义的最后 60 行）与状态；`session` 是页面看到的会话键，对不上回 409 `session_changed`；这格正被接管时照常能读 |
| `/api/sessions/:paneId/history?session=` | omp 的更早输出（t12，手机的文字视图用）：`agent.read` 的 `recent_unwrapped` 最近 1000 行；Claude 与回滚为 0（前台在备用屏上）的 omp 回 409 `history_unavailable`（见“网页终端”的手机一条） |
| `/api/panes/:paneId/history` | 没有会话键的 pane（开发服务、构建日志、shell，以及认出了 Agent 但还没报会话的）的更早输出（t15 阶段 4 第 3 批，D2）：`pane.read` 的 `recent_unwrapped` 最近 1000 行。pane 不在回 404 `pane_not_found`；不在本仓库里回 409 `not_in_repository`；有会话键的 pane、前台是全屏程序（`scrollback` 为 0）的回 409 `history_unavailable`；不写审计 |
| `/api/search?q=&checkout=` | 搜索，NDJSON 流（见下） |
| `/ws` | 先推 `{type: "hello", instance, revisions}`，之后每块数据变了推 `{type: "changed", instance, parts, revisions}` |
| `/ws/terminal?pane=&terminal=` | 网页终端，一个终端视图一条（见“网页终端”） |

### Task 的执行 checkout

记录从哪里读（`TaskView.checkout`）与代码在哪里改不是一回事。执行 checkout 的候选依次是：README“执行位置”一节里写的 worktree 路径或分支（行内代码）；目录名匹配 `<Work 编号>-<Task 编号>-*` 的 worktree；登记表的 `home`；Work 的执行 worktree；主工作区。同一份 checkout 只按最先命中的规则列一次，选第一个。Task 页的提交在执行 checkout 上取：worktree 里是它的分支相对 master 新增的提交，主工作区里是碰过 Task 目录的提交，各最多 20 个。

### 文档树与差异

- 文档是这些位置的 Markdown（`git ls-files --cached --others --exclude-standard`）：`docs/`（Spec、Proposal、模块、规范、测试、意图）、各处 `docs/adr/`、`packages/*/docs/` 与包根的 `CONTEXT.md`、`README.md`、`.agents/skills/`、`.agents/works/` 根上的 `README.md` 与 `AGENTS.md`（t15 阶段 4：首页的撞号链到这里的处理办法；下面的记录不算文档；这两份与别的主工作区文档一样能在面板上编辑）、`vitepress/`、各处 `AGENTS.md` 与 `CLAUDE.md`、仓库根的 Markdown；路径里有 `node_modules`、`evidences`、`experiments`、`dist` 的不算。Work 与 Task 目录里的 Markdown 由记录索引，不在树里。磁盘上不是普通文件的不列：符号链接（读文档也经路径守卫，指向 `.env` 或仓库外的链接读不到），以及工作区里已删掉、还没暂存删除的文件（差异里记成 `deleted`）。
- 这里的“master”指主工作区的工作区（含未提交的文档），不是 `master` 引用。非主工作区的差异分两类：分支改的（`master...HEAD` 的三点 diff 加工作区里没提交的：`added`、`modified`、`deleted`）；master 有、这里没有、也不是分支删的（`master_only`，分支分出之后 master 新增的）。

### 搜索

- 范围：已检出的 checkout（缺省全部，`checkout=` 只选一个），文件名与内容。`q` 去掉首尾空白后要非空、不含控制字符、长度 2 到 200，否则 400。
- 最先送缓存里 Work、Task、产物标题与会话的匹配（`{type: "record"}`），按相关度排好、最多 50 条（t15 阶段 4 第 5 批，`core/search.ts` 的 `recordRelevance`：标题或编号与搜索词相同，Work 与 Task 的编号也认 `w00022`、`t15` 这样的短号（产物、会话只按完整编号比）；标题以它开头；编号以它开头；标题包含；编号包含。同分时 Work、Task、产物、会话依次在前；先排再截）；再在各 checkout 上并发搜文件名（`ls-files` 的结果按 checkout 的 HEAD 缓存）与内容（`git grep -I -n -i -F --untracked --exclude-standard`），逐条送 `{type: "hit", checkout, kind, path, line, text}`，每个 checkout 做完送 `{type: "checkout_done", count, truncated, elapsedMs, error}`（先做完的先送），最后 `{type: "end", truncated, aborted, elapsedMs}`。
- 排除 `**/evidences/**`、`**/experiments/**`、`**/node_modules/**`；搜索用单独的 Git 调用（不带 `GIT_LITERAL_PATHSPECS`，pathspec 由服务端写死，用户输入只经 `-e`）。结果逐行套段检查。
- 每个 checkout 的文件名与内容各最多 200 条，读满就结束子进程；5 秒截断。全局同一时刻只跑一组：有新搜索或客户端断开就结束旧的子进程，被取代的那组最后一行带 `aborted: true`。

## 写接口

每个接口直接调命令行用的同一个核心函数，取同一把锁（`.local/agent/registry.json.lock`），在 master 上做路径限定的提交。面板以开发者身份写（调用者种类 `developer`，`device` 在 t13 之前一律 `local`）：不取租约；提交信息标“面板”（`面板新建`、`面板编辑`、`面板记下`，状态改动加“（面板）”）；登记表新号的 `by` 是 `{key: "developer:local", agent: "developer", label: "local", 其余 null}`；答复的 `submittedBy` 是 `{kind: "developer", device: "local"}`，`submittedAt` 是服务端收到请求的时刻。

| 接口 | 核心函数 | 请求体（JSON）| 上限 |
|---|---|---|---|
| `POST /api/answers` | `submitAnswer`（`requireLatest`） | `{workId, taskId, artifactId, version, values, comments?, note?}` | 256 KiB |
| `POST /api/artifact-close` | `closeArtifact`；Task 的提问集改用 `withdrawUnanswered`（提问集不能关闭） | `{workId, taskId, artifactId}` | 4 KiB |
| `POST /api/works` | `createWork` | `{slug, title, goal, issue?, taskSlug, taskTitle?, taskStatus?}` | 16 KiB |
| `POST /api/works/:workId/tasks` | `createTask` | `{slug, title, goal?, status?}` | 16 KiB |
| `POST /api/works/:workId/status` | `setRecordStatus` | `{status, expectedHash, includeUncommitted?}` | 4 KiB |
| `POST /api/works/:workId/tasks/:taskId/status` | `setTaskStatus` | 同上 | 4 KiB |
| `PUT /api/files?path=` | `editRecordFile` | `{content, baseHash, includeUncommitted?}` | 2 MiB（内容 1 MiB） |
| `POST /api/preview/work`、`/api/preview/task` | `previewCreateWork`、`previewCreateTask`（不取锁、不写文件） | 同新建；`/task` 另带 `workId`；字段可以不全 | 16 KiB |

**每个写请求的校验**（在“请求校验”第 4 条之后，失败一律 4xx，不进核心函数）：`Content-Type` 必须是 `application/json`（415 `unsupported_media_type`）；请求体按上表限长，读到上限就停（413 `payload_too_large`）；必须是 JSON 对象，只收列出的字段（多出的、拼错的字段名 400 `usage`，`details.field`），类型不对、缺必填 400；路径参数与请求体里的 `workId`、`taskId`、`artifactId` 只接受缓存里存在的值（404）；题号按题号格式校验、存进无原型的对象。写进记录的文字拒绝 C0 控制字符（允许制表符），换行只在正文类字段（目标、说明、备注、文字答复、编辑内容）里允许（核心的规则，命令行一致）：标题报 `invalid_title`，其余报 `invalid_text`。

**HTTP 状态**：用法错误 400，冲突 409，找不到 404，`lock_timeout` 与 `warming_up` 503（确定什么都没写），其余运行失败 500。写入成功但提交失败（`commit.reason` 为 `git_lock_timeout` 或 `git_failed`）回 500 `commit_failed`，`details.writtenPaths` 与 `data.commit` 列出已写的文件；`nothing_to_commit`（内容或状态没变）回 200，`data.changed: false`。成功时 `data` 是核心的结果加 `changed` 与 `commit`。

**并发与时序**：

- 写请求等锁沿用 t06 定的 30 秒，持锁者还可能等 `index.lock` 10 秒。面板来源的 `idleTimeout` 设 60 秒，不在等锁时切断连接（Bun 1.4.2 实测默认的 10 秒会切断没有请求体的请求）。
- 取到锁之后、写第一个文件之前看一次请求是否已断开：断开了就放锁、什么都不写（`request_aborted`，只进面板日志），免得开发者看不到结果再按一次就多领一个号。写了之后才断开的照常提交。
- 写成功后，等记录与活动各重算一次（这次重算在写入之后开始）再回应，回应的 `revisions` 已包含这次写入：前端拿到回应就能打开新建的 Work。
- **哈希绑定**：状态切换带 `expectedHash`、编辑带 `baseHash`（开发者看到的那一版的 sha256，必填）。核心在锁内先比哈希（不一致 409 `hash_mismatch`，`details.currentHash`），再查暂存的改名（目标是暂存区里一次改名或复制的一端时 409 `staged_rename`，不给放行），再查未提交改动（409 `uncommitted_changes`，`details` 带 `currentHash`、`status`、`staged`、`unstaged`、`untracked`）。开发者看过差异、选“连同这些改动一起提交”后，前端带 `includeUncommitted: true` 与 `currentHash` 重发（待决问题 8）；这些改动会以面板的名义提交进 master。
- **落位之后的核对**：`git add` 之前重读本次写入的每个文件，与写入的内容不同（别的进程在这之间改了它）就不提交，409 `changed_after_write`（`details.writtenPaths`），你的改动留在工作区。提交里的 blob 与写入内容不同时给警告 `commit_included_foreign_changes`。
- 答复只收针对最新一版的（`requireLatest`，锁内比对，否则 409 `stale_version`，`details.latestVersion`）；Work 级产物没有发布记录，不能答。

**编辑**（`editRecordFile`）：只改主工作区里已有的文件，不新建、不删除、不改名；worktree 上的文件不给改（写事务的锁与提交只覆盖主工作区）。在锁内判定能不能改：段检查合格（与“路径守卫”相同）、从仓库根到文件每一段都不是符号链接、是普通文件，再按类——Work 与 Task 的 README（记录来源是 master、README 已提交；来自分支的报 `branch_maintained_record`）、Work 与 Task 目录第一层的文档类产物（在重算的记录索引里逐字出现）、主工作区的文档（在重算的文档树里逐字出现）；不合格 409 `not_editable`（`details.reason`）。README 的新内容在锁内校验：frontmatter 能解析，`schema`、`workId` 或 `taskId`、`issueId`、`status` 与原文相同（改状态要用状态切换），不新增治理检查禁止的旧字段，否则 400 `invalid_record_edit`（`details.problems`）；有改动时核心把 `updated` 改成当天。编辑其它文档不碰 README。

**审计**：每个写接口在写事务之后补一行审计结果（见“审计”）；审计没初始化时跳过，初始化过却写不进去时照常回应、给警告 `audit_write_failed`。

## 通知与会话页（t11）

答复之后，面板给提问的会话的输入框里投一行指针消息，会话照着读答复、记进 Task 并确认。会话页能看一格会话的屏幕末尾、往它的输入框里发文字、发按键。投什么、什么时候投、什么时候不投，判据见 [herdr.md](herdr.md#投递t11)。t11 不做 steer，也不做“会话工作中仍然发送”：会话在工作时一律排队，只投给空闲、且输入框认出为空的会话。

**通知任务**不落盘，每次现算；`.local/agent/run/notify/` 只记“对哪几份答复、向哪个会话做过什么”（格式见 [file-formats.md](file-formats.md#通知的尝试记录)）。

- 一条任务的键是（Task、提问者会话）。它覆盖的答复：这个 Task 里开发者提交的、对这个会话问的至少一道题有取值、还没对它办完的答复（代录的答复是会话自己写的，不通知）。提问者取题第一次出现的那一版的 provenance。
- 一份答复对提问者 X 算办完：尝试记录里有对 X 的 `delivered`、`delivered_into_blocked`、`delivered_maybe_wrong_session`、`uncertain` 或 `skipped`（手动另选会话发的，也算 X 这一份）；只有意图、没有结果的按 `uncertain` 算（面板在投递途中退出，界面提示看终端）；或者覆盖它的确认的 provenance 会话键就是 X。别的会话的确认不算 X 办完；确认没有 provenance（换了机器、删了 `.local`）时退回“已确认就算办完”，这时可能漏通知。`run/notify/` 丢了，办完的最多重发一次。
- **启用时刻**是审计初始化的时刻（`init.json`）。答复 id 里的时刻早于它的只进 `legacy`，不自动发、可以手动发；审计没初始化时任务都是 `audit_unavailable`，不发。
- **什么时候现算**：记录、活动、会话变了，写接口成功之后（第二份答复不改变记录缓存的指纹，不会经推送触发），以及每 15 秒兜底。有排队的任务、没有浏览器时 herdr 的兜底轮询放慢到 15 秒。
- **任务的状态**（`jobs[].state`）：

| 状态 | 含义 | 界面 |
|---|---|---|
| `ready` | 空闲，稳定 3 秒、判定可投之后自动发 | “几秒内通知” |
| `waiting_idle` | 在工作 | “已排队：这一轮结束后通知” |
| `waiting_blocked` | 在等确认 | “在等确认，排着” |
| `waiting_input` | 空闲但输入框不是认得出的空（`waitReason`、`screen`）；状态序号变了（`agent.get`，不读屏）或过了 15 秒才重读屏幕 | 原因与屏幕末尾，可手动发 |
| `waiting_takeover` | 开发者正在面板里接管这个终端的键盘（t12） | “释放之后再通知” |
| `unknown_status` | 状态未知，不自动投 | “空闲之后自动判定”，不给手动发送（手动发送同样要求空闲） |
| `waiting_herdr` | herdr 不可用 | 排着 |
| `replaced` | 提问者不在 herdr 里，它提问时所在的 pane 上换了一个本仓库里的会话（`replacedBy`） | 小窗：发给现在的会话（开发者名义的普通消息，见下），或不通知 |
| `no_target` | 提问者不在 herdr 里（结束了、外部会话） | 列出持有这个 Task 有效租约、在 herdr 里、pane 在本仓库的会话（`alternatives`），各一个“通知它”（开小窗，开发者名义的普通消息）；没有就写“会话下次读答复时会看到” |
| `not_in_repository` | 提问者的 pane 已不在本仓库 | 不自动通知，可选别的会话 |
| `manual_only` | 这个 herdr 版本不自动投递（只放行 0.9.1 与 0.9.3） | 可手动发 |
| `legacy` | 只有早于启用时刻的答复 | 可手动发 |
| `audit_unavailable` | 审计不可用 | 提示初始化 |

- **按会话键找提问者**，与租约是否有效、是否续接无关；pane id 只用来判“会话已更换”。
- **指针消息**（一行，不放答复正文；与根 `AGENTS.md` 里 `[nbdev]` 那一句逐字对应）：`[nbdev] <W>/<T> 有 N 题新的开发者答复（产物 a、b）。对括号里列出的每个产物，运行 nbdev answers <W> <T> <产物> --json 读答复并把决定写进 Task 记录；再运行 nbdev answers ack <W> <T> <产物> --through <该次输出里的 cursor>。`
  - 按产物逐个读、逐个确认：Task 级的 `answers --json` 会列出没有答复的产物（报告、未答的提问集），对它们 `ack` 报 `no_answers`，输出也成倍变长。
  - 读答复不带 `--unacked`：别的会话先确认之后，这个会话照样读得到与自己有关的答复。
  - 手动发给提问者时连旧答复一起（`manualMessage`）。
- **发给不是提问者的会话**（会话已更换后的新会话、持有租约的会话）：根 `AGENTS.md` 的 `[nbdev]` 规则只让提问者照做，所以面板不给它们发 `[nbdev]` 通知，而是发一段以开发者名义的普通消息。小窗预填 `developerMessage`（“开发者在面板上答复了 <W>/<T> 的提问（产物 a、b，共 N 题）。请对括号里列出的每个产物，运行 …”，连旧答复一起），开发者可以先改，确认后才发；同样经过投递前的判定，审计照记（`detail.kind: developer_message` 与全文）。这是开发者亲手做的决定，会话按普通用户消息处理。
- 同一个终端的所有发送（通知、文字、按键）与网页终端的接管在面板里经一把按 terminal id 的互斥串行（t12 之前按 pane id；pane 跨 workspace 移动会换 pane id）。收到 SIGTERM 时先等进行中的投递结束（上限为等待时限加 2 秒），再收口。

**接口**（写请求的校验同“写接口”，在它之前已核过转发头、Host、登录、`Sec-Fetch-Site`、Origin 与 CSRF）：

| 接口 | 请求体（JSON） | 结果 |
|---|---|---|
| `POST /api/notify/send` | `{workId, taskId, sessionKey, target: {paneId, sessionKey}, text?, confirmScreen?}`：`sessionKey` 是提问者（任务的键），`target` 只能是这条任务列出的会话（提问者本人、`replacedBy`、`alternatives`），否则 409 `session_changed`（`details.reason: not_a_candidate`）。发给提问者本人时不带 `text`，发的是指针消息（带了回 400，`reason: asker`）；发给别的会话必须带开发者确认过的 `text`（最长 4000 字，拒绝 C0 控制字符，不能以 `[nbdev]` 开头：`reason` 为 `missing`、`too_long`、`nbdev_prefix`） | `{result, code, message}`；`result` 见尝试记录 |
| `POST /api/notify/skip` | `{workId, taskId, sessionKey}` | 记 `skipped`，这些答复（连旧答复）对这个提问者办完 |
| `POST /api/sessions/:paneId/prompt` | `{text, expectedSession, confirmScreen?}`：最长 4000 字，拒绝 C0 控制字符（允许换行与制表符） | `{result, code, message}` |
| `POST /api/sessions/:paneId/keys` | `{keys, expectedSession, confirmed?}`：一次 1 到 4 个，只收 `up`、`down`、`shift+tab`、`enter`、`esc`、`ctrl+c`、`y`、`n`（其它 400 `key_not_allowed`）；除上、下之外都要 `confirmed: true`（只防前端误发，确认框在前端）；一次最多一个 `ctrl+c`，同一格 3 秒内第二次 409 `key_rate_limited`（调 herdr 之前记账） | `{sent}` |

- **顺序**：字段与长度、键名白名单 → 审计可用（否则 409 `audit_unavailable`，什么都不调）→ Ctrl+C 限速 → `agent.get` 核对会话键（`expectedSession` 为空或 pane 上没有会话一律拒绝）、pane 在本仓库、文字还要求空闲 → 写审计意图（写不进去就不发）→ 调 herdr → 写审计结果。
- **文字与手动发送的两步确认**：正向白名单不过时回 409 `not_deliverable`，`details.screen` 是屏幕末尾，`details.screenDigest` 是这一屏的摘要（判定原因加屏幕末尾的 sha256）；开发者看过之后把摘要原样放进 `confirmScreen` 再发。服务端重新判定，摘要不同（两次请求之间屏幕变了）就再回 409、给新屏幕与新摘要，不发；紧贴投递的核对照做。
- **会话页的动作绑定发起时的目标**（t15）：按键与文字的两步确认、接管小窗都记下打开时的 pane、终端与会话（`src/web/host/session-console.ts`）；确认那一刻选中的目标变了（推送里这格换了会话、后退换了 `?pane=`、pane 没了）就不发，关掉小窗并提示目标变了。读屏与读更早的输出回来时目标还是发起时的那个才显示。按键的确认框用打开前这一次读到的屏幕；这次没读到也照开（Esc、Ctrl+C 常在会话失控时用），但写明没读到的原因、框里是多久以前读到的画面。输入框的草稿按 pane 记：换 pane 时清空；同一格换会话（`/compact`、`/clear`）时保留，输入框上方提示“发出去会发给新会话”；给 A 的文字判定不可投时已经换了目标，不再问“仍然发送”，提示这段没有发给 A（换了格时附上原文）。发送成功后清空草稿：回包回来时已经换到别的格，不清那边的；还是同一格、只是换了会话（发的就是 `/clear`）照样清，并收起换会话的提示。服务端的 `expectedSession` 照旧核对，挡住面板还没轮询到会话已换的窗口。
- **HTTP 状态**：用法 400，冲突 409（`session_changed`、`agent_busy`：在工作、在等确认或状态未知、`not_in_repository`、`not_deliverable`、`audit_unavailable`、`key_rate_limited`、`pane_controlled`：这格正被你在面板里接管键盘，t12），找不到 404（`question_not_found`：没有这条任务），`herdr_unavailable` 503。投递本身的结果（`delivered_into_blocked`、`uncertain` 等）在 200 的 `data.result` 里。

## 网页终端（t12）

会话详情里的屏幕末尾换成实时终端：观看是只读的实时画面；需要时接管键盘直接操作，离开时把控制权交还。herdr 那边的两条流、尺寸与控制者的规则见 [herdr.md](herdr.md#终端流t12)。实现在 `src/server/terminal-hub.ts`（中枢）、`src/web/host/terminal-socket.ts`（页面的连接）与零件 `TerminalView`、`TerminalTextView`、`TakeoverDialog`。

- **开放给谁**：观看给本仓库 checkout 里的所有 pane；接管、文字与按键只给有会话键的 pane（t15 阶段 4 第 3 批，D2）。有会话键时页面看到的与服务端核对的是同一个会话，换了会话（`/clear`）能发现；开发服务、构建日志、shell，以及 herdr 认出了 Agent 但还没报会话的 pane 没有会话键，核对不了“发给的是谁”，所以只读：接管回 `not_allowed`（连接照常观看）；文字与按键回 409 `session_changed`（`details.reason` 是 `not_found`），之前只调了只读的 `agent.get` 核对，不调写方法、不写审计。连接按终端建，不随会话换：接管时用闸门核对过的 pane 刷新连接记下的会话键与 Agent，所以看着 shell 时里面起了 Agent、再接管，审计记的是这个会话。别的仓库的 pane 只在列表里列出（决定点 20）。
- **能不能用**：`/api/meta` 的 `terminal`。找不到 herdr（`NBDEV_HERDR_BIN` 或 `PATH`）、`setpriv` 或 `setsid`，或面板没连 herdr 时不可用，会话页退回 t11 的屏幕末尾。

### 连接与消息

`WS /ws/terminal?pane=<pane id>&terminal=<terminal id>`：一个终端视图一条连接，连接的生命周期就是子进程与控制权的生命周期。页面按 pane 与终端建连接，换选中的 pane 时关旧连、建新连，终端零件按“这一条连接”重建；同一格换会话时连接与终端都不动（t15）。登录失效时关掉连接，重新登录后重建。观看时子进程是 observe，接管时是 control（control 自己也出帧，接管期间不再要 observe）。

- **升级前**只做与 `/ws` 相同的五道安全校验（转发头、Host、登录、`Sec-Fetch-Site`、`Origin`），pane 与 terminal 只核写法，失败回 HTTP 4xx。终端连接不进 `/ws` 的广播、不发 `hello`、不算“有浏览器连着”（不开 500 毫秒的 pane 轮询）。
- **升级后**核：面板不在退出、终端功能可用、terminal id 在 herdr 里且对应的正是这个 pane、pane 在本仓库且有 Agent、上限（一个终端 4 条，整个面板 16 条）。不过就以关闭码关闭并带原因：

| 关闭码 | 原因 | 页面 |
|---|---|---|
| 1001 | 面板退出 | 重连 |
| 4400 | 消息不对：不是 JSON 对象、不认识的类型、尺寸不是整数、输入不是文字或超过 64 KiB、键名不在清单里 | 不重连，显示原因 |
| 4401 | 登录失效（t13 吊销设备时用） | 不重连，显示原因 |
| 4403 | 不是本仓库里的 pane（t15 阶段 4 起，本仓库里没有 Agent 会话的 pane 也能只读观看，D2） | 不重连，显示原因 |
| 4404 | 终端不在了（pane 关了或换了 id），或观看的流连续 3 次没出一帧就结束 | 不重连，显示原因 |
| 4409 | 超过上限 | 不重连，显示原因 |
| 4410 | 积压太多、Bun 丢了帧 | 重连（第一帧就是整屏） |
| 4503 | 终端功能不可用 | 不重连，显示原因 |

- 其它断开（网络、Bun 的空闲超时 30 秒）：重连前先取一次 `/api/meta`，回 401 就停止重连（与 `/ws` 一样），否则退避重连（1 秒起、翻倍、上限 10 秒）。**重连之后只恢复观看，不自动重新接管。**
- **服务端 → 页面**（JSON 文本消息）：
  - `{t: "state", mode: "watch" | "control", cols, rows, sizeKnown, controller, paneId, terminalId, agent}`：模式或尺寸变了就推。`controller` 是 null 或 `{by: "this" | "other_browser", since, device}`（本面板里谁在接管）；`sizeKnown: false` 时页面写“尺寸不确定，可能裁切”。
  - `{t: "frame", seq, full, w, h, b}`：herdr 的帧，`b` 是 base64，原样转发。
  - `{t: "need_confirm", reason: "controlled_elsewhere" | "other_browser", detail}`：接管要先确认（见下）。
  - `{t: "released", reason, restored, notRestored}`：释放了，之后回到观看。
  - `{t: "error", code, message}`：`not_allowed`（这一格没有 Agent 会话，只能看，不能接管；接管的闸门先要求 Agent 会话与非空的 `expectedSession`，再比会话，t15 阶段 4）、`audit_unavailable`、`session_changed`、`busy`（正在接管或握手）、`takeover_timeout`、`takeover_failed`、`herdr_unavailable`（按钮没发出去）。
- **页面 → 服务端**：`{t: "takeover", cols, rows, expectedSession, force}`；`{t: "input", data, paste?}`、`{t: "resize", cols, rows}`、`{t: "key", key}`（这三种只在接管时收，尺寸夹到 20 到 400 列、5 到 200 行，键名同 t11 的按键清单）；`{t: "release", reason?: "hidden"}`；`{t: "alive"}`（接管期间每 5 秒）；`{t: "resync"}`（观看时，连接推过帧之后才挂上的视图要整屏：服务端重起 observe）。

### 观看

- observe 的视口取 pane 的 pty 尺寸；这格正被本面板接管时取接管的尺寸。读不到时用 120×40，标“尺寸不确定”。设计审查建议过读不到时取 `pane.get` 的 `viewport_rows` 补行数，没有采用：列数仍然不知道，裁切照样会发生，不如明说不确定。
- 每 5 秒复查一次尺寸，变了就重起 observe（新的第一帧是整屏）；本面板接管、resize、释放之后，看这格的其它连接按新尺寸重起。重起与读尺寸并发时只留一个 observe。
- 观看中流结束：终端还在就重起，不在就 4404。连续 3 次没出一帧就结束（一行都没有，或第一行就是 `terminal.closed`）也以 4404 关，不无限重起；`terminal.closed` 的原文进面板日志（实现审查 F5）。
- 观看不改尺寸、不写审计、不往会话里写任何东西。页面切到后台时观看也停（页面关掉终端连接），切回来再连，第一帧就是整屏。在后台打开会话详情（或断线重连时恰在后台）时先记为暂停、不连，回到前台才连（t15）。

### 接管与释放

- **前提**：审计可用（与 t11 的文字、按键一样，否则 `audit_unavailable`、连接照常观看）；页面带来的会话键与这格现在的一致（否则 `session_changed`）；不在手机上（见下）。
- **接管前的提示**（页面的模态框，确认才发 `takeover`）：终端会改成网页的尺寸（写出新旧两个尺寸），herdr 那边重排，释放时改回；herdr 那边（键盘与其它程序）照样能写进这个终端，两边的输入会混在一起；接管期间面板不自动投递通知，会话页的输入框不用；切到别的标签页、关掉页面、断线、15 分钟没有输入都会自动释放。
- **握手**在这个终端的锁里（与 t11 的通知、文字、按键同一把，排在进行中的投递后面）：读接管前的 pty 尺寸，写审计意图（写不进去就不接管），收掉这条连接的 observe，先不带 `--takeover` 起 control，等第一行最多 5 秒：
  - 是帧：接管成功，登记“这个终端由本面板的这条连接控制”，写审计结果 `attached`，推 `state`；
  - 是结束、终端还在：别处（本面板之外）在控制，审计结果 `controlled_elsewhere`，推 `need_confirm`（`controlled_elsewhere`，`detail.text` 是 herdr 的原文）；开发者确认“抢过来”之后页面带 `force: true` 再来，这次带 `--takeover`；
  - 本面板另一个浏览器在控制：不起 control，直接推 `need_confirm`（`other_browser`，`detail.since` 是它开始的时刻）；确认之后带 `--takeover` 抢过来，那边收到 `released`（`taken_over`）、回到观看。接管前的尺寸交给新的接管者，那边释放时不改回，新的接管者释放时改回最初的尺寸；
  - 5 秒没有第一行：收掉子进程，`takeover_timeout`，审计结果 `failed`，锁放开；终端不在了：4404。
  - 握手期间连接关了（关标签页、切后台）：control 还没起就不起，审计结果 `failed`（`disconnect`），什么都没改过；已经接上（尺寸已改成网页的）就照常释放，改回尺寸，审计是 `attached` 加一行原因为 `disconnect` 的释放（实现审查 F4）。
- **接管期间**：键盘输入原样经 `terminal.input` 写进去；窗口尺寸变了，页面去抖 150 毫秒后发 `resize`。按钮单击即发（键盘本来就直通，再两步确认没有意义），经 `agent.send_keys`（herdr 按应用当前的模式编码），不逐条写审计，计入释放行的统计。粘贴先去掉 Esc 与其它 C0 控制字符（换行、制表符除外），挡住用 `\e[201~` 提前结束粘贴的路子；Agent pane 在 xterm 本地打开 bracketed paste，多行粘贴被包起来、不会逐行回车。Ctrl+C 有选中的文字时是复制、不发；Ctrl+W、Ctrl+T、Ctrl+N 浏览器拦不住，状态条写明，删词用 Alt+Backspace。
- **释放**（任何原因同一个收口）：读到过接管前的尺寸、又不是交给了另一个浏览器，先发 resize 改回；再 release、关 stdin，1 秒不退 SIGTERM，再 1 秒 SIGKILL；写审计的释放行；推 `released` 并回到观看；看这格的其它连接按恢复后的尺寸重起；通知现算一次。`restored` 的含义是“发出了改回尺寸的指令”，不是核对过 pty 的结果；没改回时 `notRestored` 写原因（`size_unknown`、`handed_off`、`stream_ended`）。
- **释放的原因**：`user`（点释放，或在终端里按 Ctrl+]：接管中这个组合键由页面截下、不发给 pane）、`hidden`（页面切到后台：页面先发 release 再关连接）、`disconnect`（连接关了）、`heartbeat`（15 秒没有心跳：网络断了而 TCP 还没断）、`idle`（15 分钟没有输入）、`taken_over`（被本面板之外或本面板另一个浏览器抢走）、`pane_closed`（终端不在了）、`panel_exit`（面板退出）、`session_closed`（登录失效，t13）。
- herdr 的 TUI 收不到任何“网页在接管”的提示（herdr 没有给它推的接口；在 TUI 上弹通知要给白名单加 `notification.show`，t12 不做）。

### 与 t11 的互斥

herdr 不拦 API 写入（见 [herdr.md](herdr.md#终端流t12)），互斥由面板自己保证：

- 这格被本面板接管时，通知任务是 `waiting_takeover`，不自动投递；释放时现算一次，之后照常走稳定 3 秒与正向白名单。
- 手动发送、会话页的文字与按键回 409 `pane_controlled`（接管者自己的页面在接管期间不给输入框，按钮走终端连接）；读屏（`/screen`、`/history`）照常。锁内紧贴投递的 `agent.get` 拿到 terminal id 后还会再查一次“正被接管”。
- 这条互斥只管面板自己：herdr 那边的键盘、别的程序，以及会话自己的 herdr 命令行（`herdr agent prompt`、`pane send-text`）都不受约束，照样能写进这格，与接管提示写的一致。

### 安全与审计

- **谁能看、谁能接管**：登录了的浏览器。t13 之前只有本机与经 SSH 转发过来的设备能登录；开发者 2026-10-13 定别的设备登录后与本机权限相同，所以不分级。每条终端连接记下升级时的登录会话与设备（t12 一律 `local`）；中枢有“关掉某个登录会话的全部终端连接（接管先释放）”的入口，留给 t13 吊销设备。
- **帧里有屏幕上的一切，包括秘密**：密钥、令牌、开发者粘贴的内容都会经帧到浏览器。面板不缓存帧、不落盘、不写进日志（日志只记读不懂的行与子进程的 stderr，各截断）；帧只在登录过的连接上传。跨设备之后（t13）帧会经转发到别的设备，与“面板登录等于 SSH 登录”（Proposal 第八节）一致。
- **键盘内容不进审计**（t12 决定点 2）：审计写接管的意图与结果、释放行的统计（输入条数与字节数、回车、粘贴次数与字节数、resize、按钮、时长），不写按了什么（格式见 [file-formats.md](file-formats.md#审计)）。这与 t11 决定点 6（文字与通知的全文进审计）不同：那是一条一条、开发者看着发出去的消息；接管是连续的键盘流，会有 sudo、ssh 的密码，Proposal 第八节第 9 条本来就写“文字或长度”。代价是跨设备之后，审计回答不了“在终端里打了什么”，要看会话的 transcript 与终端。观看不写审计。
- **背压**：WebSocket 积压超过 1 MiB 就暂停读这条连接的子进程 stdout，`drain` 时恢复（herdr 读端跟不上时自己合并帧；Bun 停读之后还会先攒几百 KB），一条连接的面板内存约 1.5 MiB 封顶。`send` 回 0（Bun 丢了帧）就以 4410 关连接让页面重连，不带着缺帧的画面继续。

### 手机

窄于 768px 或 `(pointer: coarse)` 时：

- 默认文字视图：同一条 observe 流，页面里一个不挂到页面上的 xterm 实例解析帧，最多每 200 毫秒把当前屏幕转成可换行的文字。实时，不调 `agent.read`，不会滚动 Claude 的界面。可以切到“终端画面（只看）”，再用“回到文字视图”切回来。
- 不给接管（t12 决定点 3）：xterm.js 上的中文输入法不稳、屏幕太小，接管还会把真实终端改成手机的尺寸。输入框与按键用 t11 的（同一个零件、同一个接口与判据）。
- 桌面上接管之后把窗口缩到窄于 768px：仍是终端视图（“你已接管键盘”与“释放”都在），终端按变窄的框 resize；释放之后才换成文字视图（实现审查 F2）。不在变窄时自动释放：缩窄窗口不等于离开，开发者的键盘还在这个页面上。
- **更早的输出**只给 omp：`GET /api/sessions/:paneId/history?session=` 读 `recent_unwrapped` 最近 1000 行，点一次读一次。Claude 回 409 `history_unavailable`：它在备用屏上，读多于可见行要滚动它的界面、工作中直接报错（t11 设计审查 S4）；完整历史在会话的 transcript 里。这与 Proposal 第七节写的 `recent-unwrapped` 不同（t12 决定点 10）。

### 退出

`stop()` 先把中枢标成“正在退出”（此后子进程自己退出一律记 `panel_exit`，不回到观看、不重起），释放全部接管（改回尺寸、写释放行），收全部 observe，以 1001 关连接，再走 t11 的收口。作为服务运行时单元的 `KillMode=mixed` 只给面板 SIGTERM、等它收口，`TimeoutStopSec` 到了才 SIGKILL 剩下的。面板被 SIGKILL 时子进程靠 pdeathsig 退出、控制权随之释放，但尺寸没有改回，审计里有接管、没有释放行。

**没有验证的**：真实输入法（fcitx5）上的组合输入（自动化只用 Playwright 的 `insertText` 模拟提交一段文字）；在真实 Claude 上接管（只在名为 claude 的假界面上做过）；真实 TUI 上开发者看到的重排。这几项在开发者在场的验收里做（Task 的计划“设计审查的处理”一节）。

## 现场（t14）

左栏“现场”下有会话、在跑、checkout、GitHub 四页。都是临时数据、只读：停服务用命令行 `nbdev dev stop`，面板不提供停、重启服务或任何 GitHub 写操作的按钮。

- **在跑**（`/live/runs`，左栏的数是还活着的登记服务加无主的运行）：
  - 第一块是经 `nbdev dev start` 起的服务：状态（启动中、在跑、没人监管、已结束）、checkout、package、script、地址、谁起的、Task、原因与日志路径（只显示路径）；
  - 第二、三块是 t07 认出的会话的运行与无主的运行。运行树里（根或任何后代）含有登记的监管进程、组长或后代快照里的 pid，整棵从这两块去掉（核对启动时刻），只在第一块出现。
  - 随“活动”这一块（有浏览器连着时 5 秒）刷新。
- **checkout**（`/live/checkouts`）：分支、HEAD、执行 worktree，加：
  - 未提交：`git status --porcelain=v1 -unormal` 分成两个数，已跟踪的改动（含暂存）与未跟踪（未跟踪的目录算一条，t15 阶段 4 第 4 批；以前是 `-uno`，新文件不算，会显示成“干净”）；点开看文件清单（`/api/checkouts/:key/files`）；
  - 领先、落后：`rev-list --left-right --count master...HEAD`；
  - 在跑：这个 checkout 上还活着的登记服务；
  - `home` 是它的 Task（登记表）。

  未提交与领先落后在请求时现算，4 路并行，每个 checkout 留 10 秒（HEAD 变了就重算）；每个 checkout 的 git 调用各自限时 3 秒，冷的大 worktree 不拖住整页，到点的写“没算完”。页面开着时每 10 秒自己重取一次（改文件不改变“活动”，只随推送重取会一直显示旧值），标“N 秒前算的”、按秒走。不按 HEAD 与 index 的 mtime 缓存：没 `add` 的改动不改 index（面板的 Git 读操作带 `--no-optional-locks`），会一直显示“干净”。不做“可清理”。
- **GitHub**（`/live/github`）：
  - 面板只调白名单里写死的两条命令：`gh pr list --state open --limit 100 --json number,title,headRefName,isDraft,reviewDecision,statusCheckRollup,updatedAt,url` 与 `gh issue list --state open --limit 100 --json number,title,labels,updatedAt,url`，cwd 是主工作区。按仓库维护流程，不取 `body`、`comments`、`reviews`。条数到上限时页面写“只列最近更新的 N 个，可能还有更多”。
  - 检查汇总按 `__typename` 分：`CheckRun` 看 `status` 与 `conclusion`，`StatusContext` 看 `state`；失败的逐个列出，`CheckRun` 写成“工作流 / 检查名”（`workflowName`，不同工作流里可能有同名的检查）。分支名是 `<type>/<Work 编号>-<Task 编号>-…` 且找得到 Task 时链到面板的 Task 页。
  - 标题、分支名、标签是外部的不可信内容，一律按纯文本渲染；链接只收 `https:`。
  - 什么时候取：
    - 打开页面时，页面发一次 `POST /api/github/refresh`，带 `{"ifStale": true}`：从没取过、上一份取到了且超过 5 分钟、或上一次没取到且已过 60 秒，才在后台取，不等结果；
    - 有浏览器连着时，取到过的数据每 5 分钟刷新；
    - “刷新”按钮发不带 `ifStale` 的同一个请求，立即取并等结果，不受上面的间隔限制。

    这个接口走写请求的 Origin 与 CSRF 校验，不经 `gh` 写任何东西。单飞，结果只在内存里。每次尝试只在结束时经 `/ws` 推一次 `github` 这一块，开始取时不推；`GET /api/github` 只读当前这一份、不触发取数。页面收到推送只重取这个 GET，所以推送与取数不会互相引发：曾经每次 GET 都会触发取数，`gh` 一直失败时，推送、重取、再取数成环，10 秒调了上万次 `gh`（t14 实现审查 B1）。`github` 的推送也不触发通知的重算。
  - 子进程环境加 `GH_PROMPT_DISABLED=1`、`GH_NO_UPDATE_NOTIFIER=1`、`NO_COLOR=1`，stdin 关掉；单次 15 秒，超时先 SIGTERM、2 秒后 SIGKILL。
  - `gh` 的路径：先看 `NBDEV_GH_BIN`（绝对路径，`install-service` 写进单元），再找 `PATH`；`NBDEV_GH_PREFIX`（例如 `prox`）给了就放在前面。
  - 降级按退出码，不看文案：找不到 `gh` 是 `unavailable`（写明设 `NBDEV_GH_BIN`）；以 4 退出是 `not_logged_in`（提示 `gh auth login`）；超时、其它非零或输出读不懂时，取过就保留上一份标 `stale`，没取过是 `error`。

## 审计

`${XDG_CONFIG_HOME:-~/.config}/nbdev/audit.jsonl`：只追加，一行一个 JSON（格式见 [file-formats.md](file-formats.md#审计)）。不放 `.local/agent/`：Agent 能读写那里。

- **初始化**：包脚本 `bun run --cwd packages/dev-panel audit-init`（不进 nbdev 的命令面）建目录（700）、空的 `audit.jsonl`（600）与 `init.json`（启用时刻）；开发者亲手运行它就是授权。面板与命令行都不建这个目录。已经初始化过再运行不改启用时刻。
- **可用**：目录与文件都在、都是属主为自己的普通目录与文件、权限不宽于 700 与 600、`init.json` 读得出。每次写之前核对，不符合按 `audit_unavailable` 处理并写明原因（`reason`：`not_initialized`、`not_regular`、`bad_owner`、`bad_mode`、`unreadable`）。
- **审计不可用时**：通知、文字、按键与网页终端的接管都不开放（409 `audit_unavailable`，界面提示；观看照常）；写仓库照常（未初始化时不补审计，初始化过却写不进去时给警告 `audit_write_failed`）。
- **写什么**：通知、文字、按键各写一行意图（`phase: "intent"`）、一行结果（`phase: "result"`），用同一个 `actionId` 关联，意图写成了才调 herdr；网页终端的接管写一行意图、一行结果，释放再写一行（只有统计，没有键盘内容，见“网页终端”）；写仓库（`answer`、`create_work`、`create_task`、`status`、`edit`）在写事务之后只写一行结果（提交 sha 或失败理由、路径，不记文件内容）。文字与通知的全文进审计（决定点 6：开发者知情，秘密会进审计）。
- 面板进程里只有一个写者，排队串行，每行一次 `O_APPEND` 追加。

## 缓存与刷新

页面请求只读内存里的缓存，从不现算整份 `status`。分四块各自刷新，变了就经 `/ws` 推“哪块变了”；只有显示用到的字段变了才增加 revision（运行的子进程数随时在变，不算）。每块的重算单飞并合并（进行中又来变化只再排一次）；失败时保留上一份，在 `/api/meta` 的 `parts.<块>.error` 标出，并推一次这块变了（revision 不变）；之后重算成功、内容没变时也推一次，外壳重取 `/api/meta` 后去掉顶栏的提示（t15）。

- **记录**（Work、Task、收件箱、撞号）：`fs.watch` 递归监视主工作区的 `.agents/works/`（去抖 300 毫秒，过滤 `evidences/`）；每 5 秒看一次 `git worktree list` 与 master 的 sha，变了才重算（过渡期判定的已提交部分按 master 与各 checkout 的 HEAD 缓存）；有浏览器连着时每 30 秒兜底整份重算，顺带重算各 worktree 未提交的记录改动。
- **活动**（租约、会话、运行）：租约是否有效是读取时现算的（会话退出、过期、Task 关闭都不碰租约文件），所以有浏览器连着时每 5 秒整份重算；记录或会话变化时也重算。监视租约目录只当加速，目录不存在时先监视 `.local/agent/`，都不在就只靠 5 秒的重算；面板不建这些目录。
  - **会话标题**（t17）：作为活动的一部分保存，各页数据里的 `sessionTitles`（`{会话键: {text, source}}`，读不到或还没读到标题的键不在里面）都从这一份取，GET 时不查盘。活动的发布不等读标题：每次活动算完就用已知的标题发布，再起一个后台任务读标题（同一时间只有一个，在读时又被要求就在读完后按最新的会话再读一轮）；一轮最多 2 秒，没查完的会话沿用已知的标题，留到下一轮（日志记一条“还有 N 个会话没查完”）。任务读完、标题有变化时只改快照里的标题，按此刻最新的那批会话取，过期的一轮不会把会话集合改回去。要读的会话：有效租约的、活动里的会话（含运行的属主）、经 nbdev 起的服务的 `startedBy`、herdr 各格上的会话（含没有租约、不是运行属主的格子）、收件箱的提问者。完整会话键只按第一个冒号拆成 Agent 与会话值（omp 的会话值可能是含冒号的绝对路径），Agent 只认 `claude`、`codex`、`omp`，`external:` 与不认识的 Agent 不读；表一律按完整键索引。一轮里 Claude 的 `projects/` 只列一次，同一个键在查时不另查；查找最多 4 个同时进行，这个上限整个面板共用、不按轮算：一轮到点后还在读盘的查找照样占着名额，直到它结束，下一轮的新会话等名额空出来再查；到点的那一轮还没开始的会话就此放弃，名额空出来后不再替它查，留给之后按最新会话发起的一轮。Codex 的 `session_index.jsonl` 只追加、可以很大，只读末尾 4 MiB，取其中各会话的最后一个名字；只出现在更早位置的会话按没有标题处理，面板日志记一条（同一份索引只记一次）。面板停止时（`PanelServer.stop()`）不再开始读标题、不再改快照，并等已经开始的读盘结束，最多 3 秒，超时记一条日志后返回；之后它们结束也不改数据。找不到的会话文件仍记 60 秒，所以新会话的文件出现后，标题最晚约一分钟后才出现。标题的文字与来源（含从无到有、从有到无，按完整键排好）算进活动的指纹，改了名就照常增加 revision、推 `activity`，已打开的页面随之重取。
- **会话**：见 [herdr.md](herdr.md#面板的订阅与对账)。herdr 不阻塞服务开始监听。
- **通知**：通知任务的列表或状态变了（见“通知与会话页”）。通知自己的变化不再触发通知的现算。
- 重算单飞并合并：进行中又被要求重算时排一次在后面，等它的调用方拿到的是这次之后才开始的结果（写接口据此等到包含自己写入的数据）。
- **代码已更新**：每 5 秒比较 `git rev-parse HEAD:packages/dev-panel`、`HEAD:packages/nb-ui`、`HEAD:bun.lock` 与启动时的，不同就在 `/api/meta` 标 `codeChanged`。只改记录的提交不会触发。顶栏的提示写出重启命令：作为服务运行时是 `systemctl --user restart <单元>`，前台运行时是“在终端重启 nbdev panel serve”。不放重启按钮：面板不经 HTTP 结束自己。

## `panel serve` 与 `panel open`

`panel serve` 在前台运行：

1. 在 `.local/agent/run/panel.lock` 取面板锁（同一个主工作区已有面板在跑时报 `panel_running`）。
2. 绑定两个端口（被占时立刻报 `port_in_use`），写 `panel.json`；预热完成之前 `/api/*` 回 503，页面回“正在启动”。
3. 构建前端（见下；`--no-build` 跳过、用现有的 `dist/web`，`--static-dir` 用现成的产物目录），预热（记录与活动各算一遍），开始监视。
4. 收到 SIGINT、SIGTERM 或 SIGHUP 时收口：结束正在跑的 `git grep` 与 `vite build`，释放网页终端的接管、收掉终端流（见“网页终端”的退出），等进行中的投递结束（上限 12 秒），停服务，删自己的 `panel.json`，放锁，退出码 0。

`panel open` 读 `panel.json`，面板不在跑时报 `panel_not_running`；在跑就签一次性票据：

- 不带 `--print`：票据不进任何进程的命令行（`/proc/<pid>/cmdline` 对本机所有账户可读，别的账户能抢先兑换）。写一页跳转页 `open-<随机>.html`（独占创建、权限 600，内容只是 `location.replace(<登录链接>)`），目录是 `$XDG_RUNTIME_DIR/nbdev/`，没有这个变量时用主工作区的 `.local/agent/run/panel-open/`，目录权限 700；只把它的 `file://` 路径交给 `xdg-open`。每次 `panel open` 顺手删掉该目录里超过 10 分钟的跳转页（票据早已过期）。JSON 的 `data` 带 `page`（跳转页路径），`loginUrl` 为 null。
- `--print`：只打印登录链接（`data.loginUrl`），不写跳转页、不开浏览器。链接打印在自己的终端里，由开发者决定往哪儿粘。
- 不带 `--print`、而 `DISPLAY` 与 `WAYLAND_DISPLAY` 都没有设（经 SSH 登进来、没有桌面环境）：不调 `xdg-open`、不写跳转页，给警告 `no_display`，写明下面的转发命令（端口取面板实际在用的）。

### 从别的电脑用（SSH 转发）

面板只绑回环；跨设备访问（t13）之前，从别的电脑用它走 SSH 端口转发，不改面板的配置：

1. 在你的电脑上转发两个端口，本地端口与面板的端口保持一致：`ssh -L 4400:127.0.0.1:4400 -L 4401:127.0.0.1:4401 <这台机器>`。产物来源的地址按请求的主机名与产物端口拼（`localhost:4400` 的页面嵌 `localhost:4401`），本地端口换了，产物页就嵌不进来。
2. 在这条 SSH 会话里（或另开一条）运行 `nbdev panel open --print`，把打印的一次性链接粘进你电脑的浏览器（5 分钟内有效，用一次作废）。
3. 面板重启后会话作废，重新 `panel open --print`。

别的电脑经转发进来，在面板看来也是回环上的请求，登录照样要一次性链接；开发者 2026-10-13 定别的设备登录后与本机权限相同。

## 常驻（t11）

包脚本把面板装成 systemd 用户服务（不进 nbdev 的命令面）：

```text
bun run --cwd packages/dev-panel install-service [-- --dry-run] [--port 4400] [--artifact-port 4401] [--target <checkout>] [--force] [--json]
bun run --cwd packages/dev-panel install-service -- --uninstall [--force] [--json]
```

- 单元 `nbdev-panel-<主工作区目录名>.service`（本机是 `nbdev-panel-neuro-book.service`），写在 `${XDG_CONFIG_HOME:-~/.config}/systemd/user/`；一个主工作区一个面板。安装写单元、`systemctl --user daemon-reload`、`enable --now`；卸载 `disable --now`、删单元、`daemon-reload`。`--dry-run` 只打印将写的文件与命令。
- `ExecStart` 是运行安装脚本的 bun 的绝对路径加主工作区 `packages/dev-panel/src/cli.ts` 的绝对路径，不经 shim（shim 可以被指到 worktree；用户管理器的 `PATH` 不保证有 `~/.local/bin`）。`Environment=NBDEV_PANEL_UNIT=<单元名>`：面板只凭它判断自己是服务（`INVOCATION_ID` 在 KDE 的终端标签页里也有）。`Restart=on-failure`，`RestartPreventExitStatus=2 3`（用法错误与冲突重启也不会好），`TimeoutStopSec=30`；没有 `After=default.target`。t12 加两行：`Environment=NBDEV_HERDR_BIN=<安装时找到的 herdr 的绝对路径>`（找不到时写一行注释，说明要网页终端就自己加上），`KillMode=mixed`（停单元时只给面板 SIGTERM，等它改回尺寸、release 之后再收剩下的子进程；缺省会同时给终端流的子进程 SIGTERM）。t14 再加一行 `Environment=NBDEV_GH_BIN=<安装时找到的 gh 的绝对路径>`（找不到时同样写注释）：用户管理器的 `PATH` 在开机后、登录前只有缺省几项，找不到 `~/.local/bin/gh`。已经装过的单元要重装一次才有这几行。
- 同名文件不是本脚本写的（靠文件头的标记行认）不覆盖、不删，除非 `--force`；面板已经在跑时先提示停掉（`panel_running`）。`systemctl` 失败报 `systemctl_failed`。
- 看状态、启停、重启与看日志用下面的 `service` 脚本（原始命令是 `systemctl --user status|start|stop|restart <单元>`、`journalctl --user -u <单元>`）。服务写的 `panel.json` 照旧在主工作区的 `.local/agent/`，`nbdev panel open` 用法不变；重启之后要重新 `panel open`。本机 `Linger=yes`，注销后服务照常。

装好之后用包脚本管理，不用记单元名：

```text
bun run --cwd packages/dev-panel service <status|start|stop|restart|logs> [--target <checkout>] [--follow] [--lines <n>]
bun run --cwd packages/dev-panel service:status    # 另有 service:start、service:stop、service:restart、service:logs
bun run --cwd packages/dev-panel service:logs --follow
```

- 单元名与主工作区的定位同 `install-service`（`--target` 缺省是脚本所在仓库的主工作区，给了 worktree 也按它的主工作区）。单元文件不存在时报 `service_not_installed`（退出码 5），先运行 `install-service`。
- `status`：`systemctl --user status <单元> --no-pager`。`start`、`stop`、`restart`：`systemctl --user <动作> <单元>`，成功后打印一行结果，`start`、`restart` 之后提示浏览器要重新运行 `nbdev panel open --print` 登录。
- `logs`：`journalctl --user -u <单元> --no-pager -n <n>`，`--lines` 缺省 100；`--follow` 再加 `-f` 前台跟随（先显示最近 n 行），Ctrl+C 结束。`--follow`、`--lines` 只用于 `logs`。
- systemctl、journalctl 的输出直接到终端，退出码照传：`status` 在服务停着时是 3，这是 systemctl 的语义。脚本自己的失败按 nbdev 的错误码：用法错误 `usage`（2）、`service_not_installed`（5）、systemctl 或 journalctl 起不来 `systemctl_failed`、`journalctl_failed`（1）。脚本被 SIGINT、SIGTERM、SIGHUP 结束时先把信号转给子进程，等它退出再照传它的退出码。

## 前端构建

产物不入库（根 `.gitignore` 已忽略 `dist/`），`panel serve` 发现输入变了就先构建：

- 输入：面板的 `src/web/`、`vite.config.ts`、`tsconfig.web.json`、`package.json`，nb-ui 整个包目录（排除 `node_modules`、`.nuxt`、`.output`、`playground`；面板直接用 nb-ui 的源码，还用到它的 `themes/`；nb-ui 不发预编译样式，面板的 Tailwind 一起编译它的源码），根 `bun.lock`。哈希写进 `dist/web/.build-hash`，一致就不构建。
- 输出到临时目录，成功后改名替换 `dist/web`：正在跑的面板的页面不会指向已被删掉的资源。
- 失败时有旧产物就用旧的（`/api/meta` 的 `build.failed`、命令的 `build_failed` 警告）；没有旧产物报 `build_failed`（退出码 1）。
- 合入 `master` 后由主工作区的代码运行，构建产物也在主工作区的包目录里；常驻见“常驻”。

## 前端

Vue 3 加 Vite（`src/web/`，产物 `dist/web/`），`vue-router` 用 history 模式（服务端回退到 `index.html`）。组件来自 nb-ui，主题是 nbook（`installTheme` 加 `applyColorway`，不经 Nuxt），明暗跟随系统，可在顶栏切换。样式按 Tailwind 的标准分层：`@import "tailwindcss"` 之后导入 `@notnotype/nb-ui/tailwind.css`（见 `src/web/app.css` 的头注释），面板的原子类在 `utilities` 层，压过 nb-ui 的语义类，`hidden md:flex` 这类响应式写法照预期工作。面板不分层的全局规则里特异性低于一个类的（`html, body`、`body`、`*`、焦点环）放进 `@layer base`，否则会压过所有原子类。

| 路由 | 页面 | 依据 |
|---|---|---|
| `/` | 首页：收件箱在上（提问按产物合并、带提问者，提问者的租约已失效时划掉；只放正在发生的撞号，写明哪几个名字、各在哪里，并链到处理办法；只在旧副本里的不放），上面一行是要处理的通知；进行中与未标的 Work 卡片，有事等我的在前、其次进行中、再按最近更新（t15 阶段 4）；完成、搁置与超过 30 天没有更新的收进“其余 N 个” | t03 第三轮首页 A |
| `/work/:workId` | Work 页：目标、Task 表、现在谁在动、Work 级的文档与产物；状态切换、编辑 README、新建 Task 的入口。Task 行可以就地展开（当前状态、下一步、产物、证据、谁在动），展开时才取这个 Task 的接口，同时最多 3 行，展开第 4 行时收起最早的那行（决定点 9，t15 阶段 4）；状态只在标题旁显示一处 | t03 第三轮 Work 页 |
| `/work/:workId/task/:taskId` | Task 页：当前情况、README、执行 checkout 的候选与它上面的提交、产物与文档类产物、链到的 Spec、证据、谁在动；状态切换、编辑 README 的入口。侧栏里的产物、文档、Spec、证据点了在速览面板里打开（`?peek=`，能后退、能分享，中键照样开完整页；零件 `PeekPanel`）：内容区宽于 1100px 时并排、推开正文（正文改成一栏），窄于它浮在正文上（有遮罩），手机整屏；产物显示页面本身与状态行、“去答复”“打开完整页”，不放答复表单（决定点 10、17，t15 阶段 4）；状态只在标题旁显示一处 | Proposal 第九节 |
| `/artifacts` | 产物列表：按类分组，可过滤 | t03 第二轮产物页 |
| `/artifact/:workId/:taskId/:artifactId` | 产物页（铺满）：左边是产物来源上的沙箱 iframe（零件 `ArtifactFrame`：`sandbox="allow-scripts allow-forms allow-popups"`，不给同源），右边是答复侧栏：待答（标题写“待答 N”，有必答题时另数“必答 M”；题缺省选答，能只答一部分就提交；这一版新加的题标“新”）、已答（只读，点“改答”才给控件）、之前几版的题（页面上已没有，只读，不再收答复）、已取代与撤回，提交栏贴在侧栏底部，写“已改几题、还有几道必答”，提交的结果也在栏里、逐题写答了什么（t15 阶段 4）；切版本只切题表，iframe 上标“页面是当前版本”；Work 级产物的 `taskId` 写 `-`。答复成功后提交栏里多一块“通知”（t15 阶段 4 起在结果下面，原来在侧栏顶上，提交时人在底部看不到）：这份答复要通知谁、在等什么、发出去了没有，随推送更新；提问的会话已经换了时弹小窗一次（t11） | t03 第二轮产物页 |
| `/docs?checkout=&path=&prefer=&view=&changed=` | 文档页：左边按类型的树与 checkout 切换（不是主工作区时标出来、列出与 master 的差异，可以只看有差异的，`?changed=1`），右边渲染 Markdown；`prefer` 是从 Task 页带来的执行 checkout 候选。t15 阶段 4 第 4 批：在差异里的文档页头给“渲染 / 与 master 的差异”切换（`?view=diff`，`/api/docs/diff`，上面一行写基线；差异不限高、长行折行）；用下拉切 checkout 保留 `prefer` 与正在看的文档，删去的与 master 才有的在树里也能点、只给差异；手机（窄于 768px）上文档树收进左侧抽屉，页头一个“文档树”按钮，选了文档就关上。Markdown 里的外站图片（`http`、`https`）不加载，换成虚线框的链接“外站图片：<alt>（<域名>）”，套在链接里的只换成文字；不放宽 CSP（文档来自各个 worktree，外站图片一打开就会发请求） | t03 第二轮文档页；t15 design.md 阶段 4“文档页” |
| `/live/sessions?pane=`、`?view=notify` | 会话（铺满，t15 阶段 4 第 3 批重做）：左列表、右详情。左列表最上面一行是通知（`?view=notify`，右栏显示排队的、要处理的、最近 24 小时发过的，t11；顶栏“通知要处理”与首页的通知行也链到这里），下面是本仓库的 Agent 会话（标题取自会话文件，取不到用租约的 Task、再用短号；按等确认、工作中、完成、空闲、未知、不在 herdr 里、已结束排；持有租约却不在 herdr 里的不能打开）、其它 pane（只读，D2）、无主的运行的入口、不在本仓库的会话（折叠，只列出）。页头是一行（t17，`PageShell` 的 `compact`）：面包屑“首页 › 会话”接着 herdr 状态，内边距与间隙收小，把高度让给终端。`?pane=` 选中一格：头合成一行（放不下就折行，不截断链接与原因），依次是标题、状态、Agent、pane、会话短号、租约的 Task、运行数、标题来源；下面是实时终端（模式条写观看还是接管，接管中按 Ctrl+] 退出；观看时字号按宽、高两向放下整屏；手机上是文字视图。终端不开回滚：herdr 的观察流逐行改写整屏、不滚屏，xterm 攒不下（决定点 23）。读得到更早输出的会话（omp，手机的文字视图里点“更早的输出”）照旧；读不到的（`history` 为 null，Claude 这类在备用屏上的会话）写“只能看当前屏；更早的输出去 herdr 里翻”，这一批不承诺在面板里往回翻）与贴在终端下面的输入区（输入框与发送按钮一行，输入框高度随内容（软换行也算）在 1 到 4 行之间、不能拖高，聚焦不改布局，Ctrl+Enter 或 ⌘+Enter 发送；字数只在超过上限的八成时显示；下面一行是按键；会话在工作中时原因写短、放在已有的行里不另占一行（宽时在发送按钮左边，手机上在按键行末尾），等确认与整块不可用仍在输入框上方单独一行，输入框经 `aria-describedby` 读到原因；按键带“确认”标记的要两步确认，t11）；没有会话键的 pane（含认出了 Agent 但还没报会话的）进“其它 pane”，只读观看，可点“更早的输出”读最近 1000 行（`history` 为 `pane` 时给；全屏程序、没有回滚时不给）；网页终端不可用时显示屏幕末尾（打开时与每次发送后各读一次，不轮询）。桌面上没选时自动选一次（决定点 21：有要处理的通知先显示通知，否则等确认、工作中的会话优先；用 replace，不加历史）；手机上列表与详情分两屏，不自动选。宽度：内容区 1100 以上左栏 330px，900 以上 260px（行里只留标题、状态与 pane 号），再窄收起左栏、详情上方给“切换会话”下拉；手机上的详情收起页头，但不换页面的根，跨 768px 时详情、草稿与接管中的终端不重建；“在跑”页运行里的 pane 号链到这里 | t03 第三轮会话页；t15 阶段 4 第 3 批线框稿；t17 紧凑写法 |
| `/live/runs` | 在跑：经 nbdev 起的服务、会话的运行、无主的运行（t14） | Proposal 第九节 |
| `/live/checkouts`、`?files=`、`?focus=` | checkout：分支、HEAD、是哪个 Work 的执行 worktree、路径；t14 加未提交、领先落后、在跑、`home`。t15 阶段 4 第 4 批：整行可点（是某个 Task 的就去第一个 Task，否则去它的文档；第一格是真链接；点在链接或按钮上、带修饰键、拖选了文字时不跳）；落后、有未提交、有服务在跑用同一种警告色，行首一个同色的点；未提交写“改 N · 新 M”，点了在表格下面列出暂存、工作区、未跟踪三段（`?files=<key>`）；git 没算完的写“没算完”；一个 checkout 上有两个以上服务时提示；“在跑”页的服务链到这里（`?focus=<key>`，对准那一行，每个 key 只滚一次，之后重取不再拉回） | Proposal 第九节；t15 design.md 阶段 4“现场三页” |
| `/live/github` | GitHub 只读：开着的 PR（检查汇总）与 Issue（t14） | Proposal 待决问题 12 |
| `/search?q=` | 搜索结果：流式出现，记录类命中在最上面（服务端按相关度排），文件命中按 checkout 分组，截断时标出。t15 阶段 4 第 5 批：搜索词高亮（记录、文件名命中的路径、内容那一行，命中靠后时片段从命中前开始）；每组里 `.agents/tasks/` 的历史 Task 记录默认折叠 | t03 第二轮顶栏；t15 design.md 阶段 4“搜索” |
| `/new?workId=` | 新建 Work 或 Task：表单与随填随变的预览（预计领到的号、要写的文件与内容、提交信息；号以提交时为准）；结果区写实际领到的 id，与预览不同时多一行说明 | t03 第三轮新建表单 |
| `/edit?path=` | 编辑主工作区里的一个文件：编辑与预览、打开时就提醒哪些分支改过它、根级治理入口显示非空行数与上限。贴底操作栏：保存并提交（Ctrl+S）、放弃改动与结果；面包屑在 Work 或 Task 目录里的文件回到那个 Work、Task（t15 阶段 4 第 5 批起不只 README） | t10；t15 design.md 阶段 4“编辑页” |

- **外壳**：左栏（零件 `PanelNav`，桌面左栏与手机抽屉共用：上段固定的入口与计数——首页与收件箱、新建、资料、现场；下段单独滚动的 Work › Task 树，按 D4 只列进行中的与 30 天内更新过的未标 Work，其余收进“更多”；Work 行有状态色点、待答角标与在动图标，树上方有筛选框与四种排列方式（按编号、最近更新在前、有事等我在前、按状态分组），见 `PanelNav.md`（t15 阶段 4）；当前页高亮并滚进可视区，当前 Work 缺省展开；树整体一个 Tab 停靠点、方向键在行间走；条目来自 `host/nav.ts` 的描述表，t15）、顶栏（t15 起只有搜索、状态点、通知要处理的计数与明暗：搜索框最宽 36rem，`/` 与 Ctrl+K 聚焦它，焦点在输入框、`textarea`、`contenteditable`、xterm 或对话框里时不处理（`host/shortcuts.ts`，冒泡阶段监听）；推送、herdr、数据合成一个状态点，正常时是绿点，有一样不正常时变黄并写出是哪一样，点开看详情；“数据”一行看外壳自己的三份数据（左栏与收件箱、面板状态、通知）：有一份重取失败就变黄，写原因与显示的是什么时候读到的，`/api/meta` 第一次就失败时也一样，不按记录的年龄判断；通知要处理的计数（会话已更换、没有可通知的会话，以及没点“知道了”的醒目尝试；点了去会话页）保持醒目）。“代码已更新”与重启命令、“前端构建失败”、审计与后台重算失败改成顶栏下的横幅，正常时没有横幅。审计分两种：`not_initialized`（还没跑 `audit-init`，多半有意不用）的横幅可以“知道了”，按“原因 + 审计文件路径”记在偏好里，关掉后只在状态点的详情里留一行“审计：未开启”，点不变黄；初始化过又坏了的（`bad_owner`、`bad_mode`、`not_regular`、`unreadable`）是故障，横幅常驻、不能关，状态点也变黄。左栏与正文是 nb-ui `Splitter` 的两块面板（t15）：左栏缺省 300px，可拖（鼠标、键盘方向键与 Home、End，Esc 取消），最小 200px、最大取 480px 与视口 40% 中较小的（D4）；窗口变窄时夹住，变宽时恢复用户拖出来的宽度；拖到最小以内再过 80px 收起，左栏右上角的“收起左栏”同样收起，收起时完全隐藏、顶栏左侧给“展开左栏”（决定点 8）；收起或窄屏时左栏 `inert`（宽 0 的条目不留在 Tab 顺序与读屏树里），分隔线禁用，点“收起左栏”“展开左栏”后焦点交给对面的那个按钮；宽度与收起记在偏好里。窄于 1024px（`lg`）时左栏收进抽屉（nb-ui 的 `Drawer`，顶栏左侧“打开导航”）：同一个 `Splitter` 把左栏收成 0、禁用拖动，面板按 id 渲染，所以断点来回切换时正文不重挂，编辑草稿与终端连接都还在（决定点 7）。会话页的“手机”判定（`(max-width: 767px), (pointer: coarse)`）管给不给接管、默认文字视图，与这个断点分开。页面按路由名与路径参数重建实例（`host/routes.ts` 的 `pageKey`）：Work、Task、产物页之间切换，上一个页面的提示、“重试”与在途的回包不会落到新页面上；查询参数（`?pane=`、`?path=`、`?checkout=`、Task 页速览面板的 `?peek=`）变化不重建，由页面自己处理（t15）。新建页提交在途时不能切换“新建 Work / 新建 Task”，回包与“结果未知”的确认按提交时的那一种处理；带“重试”的失败提示在切换模式时收起，“重试”不会提交另一张表。
- **可访问性**（t15）：第一个 Tab 停靠点是“跳到主内容”（平时移出视口，聚焦时出现在左上角），按下去焦点到页标题。换页（路由名或路径参数变了）时正文回到顶上、焦点放到新页面的标题（数据到了才出现的最多等 5 秒；这期间开发者已经把焦点挪到别处就不抢）；打开面板时的第一次解析与查询参数变化（会话页选会话、文档页选文档）都不挪焦点。标签页标题是“页面名 · nbdev”（`host/nav.ts` 的 `pageTitle`：Work、Task 取标题，文档与编辑带文件名，搜索带搜索词）。面板自己的可交互元素用 nb-ui 的焦点令牌 `--focus-outline` 画焦点环（`:where` 不加优先级，nb-ui 控件自己的焦点样式照旧）。承载信息的灰字（编号、元信息、计数、小节名、表头）用 `--text-secondary`：`--text-muted` 在亮色页面底色上只有 2.88:1，`--text-secondary` 是 6.02:1（2026-10-14 实测）；nb-ui `Table` 的表头经 `.nbdev-table` 改色。空状态、占位与“未标”仍是 `--text-muted`。
- **滚动**（t15）：一页只有一个竖向滚动者。外壳铺满视口，整页不滚（`html` 不预留滚动条槽位）；左栏的 Work 树自己滚；页面按路由元信息 `layout` 分两种：缺省“流式”，由 `main` 竖向滚动；“铺满”（文档页、产物页、会话页）时 `main` 不滚，页面占满高度、由它的分栏各自滚动（产物页：左边 iframe 里的页面自己滚，右边侧栏自己滚，两边不联动），窄屏上下堆叠时改由页面的根滚动。滚动容器都带 `relative`，做绝对定位后代的包含块（起因是 nb-ui 复选组的 `sr-only` input 聚焦时把外壳 `overflow: hidden` 的格子滚走、整页变空；nb-ui 已在 label 上修好，见 `Checkbox.md`，这条留作面板的防御性约定；`tests/web-scroll-containers.test.ts` 钉住）。例外：有上限高度的预览块（会话的屏幕末尾与更早的输出、终端的文字视图、差异、新建页的文件预览、通知里的消息）可以自己滚，不算页面的滚动者；页面的主体不再套第二层竖向滚动。会动态溢出的滚动者要预留槽位（`scrollbar-gutter: stable`，长短切换时宽度不跳），写法有三种，各有原因：外壳与左栏用面板自己的 `nbdev-scroll-y`（滚动与槽位一起声明；nb-ui 的 `nb-ui-scrollbar-stable` 只管槽位、不管滚动，两处要配对写）；文档页用 Tailwind 的 `[scrollbar-gutter:stable]`，因为只在 `md` 以上才滚、要带断点前缀；`html` 显式写回 `auto`，盖掉 nb-ui 的全局 `stable`。滚动条是细条，颜色从 `--text-muted` 派生、随明暗换，只用标准属性（`app.css` 一处声明）。终端里空的 `.xterm-viewport` 不画原生轨道，xterm 自绘的滚动条用终端主题的 `scrollbarSlider*`（有回滚时才出现）。
- **页面骨架**（t15）：每一页都套零件 `PageShell`：页头（面包屑、状态与标题、右侧操作、说明行、写入结果）加正文，内容宽度三档：列表（最宽 90rem，居中，缺省）、阅读（按正文的阅读宽度收、居中：正文卡片用 `nbdev-reading-card`，宽度是面板的阅读宽度 56em 加内边距，Task 页与文档页的正文右边不再空一片）、满铺（产物页）。页头在数据到之前就渲染，标题先用编号或页面名，加载完只换文字，标题的顶边与高度不跳；标题行至少 2rem 高，各页标题的顶边一致。每页都有面包屑（首页只有“首页”一项）。
- **长文字与次要操作**（t15）：路径、id、分支名、sha 用零件 `TruncatedText`：单行截断，被截断时悬停或聚焦看全文，点一下复制。去别的页的次要操作（编辑 README、新建 Task、看文档、单独打开）用零件 `ActionLink`：带图标与文字、样子是 ghost 按钮的真实链接；写入类的主要操作用 nb-ui `Button`。
- **语义类**（t15）：`app.css` 里带 `nbdev-` 前缀的几类，页面与零件用它们，不再各写内联 `style`：字号五档（`nbdev-title` 页标题、`nbdev-heading` 页面分节的区标题、`nbdev-card-title` 卡片与面层里的标题（与正文同字号、加粗）、`nbdev-body` 正文、`nbdev-note` 说明、`nbdev-caption` 标注；只要说明的字号、不改颜色时用 `nbdev-small`），文字颜色（`nbdev-secondary` 承载信息的灰字、`nbdev-empty` 空状态与占位、`nbdev-warn`、`nbdev-danger`、`nbdev-ok`、`nbdev-accent`），竖排间距三档（`nbdev-stack-page`、`nbdev-stack`、`nbdev-stack-tight`），面层（`nbdev-surface`）、浅底提示块（`nbdev-hint`，要注意时加 `nbdev-hint-warn`）、等宽预览块（`nbdev-pre`）、等宽数字（`nbdev-num`）。颜色或底色在几个 token 之间按状态选时写成 `:class`（`nbdev-ok`、`nbdev-warn`、`nbdev-accent` 这类），不写成常量的 `:style`；外壳一处一用的面层底色写在 `App.vue` 的 scoped 样式里。内联 `style` 与 `:style` 只留随数据或测量算的几处：产物 iframe 定死的亮色底（`ArtifactFrame`）、Task 状态条里随占比算的宽度与各段颜色、速览面板按内容区位置算的位置与大小、并排时正文让出的宽度、外壳登录失效阻挡层取自 nb-ui 层级常量的 `z-index`（各自的注释写了原因）。
- **加一个页面**（t15）：
  1. `router.ts` 写路由名、按需加载的组件与 `meta.title`（标签页标题里的页面名）；铺满型页面再写 `meta.layout: "fill"`，页面根占满高度、分栏各自滚，窄屏由根滚；
  2. 页面里有且只有一个 `h1` 当页标题：换页时焦点放到它上面，“跳到主内容”也落在它上面；
  3. 流式页面不要自己再包一层竖向滚动（`main` 在滚），有上限高度的预览块除外；
  4. 顶层入口要进左栏时，在 `host/nav.ts` 的 `NAV_GROUPS` 加一条（右边要计数的，在外壳的 `navCounts` 给数）；
  5. 带路径参数的页面按路由名加参数重建实例（`pageKey`），不用自己处理换参数；标签页标题要带参数的（像 Work 的标题、文档的文件名），在 `host/nav.ts` 的 `pageTitle` 里加一支。
- **数据宿主**（`src/web/host/panel-data.ts`）：单例，全应用只有一条 `/ws`。页面经 `useResource(path, parts)` 取数，推送说哪块变了就重取订阅了它的资源；只接受最后一次请求的回应，且回应的 revision 不比已接受的旧；推送触发的重取单飞：在途时再有变化只记一笔，结束后至多再取一次（直接中止重发的话，推送比请求快时永远收不到数据）；显式重取与地址变化照旧中止在途的请求（t15）；服务重启（实例 id 变了）或推送重连后全部重取。加载态延时 200 毫秒出现。已有数据时重取失败：保留上次的数据（资源的 `stale` 为真，`receivedAt` 是那份数据读到的时刻），页面的 `LoadState`（t15 阶段 3d 收进了 `StaleNotice`）只画一行，写明显示的是什么时候读到的、这次为什么失败，给“重试”；404 不给重试，给回上一级的链接（Work 回首页、Task 回 Work、产物回 Task 或产物列表、文档回文档树；checkout 已删、文档树也找不到时去主工作区的文档；编辑页回所属的 Task、Work 或文档页）。上一级必须是真能到的地方，不指回同一个找不到的地址；找不到的是什么由页面写明（`subject`），服务端的 404 只说“找不到”。还没有数据时 `LoadState` 画加载、找不到（404，给上一级、不给重试）或失败（给重试），没到显示加载的时候先占住同样的高度；不做骨架屏（nb-ui 规范第 4.3 节第 8 条）。页面用 `loadStateOf(resource)` 给它资源的状态；编辑页不订阅推送，只在重新登录或重连之后的全部重取失败时出现这一行。后台重算失败（`/api/meta` 的 `parts.<块>.error`）由外壳在顶栏下的横幅里写“后台重算<块>失败，显示的是上一份”（t15）。`/api/*` 回 401 时进入登录失效状态（见“登录”）：`api.ts` 只按状态码判断，经同一个出口通知数据宿主；失效期间资源不发请求。`/ws` 断开后、每次重连之前先取一次 `/api/meta`：浏览器拿不到升级失败的状态码，面板重启后旧 cookie 作废，只靠重连会一直停在旧数据上；探测回 401 就进入失效状态并停止重连，否则照常重连（重连后的 `hello` 全部重取）。外壳卸载时 `stopPanelData()` 关连接、取消重连。
- **偏好**（明暗、左栏各 Work 的展开、左栏的宽度与收起、左栏 Work 列表的排列方式、通知里“知道了”的尝试、审计横幅的“知道了”）只经 `src/web/host/prefs.ts` 一处读写 `localStorage`（键带 `nbdev-panel:` 前缀，读写包 try/catch）；组件不碰浏览器存储。`127.0.0.1` 与 `localhost` 各有一份偏好。
- **Markdown**（`src/web/host/markdown.ts`）：`marked` 转 HTML，DOMPurify 清洗（`FORBID_TAGS: style、form、input、button、textarea、select、iframe、object、embed`，`FORBID_ATTR: style`），再改写链接：相对路径按文档所在目录解析成仓库路径，`.md` 转成文档页，产物目录转成产物页，`.agents/works/` 下的其它文件与图片走产物来源（`/api/meta` 的 `artifactBase`），其余仓库文件面板不提供，链接去掉、图片不显示。
- **零件**（`src/web/parts/`）：`LoadState`、`StatusChip`、`StatusBar`、`LeaseChip`、`EphemeralFrame`、`BranchNote`、`WorkCard`、`InboxList`、`TaskTable`、`MarkdownView`、`QuestionPanel`、`ArtifactList`、`DocTree`、`CheckoutSwitch`、`SessionList`、`RunList`、`SearchResults`，t10 加 `AnswerForm`、`StatusSwitch`、`NewWorkForm`、`NewTaskForm`、`CreatePreview`、`DiffView`、`UncommittedDialog`、`FileEditor`、`WriteNotice`（t15 换成 `WriteResult`），t11 加 `NotifyStatus`、`DeveloperMessageDialog`、`ScreenConfirmDialog`、`SessionConsole`，t12 加 `TerminalView`、`TerminalTextView`、`TakeoverDialog`，t14 加 `ProcList`、`PrList`、`IssueList`，t15 加 `StaleNotice`（阶段 3 收进 `LoadState`，已删）、`PanelNav`、`PageShell`、`WriteResult`、`TruncatedText`、`ActionLink`，阶段 4 加 `ArtifactFrame`（产物原页，产物页与速览面板共用）、`QuestionControl`（一道题的作答控件）、`PeekPanel`（速览面板的外框），各有同名 `.md`。零件只吃 props、只发事件；页面与外壳是宿主。去别的页的入口是真实链接（`<a href>`，地址都由 `host/routes.ts` 拼），普通左键点击时零件 `preventDefault` 并发 `navigate`，由页面 `router.push`；中键与带修饰键的点击交给浏览器（新标签页、复制地址）。零件不进 Component Lab（Lab 在 NeuroBook 应用里，挂面板的组件就要让产品包依赖开发工具），状态在浏览器验收里用临时仓库的数据摆出来。
- **画法**（t03 第三轮已定）：持久的照常画实线的面；临时的（会话、租约、谁在动、运行）一律信息色虚线框，角上标“临时”，单独的租约是虚线胶囊，失效的划掉。没有字段的值显示“未标”；面板不推断状态，所以多数 Work 的计数条是“未标”的灰色。
- **会话的写法**（t17）：显示会话的地方写“标题 + 短键”：标题在前、可截断，短键用次要色、不截断；没有标题只写短键。写法只在 `SessionLabel` 一处（标题截断时可聚焦看全文），用到的地方是 `LeaseChip`（Work 卡片、Work 页的“现在谁在动”、Task 表的展开内容、Task 页、收件箱的提问者）、“在跑”页各会话的小标题与 `ProcList` 的“谁起的”。Task 表的“谁在动”一列只有约 7rem，`LeaseChip` 用紧凑写法只写短键，标题只在提示里。`LeaseChip` 的提示写完整标题与它从哪里读的，有提示时可以用 Tab 聚焦。标题来自页面数据的 `sessionTitles`，名字由 `host/format.ts` 的 `sessionName` 生成；页面把 `sessionTitles` 作 prop 传给 `WorkCard`、`InboxList`、`TaskTable`、`ProcList`（必填，零件不经 provide/inject 取）。下面这些只写短键、不加标题：通知状态的各句（含产物页）、会话页的会话变化说明、写给会话的对话框、会话页终端的 `aria-label`，以及 `host/session-console.ts`、`host/sessions-list.ts` 里生成的文字。
- **写入的结果**（t15）：一次写入（以及会话页的按键、文字、接管）的结果由零件 `WriteResult` 显示，分结果与附注两层：结果（成功、失败、冲突、结果未知、提示）只决定颜色与图标，成功带警告仍是成功，服务端的警告作为附注默认折叠；明细与原因去重，已写入没提交的路径在原因里写过就不再列。新建页把提交时能锚到字段的问题（`details.field`、`problems[].field`）交给表单，在字段旁边报一次，结果里只写“表单里标出了 N 处”；表单一改就清掉。产物页的答复被拒时同样处理，按题号（`problems[].questionId`、`details.questionId`）锚到还能答的题下面。生成结果的是 `host/writes.ts` 的 `successNotice`、`failureNotice`、`plainNotice`。
- **写入的界面**（t10）：零件不发请求；写请求、预览请求、300 毫秒去抖、“2 秒后提示在等别的写入完成”的定时器、`beforeunload`、复制到剪贴板都在页面里（`host/writes.ts`、`host/status-change.ts`）。写请求的错误保留 `details` 与 `data`。字段校验直接导入核心的纯函数（`validateAnswerValue`、`SLUG_PATTERN`、标题与控制字符的规则），不复制规则。主工作区不能写、记录来自分支时，写入口隐藏或只读并写明原因。外壳不监听也不接受来自产物 iframe 的消息：答复只经侧栏表单。错误码到界面动作：

| 情形 | 界面 |
|---|---|
| 提交中 | 按钮禁用；2 秒后提示“在等别的写入完成” |
| 200 | 成功；`changed: false` 写“内容没变，没有提交”；警告照列 |
| 400 | 字段级错误显示在字段旁（`details.field`、`details.problems`） |
| 409 `hash_mismatch` | 状态切换：重新取数并说明；编辑：取现在的版本，与打开时的原文按行比（前端算，`host/line-diff.ts`），显示“别人改了什么”，给“载入新版本（丢掉我的改动）”与“复制我的改动” |
| 409 `uncommitted_changes` | 差异对话框（已暂存与工作区分两段），“取消”与“连同这些改动一起提交” |
| 409 `staged_rename`、`changed_after_write` | 说明原因，不给提交；后者列出已写入未提交的路径 |
| 409 其它（`branch_maintained_record`、`main_not_on_master`、`main_busy`、`work_not_committed`、`task_not_committed`、`task_closed`、`question_closed`、`question_earlier`、`artifact_closed`、`stale_version`、`not_editable`） | 显示错误说明；数据已过时的（`stale_version`、`question_closed` 等）重新取数 |
| 503 `lock_timeout`、`warming_up` | 什么都没写，给“重试” |
| 500 `commit_failed` | “已写入、没有提交”，列出路径与补救办法 |
| 网络错误、连接被断开 | “结果未知”，不给“重试”，按页面核对一次：产物页与状态切换重新取数；编辑页重取文件，变了就显示差异并写明“多半是你刚才那次保存已经生效”，没变就写“没有生效，可以再保存”；新建页锁住表单，直到开发者确认上一次建好了没有 |

- **编辑页的未保存改动**：站内跳转（左栏、链接、改 `?path=`、浏览器后退）用 `onBeforeRouteLeave`、`onBeforeRouteUpdate` 拦，守卫返回 Promise，等面板自己的确认框（nb-ui `AlertDialog`：离开并丢掉改动，或留下；Esc 算留下，点遮罩不会关；留下时焦点回到打开框之前的元素，没有就回到编辑框；t15 阶段 4 第 5 批，以前是 `window.confirm`）。框跟着它等的那一次导航：开着时又来一次离开这一页的导航（只有浏览器后退、前进来得了），上一次按“留下”结算；后退之后再前进回到这一页，框关上。后退被拦下时 vue-router 把地址复原。已知限制：框开着时连按两次后退，页面与地址可能错开一格，实测选“离开”时页面到了上上一页、地址却停在上一页（vue-router 在异步守卫下对连续后退的限制，概率低，不硬修）；关标签页与刷新只能用原生的 `beforeunload`。Ctrl+S（Mac 上 ⌘+S）保存，按钮上写着；不能保存（没有改动、不能写、有冲突、正在保存）时也拦下浏览器的“另存网页”，在操作栏写原因；对话框开着时不处理。保存成功后编辑器换成服务端写下的最终文本与新哈希（README 的 `updated` 被核心改过）。换文件（确认离开之后改了 `?path=`）时，编辑器、基线、差异与提示都换成新文件的；旧文件在途的保存与取版本回来时不再改写编辑器，写入本身照样生效（`src/web/host/file-edit-session.ts`，t15）。保存在途时编辑器只读，站内离开被拒绝并提示“正在保存，等它完成再离开”（这次保存照样会提交，离开不会丢掉它）。
