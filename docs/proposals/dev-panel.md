---
schema: nbook.proposal/v1
status: accepted
created: 2026-10-12
decided: 2026-10-12
supersedes: []
superseded-by: null
specs: []
adrs: []
---

# 开发者项目面板与命令行 nbdev

关联 Work：[w00022](../../.agents/works/w00022-dev-panel/README.md)。依据 t01 的[需求分析](../../.agents/works/w00022-dev-panel/tasks/t01-requirements/requirements.md)与[需求补充分析](../../.agents/works/w00022-dev-panel/tasks/t01-requirements/analysis-supplement.md)、t03 的[领域模型第二版](../../.agents/works/w00022-dev-panel/tasks/t03-design/domain-model.md)、[会话托管调研](../../.agents/works/w00022-dev-panel/tasks/t03-design/session-hosting-research.md)、[开发者的决定](../../.agents/works/w00022-dev-panel/tasks/t03-design/README.md)与[第三轮评审板](../../.agents/works/w00022-dev-panel/tasks/t03-design/artifacts/review/index.html)。需求分析与补充分析里“本地 Work”“产物与答复留在 `.local`”“面板只读仓库”“命令行不提交”“验收截图默认不入库”几条已被领域模型第二版取代，以第二版和 2026-10-12 起生效的 [Work 规则](../../.agents/works/README.md) 为准。实施切片见[实施计划](../../.agents/works/w00022-dev-panel/tasks/t03-design/plan.md)。

面板与 `nbdev` 是开发工具，不是 NeuroBook 产品功能；本提案不改产品 Spec，工具合同写在包内（见“对 Spec 的预期改动”）。

## 问题

开发者与多个 Agent 会话并行推进十几个 Work，工作材料与会话散在各处，管理成本越来越高（2026-10-12 开发者在 t80 的评审中提出）：

1. **东西散，找之前要先知道它在哪**：主工作区加 10 个 worktree、12 个本地分支；同一件事的记录、评审板、审查报告、截图曾分在不同分支、`.local`、会话临时目录。记录已于 2026-10-12 改为只放 `master`，但多数 Work 的记录还在分支上，没有一个地方能一起看。
2. **看不到整体**：哪些 Task 在做、哪些在等开发者、现在有哪些会话在动它，要逐个打开 README、跑 `git log`、翻 herdr 的 pane。
3. **沟通只有会话窗口一条窄通道**：Agent 只能发文字与路径；开发者的选择只能回终端打字；开发者在别处看完材料，还要回到对应会话说一句“看好了”。在会话里口头问、口头答的事，记录里查不到。
4. **编号会撞**：Work 编号靠人工协调，Task 编号各分支各自往下数。t80、t81 曾只登记在各自分支上；当天下午 w00017 主线新建 t82、t83 时，又是靠人记得才没撞上。
5. **会话被困在终端里**：多个会话由 herdr 托管，看输出、发消息都要切到对应 pane；终端标题会过时，认不出哪个会话在做什么；离开电脑就处理不了。
6. **固定做法每次重新摸索**：领号、建 worktree、发布讲解页、读答复，规则写在文档里，靠每个 Agent 读懂后手工照做。

## 目标与非目标

### 目标

1. 一个本地开发工具，两个入口：开发者用网页面板，Agent 用命令行 `nbdev`；两者共用一个核心库，读写同一份项目数据。命令行不依赖面板在跑。
2. Work 视角：一个 Work 的目标、每个 Task 的状态、待答的提问、最近的产物、现在有谁在动，一页看全。
3. 第二条沟通通道：Agent 把要拍板的事作为提问发布；开发者在面板上答复；答复入库、只追加，任何会话都能读；提问的会话还在 herdr 里时，面板把一行指针消息投过去。
4. 编号经 `nbdev` 领取，取代“唯一分配者人工协调”。
5. 面板是 herdr 的网页前端：会话列表、实时终端、接管键盘、发消息。
6. 跨设备：手机等设备经 Tailscale Serve 打开面板，设备配对登录、分级授权。

### 非目标

- 不是产品功能：不进 Product、Desktop 与发布产物，不改 `docs/specs/`。
- 不托管会话（由 herdr 托管），不在面板里启动新会话，不读会话 jsonl，不做结构化会话界面。
- 不替代 Git、编辑器与 GitHub 网页；GitHub 视图第一版只读（待决）。
- 不做跨机器的编号服务，不做多人使用；只支持 Linux。
- 不跟踪子代理（herdr 看不见它们），不为此另造登记机制。
- 不自动清理 `.local/agent/`，不动 `.local/` 的用户区。
- 不升级 herdr server，不做终端里的鼠标事件。
- 不替其它会话大范围迁移记录：迁移另由 t05 按开发者授权逐条做。

## 当前行为与证据

下列事实除注明外均于 2026-10-12 在本机只读核对；更细的数字见需求补充分析、会话托管调研与第三轮评审板。

| 方面 | 现状 | 出处 |
|---|---|---|
| checkout | 主工作区加 10 个 worktree，12 个本地分支 | `git worktree list`、`git branch` |
| 记录位置 | 2026-10-12 起记录只放主工作区 `master` 的 `.agents/works/`；开发者决定先不大范围迁移，只迁了 w00017 的 t80、t81。w00017 在 `master` 上是停在 10-01 的 30 个 Task 的占号副本，主线分支上已有 83 个；w00005、w00002、w00021 同样 | Work 规则“记录只放主工作区”；t05 当前状态；第三轮问题 1 |
| 状态与目标 | 主工作区 22 个 Work README 只有 w00022 有 `status` 与“目标”一节；149 个 Task README 只有 7 个有 `status`。从正文推断不可靠（第三轮粗扫一遍，t74 被判成未开工、t79 被判成已完成） | 本次统计；第三轮问题 2 |
| 最近更新 | 规则提交顺手补字段时，w00022 的五个 Task 的最后提交时间都变成同一刻 | 第三轮问题 3 |
| 编号 | 人工协调；Task 号正则只认两位（`WORK_TASK_ID_PATTERN = /^t(?!00)[0-9]{2}-…/`），w00017 已用到 t83；扩成三位已定（决定 6），t04 第 2 项未做 | `scripts/ci/agent-governance-contract.ts`；t04 |
| 治理检查 | `verifyWorkContracts` 要求每个 Work 至少一个 Task，`.agents/works/` 与 `tasks/` 下任何不合编号格式的目录都报错；不校验 `status` 取值，不拒绝未知的 frontmatter 字段 | 同上 |
| 治理命令 | `governance:context` 默认读所在 checkout，在 worktree 里要加 `--repo-root <主工作区>`；`governance:worktree` 只报告、不创建 | `scripts/cli/` |
| 产物 | 评审板按 design-review 放 Task 的 `artifacts/<名>/`，入口 `index.html`、各轮 `r1/`、`r2/`；现有评审板的“要你定”与答案没有机器可读的格式；需求分析、领域模型、调研是 Task 目录里的 Markdown，不在 `artifacts/` 下 | design-review；第二轮问题 14；第三轮问题 10 |
| 提问 | 会话在终端里问、在终端里答的问题不进任何记录；评审板上被后一轮取代的问题仍写着待定，待答数虚高 | 第二轮问题 6；第三轮问题 4、5 |
| 本地区 | `.local/README.md` 的 Agent 区只列 `works/<w>/tasks/<t>/` 下的 `reports/`、`shots/`、`logs/`；决定 6 新增的 `run/`、`logs/`、`panel.json` 与登记表尚未写进去 | `.local/README.md` |
| 包登记 | 根 `package.json` 的 `workspaces` 逐项列出 15 个包；CI 矩阵在 `scripts/ci/workspace-package-matrix.ts` 与 `.github/workflows/workspace-packages.yml` 逐项列出；w00017 分支也改过 `workspaces` | 补充分析第九节 |
| nb-ui | `master` 上的 nb-ui 是 Nuxt 模块加 Tailwind（exports 含 `./nuxt`），与 w00017 分支相差 195 个文件 | `packages/nb-ui/package.json`；补充分析第九节 |
| herdr 版本 | 客户端 0.9.3，server 0.9.1，协议 22 | `herdr status` |
| herdr 鉴权 | socket `~/.config/herdr/herdr.sock` 权限 600，协议层没有鉴权，连上就能调全部约 130 个方法（含 `server.stop`、`pane.run`） | 调研第一节；`herdr api schema --json` |
| herdr 终端流 | `herdr terminal session observe <pane> [--cols] [--rows]` 与 `control <pane> [--takeover] [--cols] [--rows]`；observe 可多人同看、不改尺寸，control 同一时间只有一个、会改真实尺寸 | `--help`；调研第二节（实测） |
| herdr 发消息 | `agent.prompt` 的参数只有 `target`、`text`、`wait`，没有投递方式；会话 blocked 时拒绝；不跟踪轮次 | `herdr api schema --json`（AgentPromptParams）；`herdr agent prompt --help` |
| 投递方式 | omp 原生区分 steer 与 follow-up；Claude Code 在工作中收到输入时的行为未核实 | omp 的 CHANGELOG；调研第四节（推断） |
| 会话身份 | herdr 里的会话以 `agent_session.value` 认人（Claude 是会话 id，omp 是会话文件路径）；终端标题会过时（w1:p16 标题仍是“W00017 Workbench 组件重构”，实际在做 w00022）；Claude Code 的 shell 有 `CLAUDE_CODE_SESSION_ID`、`CLAUDE_CODE_CHILD_SESSION`、`CLAUDE_PID`、`HERDR_PANE_ID`，子代理与它派出的进程都继承父会话的 id 与 pane | 调研第一、四节；第三轮问题 12；补充分析 L4 |
| 运行 | herdr 只报告会话状态；会话 idle 时它派出的 omp 审查、e2e、开发服务可能仍在跑；进程归属要沿父进程链找；`pane.process_info` 给出 pane 的 shell 与前台进程 | 第三轮问题 6、8；`herdr api schema --json` |
| pane 标签 | `pane.report_metadata` 的 tokens 最多 16 个、`ttl_ms` 最大 86400000（24 小时），只用于显示，server 重启后不保留 | `herdr api schema --json`；调研 |
| 网络 | 本机有 `tailscale0`（在线）、`wlan0` 与多个 docker 网桥 | 调研第五节 |

## 方案

### 总体结构

```text
开发者 ──网页──> 面板服务 ──┐
                            ├──> 核心库 ──> 项目数据：主工作区 master 的 .agents/works/（入库；过渡期另读执行 worktree）
Agent  ──命令行──> nbdev ───┘           └─> 运行时登记：主工作区的 .local/agent/（不入库）
面板服务 ──方法白名单──> herdr（会话列表、终端流、进程归属、通知）
面板服务 ──> ~/.config/nbdev/（设备、令牌哈希、审计）
```

按领域模型第二版分两层：项目数据持久、入库，只有一份；运行时（会话、租约、通知、运行）临时、不入库。项目数据里没有任何字段指向会话，运行时只按 id 引用项目数据。

### 一、包的位置与形态

**方案**

- 位置：`packages/dev-panel`，包名 `@notnotype/dev-panel`，`private`，Bun 运行时，只支持 Linux。`bin` 声明 `nbdev`。
- 模块：
  - `src/core/`：定位主工作区、编号、记录读写、产物与提问、租约与运行、写事务；公开入口只用 Node 兼容的 API，供根脚本测试导入；
  - `src/herdr/`：herdr 适配层与方法白名单；
  - `src/server/`：HTTP 与 WebSocket、登录与请求校验、产物来源；
  - `src/web/`：前端；
  - `src/cli.ts`：命令行入口。
- 依赖方向：可依赖 `@notnotype/nb-ui`；开发依赖 `@notnotype/neuro-book-test-support`；不依赖 `@notnotype/neuro-book`，不导入根 `scripts/`。根脚本导入本包的公开入口是允许的方向。
- 包内合同：`CONTEXT.md`（术语与不变量，由领域模型第三节搬入）、`docs/`（命令行合同、文件格式、安全模型、herdr 适配），`AGENTS.md` 引用 `../../AGENTS.md`。
- 登记：根 `workspaces`、[`packages/AGENTS.md`](../../packages/AGENTS.md) 的包清单、[Monorepo 边界](../modules/monorepo-boundaries.md) 的表格；CI 矩阵是否纳入见待决问题。
- 用户级入口：`~/.local/bin/nbdev` 是一个 shim，内容只有 `exec bun "<主工作区>/packages/dev-panel/src/cli.ts" "$@"`，由包里的安装脚本写入。原因有两条：worktree 分支里没有这个命令，或者是旧版本；`bun run --cwd` 会把 cwd 和 `PWD` 换成主仓库根，命令行就不知道调用者在哪（补充分析 L1 已实测）。命令行自己用 `git rev-parse --path-format=absolute --git-common-dir` 找主工作区，用 `--show-toplevel` 确定调用者所在的 checkout。
- 代码版本：命令行与面板都跑主工作区里的代码。面板启动时记下 `master` 的 HEAD，HEAD 变了就提示“代码已更新，重启后生效”。
- 常驻（决定 9）：
  - `nbdev panel serve` 在前台运行，可以放在一个 herdr pane 或终端里；
  - 也可以装成用户级 systemd 服务：包里提供正式的单元文件 `nbdev-panel.service`（`Restart=on-failure`，日志进 journal），由安装脚本放到 `~/.config/systemd/user/`。不用 `systemd-run` 临时单元，因为停了以后不能用原名再起；也不用 Agent 的 `run_in_background`，因为它随会话退出；
  - 面板在跑时写 `.local/agent/panel.json`（端口、PID、启动时间、HEAD），命令行据此给出页面链接。

**备选与放弃理由**

- 命令行核心放根 `scripts/`、直接复用治理代码：网页要依赖 nb-ui，仍得在 `packages/` 下有一层，核心与界面就分在两处；决定 6 选了包加一致性测试。
- 放仓库根的独立目录：同样要登记 `workspaces`，没有好处。
- 做成 NeuroBook 插件：开发者已否决（Work README），面板不能依赖某个分支的产品代码。
- 每次用 `bun run --cwd <主工作区>` 调用：会丢失调用者的 cwd。

### 二、项目数据的读写

**写事务**

所有写入都经核心库的同一个写事务，不论来自 `nbdev` 还是面板。网页与命令行共用这一套实现，写操作因此串行：

1. 定位主工作区，确认它检出的是 `master`；不是就停下（命令行退出码 3，面板给出提示），不在别的分支上写记录。
2. 取锁：主工作区的 `.local/agent/registry.json.lock`（目录锁，做法同 `proper-lockfile`，由本包自己声明依赖）。领号、写文件与提交由这一把锁串起来；取锁超过 10 秒就失败，并报出持锁的进程。
3. 写文件：
   - 新文件用独占创建；
   - 新目录（新 Work、新 Task、新产物）先在 `.local/agent/run/tmp/` 建好，再整体改名到位，读者看不到写了一半的目录。临时目录不能放在 `.agents/works/` 下，因为 `governance:check` 会把那里任何不合编号格式的目录报成错误；
   - 改已有文件（Task 状态、README 正文）先比对内容哈希：读取时的哈希与写入前不同，就放弃写入并报出差异；
   - 写入某个 Task 的文件时，同时把它 frontmatter 里的 `updated` 改成当天日期（是否采用这个字段见待决问题）。
4. 提交：`git add -- <路径>` 后 `git commit -m <消息> -- <路径>`，只提交本次事务的路径；主工作区暂存区里别的会话的改动原样留着。碰到 `index.lock`（别的会话正在主工作区跑 Git）就退避重试约 10 秒；仍失败则保留已写的文件，输出 `committed: false` 与路径，退出码 1。
5. 放锁。

读取一律用 `git --no-optional-locks`，不刷新、不写回 index。索引只读 Work 层与 Task 层 README 的 frontmatter、Task 目录与产物目录的第一层，永不递归 `evidences/`（w00005 的 worktree 里 `.agents` 有 10 万多个文件）。

提交消息用 Conventional Commit，`docs(<workId>): …`，不加署名行。面板以主工作区的 Git 身份提交；谁答的记在答复文件里，不靠提交作者区分。

面板能写仓库、先不限制写什么（决定 11），但都走上面的写事务，并加三条护栏：路径必须在主工作区内、不经过符号链接、不碰 `.git/`；只提交本次改的路径；要改的文件已有别人未提交的改动时，先给出差异，默认拒绝（见待决问题）。

**过渡期：记录还在分支上的 Work**

开发者决定先不大范围迁移（t05）。过渡期内，没迁的 Work，面板与 `nbdev status` 从它的执行 worktree 读记录，并标“来自分支”；迁完以后只读 `master`：

- 判定“没迁”：某个已检出 worktree 的分支，相对 `master` 新增或改动了这个 Work 的记录（`git diff --name-only --diff-filter=AM master...<分支> -- .agents/works/<workId>/`）。结果现算，不存标记；分支上的记录迁走以后，就自动只读 `master`。
- 读哪一份：这个 Work 的执行 worktree，依次按三条来认：登记表的 `home` 提示；目录名以这个 Work 编号开头、不含 Task 段的 worktree（例如 `.worktree/w00017-runtime-foundation`）；最近改过记录的那一份。有几份时取最新的，其余列为“另有 N 份副本”。读的是工作区，包括未提交的内容；不读未检出的分支。
- 合成：只在 `master` 上有的 Task 照常从 `master` 读，例如已迁的 t80、t81 与经 `nbdev` 新建的 Task；它们与分支上的 Task 合成一张列表，每条标出来源。
- 写：经 `nbdev` 或面板新建的 Task 一律写进 `master`（记录只放主工作区）。要改一份仍在分支上维护的记录（状态、正文）时，`nbdev` 以退出码 3 拒绝，面板不给编辑入口，并提示按 Work 规则在原处改或先迁移。
- 编号扫描本来就覆盖各分支，不受过渡期影响。

**状态、目标与最近更新**

- Task 与 Work 的状态读 frontmatter 的 `status`（决定 14）。没有这个字段的显示“未标”。面板可以从正文推断一个近似值，但一律标“推断”、画成空心，因为推断并不可靠。字段在迁移或下次更新时补上；`nbdev task status` 与面板的状态切换让补字段只是一步操作。
- Work 的目标读 README 开头的“目标”一节；没有这一节的显示“未标”，从正文推断的标“推断”。
- “最近更新”优先读 frontmatter 的 `updated`（日期，由 `nbdev` 与面板写）；没有这个字段时，退回到最后一次碰这个 Task 的提交时间（待决）。

**文档与分支**

Spec 与项目文档随代码在各分支上改。面板的文档视图默认看 `master`，从某个 Task 进入时可切到该 Task 的 checkout；标出哪些分支改了这份文档（`git diff --name-only master...<分支>`）；未检出的分支默认不显示（决定 6）。

**并发时的处理**

| 情形 | 处理 |
|---|---|
| 网页与命令行同时领号，或两个会话同时 `work new`、`task new` | 同一把锁包住“扫描、分配、写、提交” |
| 会话直接改 Task README，面板同时改同一份 | 面板比对哈希，不一致就拒绝并给出差异 |
| 开发者在两个标签页各提交一次答复 | 一次提交一个文件，文件名带时间与随机后缀，独占创建；两份都留，以最新的为准 |
| 两个会话发布同一个产物 | 发布记录按版本号独占创建，撞了就取下一个号；输出里写明上一版是谁发布的 |
| 读的一方碰上写到一半 | 新文件先写临时文件再改名，读的一方忽略临时文件 |
| 别的会话在主工作区提交时，`nbdev` 或面板也要提交 | 路径限定的提交互不带走对方的暂存；`index.lock` 退避重试 |

**备选与放弃理由**

- 单独的记录分支：开发者不采用（决定 10）。
- 命令行与面板只写文件、提交留给 Agent（需求分析第七节的旧写法）：未提交的记录会被别的会话不加路径的提交顺手带走，别的会话也读不到可靠的状态；第二版改为命令行顺手提交。
- 用临时 index 加 `git commit-tree` 与 `update-ref` 做比较并交换，完全不碰共享 index：主工作区的 index 会和 HEAD 对不上，新文件显示成暂存的删除，还得再碰一次 index，并不省事。
- 不加锁、只靠 Git：领号是“读最大值、加一”，两边会拿到同一个号。
- 过渡期只读 `master`：w00017 等最活跃的 Work 会显示成停在 10-01 的占号副本，Work 视角是错的。
- 过渡期把分支上的记录自动同步到 `master`：等于替别的会话做迁移，开发者决定按授权逐条迁。

### 三、产物、提问与答复

**目录与发布记录**

产物属于 Task；少数属于 Work 的，放在 Work 目录下同名的 `artifacts/` 里：

```text
.agents/works/<workId>/tasks/<taskId>/artifacts/<artifactId>/
├── index.html                  # 入口；只有提问、没有页面的产物可以没有
├── r1/  r2/  …                 # 各轮的图与子页（design-review 的写法）
├── versions/v<N>.json          # 发布记录，一次发布一个文件，之后不改
└── answers/
    ├── <UTC 时间>-<随机>.json      # 答复：一次提交一个文件，只追加
    └── ack-<UTC 时间>-<随机>.json  # 会话把决定写进记录后的确认
```

- `artifactId` 用 kebab-case，在 Task 内唯一，例如 `review`、`omp-review-1`。
- **发布记录**（`nbdev.artifact-version/v1`）的字段：
  - 身份：`artifactId`、`workId`、`taskId`、`version`；
  - 种类：`kind`，取 `design`（设计稿）、`report`（讲解与报告）、`review`（审查报告）；
  - 内容：`title`、`entry`、`contentHash`（入口与它引用的本地文件的摘要，发布后被改了能看出来）；
  - 提问：`questions`（每题的题号、题目、类型、选项、是否必答与结局）；
  - 提问者：`askedBy`（提问者租约的 id 与会话快照：Agent 种类、会话 id、herdr pane；不在 herdr 里时为 `null`）；
  - 其它：`state`（`open` 或 `closed`）、`supersedes`、`publishedAt`。

  最新的一份发布记录决定当前状态。
- **Task 目录里的 Markdown**（需求分析、领域模型、调研、计划）算“文档类产物”：面板按文件索引并渲染，不要求搬进 `artifacts/`，没有发布记录；对它的提问挂在 Task 上，用 `--about <路径>` 注明指向哪份文档（待决，推荐这个做法）。
- **纯讲解页**：没有提问的产物不进收件箱，也没有“已看”状态（决定 6）。
- **图片**：发布时检查体积上限（单张约 300 KB、每个 Task 合计约 5 MB，决定 13），超出就警告并提示转成 WebP，原图留在 `.local/agent/…/shots/`。
- **证据**：面板在产物页的“证据”一类里只读列出 Task 的 `evidences/`。

**提问**

- **写在产物里**：在 HTML 里用约定的标记，即 `data-nb-question="<题号>"`、`data-nb-type`（`single`、`multi`、`text`、`confirm`）与选项标记。发布时用 HTML 解析器读出，写进发布记录，Agent 不用另写一份 JSON。题意变了就换题号。
- **挂在 Task 上**：要开发者拍板、又不依附某个页面的事（例如批准 Spec 晋升），发成一个没有页面的产物，只有发布记录与 `answers/`。答复的位置、收件箱与通知因此只有一套逻辑；另一种存法见待决问题。
- **会话里口头问的**：会话在对话里问了开发者、又希望留下记录时，用 `nbdev ask` 把提问记进 Task 的提问集，或者追加到某个产物的下一个发布版本。口头问、口头答不强制登记；答案需要留下的，由会话用 `nbdev answers record` 代录，并标为代录（决定 6）。
- **结局**：每道题有四种状态。
  - `open`：未答；
  - `answered`：有答复，由答复现算；
  - `withdrawn`：提问者撤回；
  - `superseded`：被新版本或别的提问取代，记下取代者。

  `withdrawn` 与 `superseded` 写在新的发布记录里（只追加）。新版本里不再出现的题号视为被这个版本取代。关闭产物等于撤回它所有未答的题。收件箱只算 `open` 的必答题，被取代的不再虚增待答数。
- **新版本之后的旧答复**：同题号的旧答复继续有效，标出“针对 v2”；新增或换了题号的回到 `open`。开发者对着旧版本提交时照收，按旧版本记。
- **审查报告**：每条审查意见是一道题，选项为“改”“不改”“要讨论”。面板不去解析报告正文。

**答复与确认**

- **答复**（`nbdev.answer/v1`）的字段：
  - `artifactVersion` 与 `contentHash`：开发者打开时的版本；
  - `submittedAt`；
  - `submittedBy`：开发者提交时是 `{kind: "developer", device}`，Agent 代录口头答复时是 `{kind: "agent-transcribed", session}`；
  - `values`：`{题号: 值}`，只含这次填的题；
  - `note`。

  改答案就再提交一份，旧的不删。
- **确认**（`nbdev.answer-ack/v1`）：会话读到答复、把决定摘成文字写进 Task 记录后，用 `nbdev answers ack` 写一份确认，记下确认到哪一份答复、哪个会话、一起提交了哪些文件。确认文件与写了决定的 Task README 放在同一个提交里。决定只认 Task 记录，答复是它的来源。
- 已答的题再分两种，都现算：“等会话采纳”是有晚于最近一次确认的答复；“已采纳”是最近一次确认不早于最新的答复。

收件箱只放要开发者动手的事：`open` 的必答题（含审查条目）与编号冲突。“会话在等你”只认经命令行登记的提问，不从终端末行推断。

**命令行**

`--json` 时输出 `{schema: "nbdev.<命令>/v1", ok, data, warnings, errors}`，诊断走 stderr。

| 命令 | 做什么 |
|---|---|
| `nbdev artifact publish <workId> <taskId> <artifactId> --kind <种类>` | 产物文件由会话直接写在主工作区的位置；发布时解析提问、检查图片体积、写发布记录并提交，同时取得或续期租约、记下 `askedBy` |
| `nbdev artifact close …` | 写一份 `closed` 发布记录，撤回未答的题 |
| `nbdev ask <workId> <taskId> --id <题号> --type <类型> --label <题目> [--option …] [--artifact <artifactId>] [--about <路径>]` | 登记提问：不加 `--artifact` 时记进 Task 的提问集，加了就追加到那个产物的下一个版本；也可以 `--from <json>` 一次登记多道 |
| `nbdev ask withdraw <提问>`、`nbdev ask supersede <提问> --by <提问>` | 记下提问的结局 |
| `nbdev answers [<workId> [<taskId> [<artifactId>]]] [--pending\|--unacked] [--wait [--timeout <秒>]]` | 读答复；`--wait` 等到有新答复才退出，会话可以用自己的后台机制挂着 |
| `nbdev answers ack <workId> <taskId> <artifactId> [--include <路径>…]` | 写确认，并把 `--include` 列出的记录放进同一个提交 |
| `nbdev answers record … --set <题号>=<值>` | Agent 代录开发者在会话里的口头答复 |

**面板里**

产物页左边是产物原页，放在另一个来源的沙箱 iframe 里；右边是问题侧栏，未答的在上、已答的收起，被取代与撤回的折叠。表单脚本由面板注入产物来源，答案经 `postMessage` 交给面板外壳；外壳按发布记录校验题号与取值后，经写事务提交。

**备选与放弃理由**

- 答复与讲解页留在 `.local/agent/`（需求分析的旧写法）：开发者改为入库（决定 12、14）。
- 所有答复追加进一个 JSON Lines 文件：并发追加与读到半行都要另外处理；一次提交一个文件，天然就是只追加。
- 提问另写一份 JSON 放在页面旁边：页面与 JSON 会不一致；标记写在页面里，只有一份。
- 从审查报告或 Task README 的正文里解析待定项：正文是给人读的，格式不稳；要开发者拍板的一律登记成提问。
- 把 Task 目录里的 Markdown 都搬进 `artifacts/`：会动已入库的路径与链接，而这些文件本来就在 Task 目录下，索引就够了。
- 产物页现在就支持 Vue 与 nb-ui 组件：`master` 与 w00017 的 nb-ui 相差很大，第一版只做 HTML（决定 6），w00017 合入后再加。

### 四、会话、运行与租约

**运行时登记**

运行时登记都在主工作区的 `.local/agent/` 下，不入库。决定 6 新增了 `run/`、`logs/`、`panel.json`，决定 14 规定租约不入库：

```text
.local/agent/
├── registry.json               # 编号登记表
├── registry.json.lock/         # 写事务的锁
├── panel.json                  # 面板在跑时写
├── run/
│   ├── leases/<leaseId>.json   # 租约
│   ├── notify/<UTC 时间>-<随机>.json  # 每次通知尝试一条
│   ├── procs/<runId>.json      # 经 nbdev 起的进程（开发服务等）
│   └── tmp/                    # 写事务的临时目录
├── logs/                       # 不属于任何 Task 的日志
└── works/<workId>/tasks/<taskId>/{reports,shots,logs}/   # 现行规则
```

**会话**

会话页以会话 id 加 herdr 里的 Agent 名称认会话（名称可用 `herdr agent rename` 改），旁边列它持有的租约，即它在动哪些 Task；不用终端标题。命令行按下表认出调用它的会话：

| 调用者 | 身份 |
|---|---|
| Claude Code 会话 | `CLAUDE_CODE_SESSION_ID`。子代理的 id 与父会话相同，靠 `CLAUDE_CODE_CHILD_SESSION` 认出，租约记在父会话名下，通知也落到父会话 |
| herdr 里的任何 Agent | 有 `HERDR_PANE_ID` 时调用 `herdr agent get`，取 `agent_session.value`、Agent 种类与 terminal id；pane id 只当线索 |
| 会话派出的进程（例如 `omp -p` 审查） | 继承了派出它的会话的 `CLAUDE_CODE_SESSION_ID` 或 `HERDR_PANE_ID`，按派出它的会话认，不另算一个会话 |
| 开发者手动起的 `omp -p` 与其它工具 | 没有继承来的身份，算外部会话；omp 的会话 id 取法未核实，用 `--as <标签>` 标明，否则记为未知会话 |

**运行**

运行是会话派出、在后台完成的事：omp 编码与审查、开发服务、测试、长任务。运行不持有租约，租约只属于会话。

- 归属：经 `nbdev` 起的运行，在登记里记下发起它的会话。其余的从 `/proc` 发现：只看 cwd 在本仓库或其 worktree 里的进程，沿父进程链向上找，碰到某个 pane 的 shell 或前台进程（`herdr pane process-info`）就归到那个 pane 上的会话；对不上的归“无主”。子代理看不见，不显示。
- 显示：会话状态（herdr 的 idle、working、blocked）与它的运行分开显示。会话 idle 不等于没有东西在跑。

**租约**（`nbdev.lease/v1`）

- 一个会话在一个 Task 上只有一份租约，`leaseId` 由会话与 Task 决定。字段：Work 与 Task、会话身份、`acquiredAt`、`lastActivityAt`、最近一次动作。
- 取得与续期：会话做任何 Task 相关的操作时顺手完成，包括 `task new`、改 Task 状态、`artifact publish`、`ask`、`answers`、`answers ack`；也可以 `nbdev lease take` 显式取得。
- 失效（决定 14），读取时现算：
  - herdr 里的会话：herdr 的会话列表里已找不到它的 `agent_session.value`；
  - 任何会话：超过 24 小时没有 Task 相关操作。
- 释放：
  - `nbdev release [<workId> <taskId>]` 主动释放；
  - Task 状态经 `nbdev` 或面板改成 `done` 或 `shelved` 时，自动释放这个 Task 的全部租约；
  - 失效与释放的租约文件不删，读取时跳过。
- “谁在动”：每份有效租约旁显示“最近活动”，超过 2 小时的淡化显示；失效规则仍是开发者定的 24 小时。
- herdr 标签：取得或续期时，如果在 herdr 里，就顺手执行 `herdr pane report-metadata --source nbdev --token work=… --token task=… --ttl-ms 86400000`，让 herdr 侧栏显示这个会话在动哪个 Task。标签只用于显示，herdr 重启就没了，以租约文件为准。
- 用途只有两个：Work 视角里“现在有谁在动它”，以及答复之后“通知谁”。

**备选与放弃理由**

- 在项目数据里记“哪个会话参与了哪个 Task”（领域模型第一版的“参与”）：开发者指出会话是临时的，项目数据不应指向会话，已取消。
- 让运行也持有租约：同一个 `omp -p` 在会话页里会出现两次，通知也会发给收不到消息的进程。
- 只用 herdr 的 pane 标签：herdr 重启就丢，外部会话也没有 pane。
- 会话转去别的 Task 时，自动让旧租约降级：判断“转去”要靠猜；最近活动时间淡化加主动释放就够了。
- 用常驻进程维持心跳：命令行不能依赖常驻进程，失效条件在读取时就能算出。
- 用终端标题当会话名：标题会过时。

### 五、编号分配

**方案**

- `nbdev work new <slug> --title <标题> --goal <一句话目标> --task <slug> [--task-title …] [--issue <编号>]` 与 `nbdev task new <workId> <slug> --title …`：在写事务里扫描已用编号、取最大值加一，建出最小 README，写登记表并提交，再取得新 Task 的租约。
  - Work 与首个 Task 一起建，因为 Work 必须至少有一个 Task；
  - Work README 开头有“目标”一节，frontmatter 写 `status: active`；
  - Task 写 `status: planned`，或用 `--status` 指定。
- 扫描来源：
  1. 主工作区的 `.agents/works/`，包括未提交、未跟踪的目录；
  2. 登记表（领了号、还没建成目录的）；
  3. 全部本地分支与远程跟踪分支的已提交树（`git ls-tree`，不 fetch），以及各 linked worktree 的工作区。过渡期分支上还有旧号；扫 12 个分支一共约 0.15 秒，迁移完成后也保留。
- Task 号按 Work 分别递增，允许两位与三位（t100 起，决定 6），与治理检查的正则一起改。
- 登记表 `registry.json`（`nbdev.registry/v1`）只记领号的事实：编号、slug、领号时间、领号会话、状态，以及 `worktree new` 写入的执行位置提示 `home`。
  - 状态有三种：`claimed` 是经命令行领的，`imported` 是首次导入的，`abandoned` 是领了不用的；三种号都不再发；
  - 执行位置以 Task 记录正文为准（worktree 一个 Task 一个，见 Work 规则“创建与执行”），`home` 只当提示（决定 6）；
  - 标题、进度、状态一律读 README。
- 撞号：同一个序号出现两个不同的 slug 就是撞号。`work new`、`task new` 照常发下一个号，输出 `conflicts[]` 列出全部位置，面板收件箱也列出；不自动改名，改号仍按 Work 规则由人处理。
- 扫描到不在登记表里的号时，补登为 `imported` 并给出警告：这说明有人绕过了命令行。
- 首次导入：`nbdev registry import`，可以重复运行，结果不变。
- 规则切换：Work 规则的“编号分配”一节改成“经 `nbdev` 领号”，与命令行同一次合入（决定 6）。在旧规则下工作的长期分支仍可能手工建号，下一次领号时的扫描会看到它们。

**备选与放弃理由**

- 保持人工协调：这正是要解决的问题。
- 只扫描 `master` 的已提交树：会漏掉主工作区里未提交的占号与分支上的旧号。
- 撞号时自动改名：会改掉别的会话正在用的身份，规则要求由人处理。
- 跨机器的编号服务：现在只有一台机器；记录都在 `master`，以后多台机器之间的撞号会在合并时暴露出来。

### 六、通知

**方案**

- 时机：开发者在面板上提交答复、答复入库之后。
- 对象：发布记录里的提问者租约。只有租约有效、且会话是面板管理的（在 herdr 里）时才投递。否则什么也不发，面板提示“答复已保存，没有可通知的会话”，同时列出现在持有这个 Task 租约的其它会话，开发者可以手动选一个。
- 投递方式（决定 8）：herdr 的 `agent.prompt` 没有投递方式参数，两种方式都由面板实现。
  - **followup**（缺省）：面板排队，订阅 herdr 的状态事件，等会话变成 idle 或 done，再核对一次身份与输入行，然后投递；
  - **steer**：会话在工作时立刻投递。omp 在工作中收到回车即 steer，有文档可查；Claude Code 在工作中收到输入的行为未核实，核实之前对 Claude 会话只给 followup；
  - 会话空闲时两种方式等价，都是立刻投。
- 投递前核对：
  1. 在 herdr 的会话列表里按 `agent_session.value` 找到会话，pane id 只当线索；找不到就不发。
  2. pane 上已经换成另一个会话（例如执行过 `/clear`）：不发，弹出小窗请开发者确认（调研推荐，开发者无异议）。
  3. 会话 blocked：不发，继续排队；状态 unknown：不自动发。
  4. 输入行不为空（开发者在 TUI 里打了半截字）：继续等。用 `agent.read --source detection` 判断，这一点未实测。
  5. 投递用 `agent.prompt`，带 `wait: {until: [working, blocked], timeout_ms: 10000}`，确认会话开始干活。
- 消息只放一行指针，不放答复正文，例如：`[nbdev] w00022/t03 产物 review v2 有开发者答复（3 题）。请运行 nbdev answers w00022 t03 review --json，把决定写进 Task 记录后运行 nbdev answers ack w00022 t03 review。` 根 `AGENTS.md` 加一句：收到 `[nbdev]` 开头的消息就照做。
- 失败时：

  | 情况 | 面板提示 | 处理 |
  |---|---|---|
  | `agent_blocked` | 会话在等确认 | 留在队列 |
  | 会话 id 对不上、`agent_not_running`、`not_found` | 会话已结束或已更换 | 不发，开发者可以另选会话 |
  | `agent_prompt_stalled` 或超时 | 已写入，但没看到会话开始工作，请看终端，不要重发 | 只记录，不重试 |
  | herdr 没在运行 | herdr 不可用 | 答复照常入库，会话可以用 `answers --wait` 自己取 |

- 记录：每次尝试写一条 `.local/agent/run/notify/…json`（时间、会话、方式、结果码），属于运行时，不入库。待发队列由“租约有效、且有晚于最近一次成功通知的答复”现算，面板重启也不会丢。
- 排队要面板在跑；面板没在跑时不排队，会话仍可以自己用 `answers --wait` 等。
- 提交答复后自动排队通知，不每次弹确认；小窗只在会话已更换或已结束时出现（调研推荐，开发者无异议）。
- 会话页的输入框可以给会话发任意文字（`agent.prompt`），常用键做成按钮（`agent.send_keys`）。这两项只对“可操作”设备开放，每次写一条审计。

**备选与放弃理由**

- `pane.send_text` 或 `pane.run`：原样打字，pane 回到 shell 时文字会被当成命令执行。
- 用 omp 原生的 follow-up 键（粘贴后按 Alt+Enter）：要用白名单外的 `pane.send_input`，有同样的 shell 风险，Claude Code 也没有对应的键。
- 用 Claude Code hooks 或 omp 扩展把答复注入会话：要改用户级或项目级配置，而且只在开发者再次打字时才触发。
- 只做 `answers --wait`（补充分析里的第一版建议）：保留为补充；开发者要的是面板主动通知。
- 消息里放答复正文：答复的唯一来源是 `answers/`；正文长了，Claude Code 会把粘贴折叠起来。

### 七、herdr 网页终端

**方案**（决定 7）

- 每个浏览器连接对应面板后端的一个子进程，WebSocket 两头转发；前端用 xterm.js 渲染帧里的 ANSI 字节。Bun 下用管道驱动即可，不需要 pty（调研实测）。
- **看**：`herdr terminal session observe`。多个浏览器同时看互不干扰，也不改终端尺寸；断线重连就重起一个 observe，第一帧就是整屏，面板不缓存屏幕。
- **接管键盘**：
  - 开发者点“接管”，改用 `control --takeover`，按网页的列数与行数 resize，键盘输入原样转发为 `terminal.input`；窗口尺寸变化时再 resize；
  - 离开页面、切到后台或断线时发 `terminal.release`；子进程退出也会自动释放控制权；
  - 接管前提示“终端会改成网页的尺寸，herdr 那边会重排”。
- 浏览器会吞掉 Ctrl+W、Ctrl+T 等组合键，Ctrl+C 也与复制冲突。页面因此提供 Esc、Ctrl+C、Shift+Tab、上、下、y、n、Enter 按钮；不接管时这些按钮走 `agent.send_keys`。
- 手机上以“纯文本视图（`agent.read --source recent-unwrapped`）加输入框”为主，终端画面次之（调研推荐，开发者无异议）。
- 不做鼠标事件：鼠标要 herdr server 0.9.2 以上，而 server 暂不升级。
- 会话列表来自 `session.snapshot` 加 `events.subscribe`，收到 `events_lost` 就重新订阅并对账；按工作目录区分本仓库与别的仓库的会话。
- 只有“可操作”设备能接管键盘，每次接管与释放都写审计。

**备选与放弃理由**

- 在 pty 里跑 `herdr agent attach`：与 control 抢同一个名额，没有只读模式，还多出 `ctrl+b` 前缀拦截。
- 面板自己托管终端：面板一重启 Agent 就没了，也丢了 herdr 的 Agent 识别，与“面板只做 herdr 的网页前端”（决定 4）相反。
- 第一版只看、输入走 API（调研的分期建议）：开发者要求第一版就能接管键盘（决定 7）；“只看”仍是缺省模式。

### 八、访问与安全

面板能看所有终端、往会话里打字、接管键盘、写仓库，所以面板的登录等于这台机器的 SSH 登录。herdr 的 socket 没有鉴权，面板后端是它前面唯一的门。

**方案**

1. **只绑回环**：面板与产物来源都只监听 `127.0.0.1`；配置里拒绝 `0.0.0.0` 与非回环地址（本机有 docker 网桥）。
2. **跨设备走 Tailscale Serve**：由 `tailscale serve` 提供带有效证书的 HTTPS，把面板与产物来源映射到 tailnet 主机名的两个 HTTPS 端口，只有自己 tailnet 里的设备能连。SSH 隧道作备用。只用 serve，不用 funnel。Tailscale 只负责传输，登录仍由面板做。
3. **设备配对登录**：
   - `nbdev panel pair [--tier view|operate] [--name …]` 打印一次性码与二维码，5 分钟有效、只能用一次；
   - 配对后发一个随机设备令牌，放在 `HttpOnly; Secure; SameSite=Strict` 的 cookie 里；服务端只存令牌哈希、设备名、级别与最近使用时间；
   - `nbdev panel devices` 可以列出与吊销设备；
   - Tailscale Serve 转发来的请求在面板看来也来自回环，所以回环请求同样要登录；本机浏览器用 `nbdev panel open` 拿一次性登录链接。
4. **分级**：“只看”能看记录、产物、文档与终端（observe）；“可操作”另能答复、写仓库、发消息、发按键、接管键盘（调研推荐，开发者无异议）。
5. **请求校验**：`Host` 白名单，防 DNS 重绑定；写请求与 WebSocket 升级校验 `Origin`，拒绝 `Origin: null`；写请求另带一个与 cookie 分开的 CSRF 令牌头。
6. **产物放另一个来源**：
   - 产物由第二个端口提供，只读，没有任何接口；
   - 面板里用沙箱 iframe 嵌入，允许脚本与表单，不给同源权限；
   - 答案经 `postMessage` 交给外壳，外壳只认这个 iframe 发来的、且符合发布记录的题号与取值；
   - 面板来源上一个 XSS 就等于一个远程 shell；分开以后，产物页的脚本出了问题也碰不到面板的接口。
7. **herdr 方法白名单**：
   - 放行：`ping`、`session.snapshot`、`agent.list`、`agent.get`、`agent.read`、`pane.list`、`pane.get`、`pane.read`、`pane.process_info`、`events.subscribe`、`agent.wait`、`agent.prompt`、`agent.send_keys`，以及命令行的 `terminal session observe` 与 `control`；
   - 其余一律在适配层拒绝，例如 `pane.run`、`pane.send_input`、`pane.send_text`、`agent.start`、`workspace.*`、`worktree.*`、`plugin.*`、`server.*`、`layout.apply`、`integration.*`；
   - `nbdev` 写 pane 标签用的 `pane.report_metadata` 由会话自己的命令行调用，不经面板。
8. **文件服务**：只读主工作区与各 checkout，拒绝 `.git/`、`.env*`、`node_modules`，防路径穿越与符号链接逃逸。
9. **凭据与审计放用户级目录** `~/.config/nbdev/`（权限 600）：设备表、令牌哈希与审计。审计文件 `audit.jsonl` 在每次发消息、发按键、接管键盘、写仓库时各写一条：时间、设备、对象、动作、文字或长度。不放 `.local/agent/`，因为 Agent 可以读写那里。
10. **配对上线之前关门**：跨设备访问完成之前，面板拒绝带 `Tailscale-User-Login`、`X-Forwarded-For` 等转发头的请求。提前打开 Tailscale Serve 也只会失败，不会裸奔。

**备选与放弃理由**

- 直接绑 `wlan0` 并自带 TLS（mkcert 或自签证书）：每台设备要装 CA 或点警告，TLS 与鉴权的代码都要自己维护；确实需要局域网直连时再做。
- 密码登录：要防爆破、要存密码；设备配对没有可猜的东西，还能逐台吊销。
- 回环上免登录：Tailscale Serve 转发的请求同样来自回环，回环免登录就等于对整个 tailnet 免登录。
- 令牌放 `.local/agent/`：Agent 能读写那里。

### 九、面板的视图

版式沿用已定的 B，即左栏导航加主区（决定 1）。左栏分组为“首页与收件箱、工作、产物、文档、现场”（决定 5），Work 与 Task 是层级（决定 2）。各页细节按 [design-review](../../.agents/skills/design-review/SKILL.md) 在 t03 的评审板上定，本提案只定内容来源：

| 视图 | 内容 | 数据从哪来 |
|---|---|---|
| 首页 | 收件箱在上；Work 区以每个 Work 一张卡片为主，卡片上有目标、Task 状态计数、待答数、谁在动、记录来自分支的警示（第三轮稿 A，待开发者确认）；会话与最近的变化 | 记录、发布记录、答复、租约、herdr、`git log` |
| 工作 | Work › Task 树。Work 页是一张 Task 表：状态、当前情况、最近更新、产物、待答提问、执行位置，另有“现在谁在动”。Task 页聚合 README、产物（含文档类产物）、证据、提交、相关 Spec、所在 checkout | 记录（过渡期含执行 worktree）、租约、Git |
| 产物 | 设计稿、讲解与报告、审查、证据四类，另列 Task 目录里的文档类产物；产物页带问题侧栏 | 发布记录、答复、Task 目录、`evidences/` |
| 文档 | Spec、ADR、Proposal、规范与测试规范、Skill、AGENTS、用户文档；默认看 `master`，可切 checkout | 各 checkout 与 `git show` |
| 现场 | 会话：以会话 id 加 Agent 名称认，状态与它的运行分开列，附租约；在跑（第一版只显示数量与入口，含“无主”的运行）；checkout；GitHub 的 Issue 与 PR | herdr、`/proc`、`run/procs/`、`git worktree list`、`gh` |

持久的数据（Work、Task、状态、产物、提问、答复）与临时的数据（会话、租约、谁在动、运行、排队的通知）分开画，后者一律标“临时”。没有字段、靠推断得到的值标“推断”（第三轮稿的画法）。

### 十、与现有治理脚本的关系

- **`governance:check`** 不变，仍负责检查 Work 与 Task 的身份。`nbdev` 写出的记录必须能通过它的 `verifyWorkContracts`。一致性由根 `scripts/ci/` 下的一条测试保证：导入本包的公开入口，在临时仓库里用核心库新建 Work 与 Task（含 t100），再跑 `verifyWorkContracts`，并比对两边的编号格式。依赖方向是根脚本依赖包，不是包依赖根脚本。`status` 的取值由 `nbdev` 在写入时校验，治理检查照旧不校验。
- **`governance:context`** 不变。它报告当前 checkout 的身份、分支与改动，仍是规则里恢复上下文的入口；在 worktree 里查记录照旧加 `--repo-root`。`nbdev status --work … --task … --json` 给出记录、产物、提问与租约的视图，不重复它的职责。以后是否在规则里改推 `nbdev`，见待决问题。
- **`governance:worktree`** 不变，仍是只读的清理报告。`nbdev worktree new` 在后续切片里按同一套命名规则建 worktree；两者名字相近的问题不在本提案范围内。
- 随 `nbdev` 上线要改的规则文字：
  - Work 规则：“编号分配”一节，如采用 `updated` 字段也写进来；
  - `.agents/works/AGENTS.md`；
  - `.local/README.md`：Agent 区加登记表、`run/`、`logs/`、`panel.json`；
  - design-review：发布评审板改用 `nbdev artifact publish`；
  - 根 `AGENTS.md`：收到 `[nbdev]` 消息就照做。

### 十一、非功能

- 只支持 Linux（依赖 `/proc`、herdr、systemd）；文件格式本身不依赖平台。
- 每个文件与每条 `--json` 输出都带 `schema`（`nbdev.*/v1`）；主版本不认识就明确报错，不猜。
- 性能目标以补充分析第七节的实测为依据：
  - 首页首屏在 20 个 checkout 以内不超过 1 秒，冷启动不超过 3 秒；
  - 搜索 2 秒内出第一批结果，超过 5 秒就截断并标出。
- 退出码：0 成功（含带警告的成功）、1 运行失败、2 用法错误、3 需要人决定的冲突、4 等待超时、5 找不到对象。

## 待决问题

| 问题 | 推荐 | 理由 |
|---|---|---|
| 1. 首页的 Work 区：卡片还是表 | 每个 Work 一张卡片（第三轮稿 A），Task 表放在 Work 页 | 首页要回答“哪个 Work 在等我、哪些在动”；表会随 Task 数增长（w00017 有 83 个），并且与 Work 页重复 |
| 2. 面板前端技术，用哪个版本的 nb-ui | Vue 3 加 Vite（不用 Nuxt），样式取 nb-ui 的 token 与主题。第一片界面先验证 `master` 的 nb-ui 组件能否脱离 Nuxt 使用；不能就只用 token 加少量自写组件，w00017 合入后再换成 nb-ui 组件 | 面板在 `master` 上，而 `master` 的 nb-ui 是 Nuxt 模块，与 w00017 差别大 |
| 3. 端口 | 面板 `127.0.0.1:4400`，产物来源 `127.0.0.1:4401`，可以用参数改 | 稿子里用过 4400；与本机见到的开发服务端口（4217 到 4219、4317 到 4319）不重叠 |
| 4. “最近更新”从哪来 | frontmatter 字段 `updated`（日期，由 `nbdev` 与面板写）；没有这个字段时，退回到最后一次碰该 Task 的提交时间 | 批量治理提交会把提交时间冲成同一刻；会话直接改正文而不更新 `updated` 时会显示旧日期，Work 规则加一句提醒即可 |
| 5. Task 目录里的 Markdown 算不算产物 | 算“文档类产物”，按文件索引，不要求搬进 `artifacts/`；对它的提问挂在 Task 上，并用 `--about` 注明文档 | 需求分析、领域模型、调研本来就在 Task 目录里；搬动会改已入库的路径与链接 |
| 6. 挂在 Task 上的提问怎么存 | 存成没有页面的产物（见第三节） | 答复位置、收件箱、通知只有一套逻辑；另一种做法是在 Task 目录下单设 `questions/`，要多一套逻辑 |
| 7. “已采纳”的确认入不入库 | 入库，与写了决定的 Task README 放在同一个提交里 | 下一个会话要知道答复是否已经处理；放在本地就只有本机知道 |
| 8. 面板编辑已有别人未提交改动的文件 | 默认拒绝并给出差异；开发者明确选择“连同这些改动一起提交”才放行 | 路径限定的提交会把同一个文件里别人的改动一起提交 |
| 9. Claude Code 会话的 steer | 核实之前只给 followup | herdr 的 `agent.prompt` 没有投递方式；Claude 在工作中收到输入的行为未核实 |
| 10. herdr 外会话的身份 | 用 `--as <标签>`；拿不到就记为未知会话，租约只按 24 小时失效 | omp 的会话 id 取法未核实，开发者手动起的 `omp -p` 不在 herdr 里 |
| 11. 设备令牌的有效期，手机的缺省级别 | 按空闲 14 天滑动，绝对上限 90 天；配对时显式选级别，缺省为“只看” | 调研的建议；手机丢失的风险高于台式机 |
| 12. GitHub 视图 | 第一版只读：列表、状态、检查结果、跳到 GitHub | 写操作属于远端写入，要单独授权 |
| 13. 文档视图默认看哪个 checkout | 从 Task 进入时看该 Task 的 checkout，从左栏进入时看 `master` | t80 这类分支上的 Spec 与 `master` 差别很大 |
| 14. 开发服务、`worktree new`、`find`、`shot` 进不进第一版 | 进，排在命令行核心之后，可以与面板并行；`shot` 只做薄包装（决定 6） | 需求分析第七节把它们列为第一版候选；首页的“在跑”只显示数量与入口 |
| 15. CI 是否纳入 workspace-packages 矩阵 | 纳入 typecheck 与 L1 到 L3 的测试；依赖 herdr 的 L4 测试在 CI 上跳过，记为未验证 | CI 上没有 herdr |
| 16. 编号规则切换与“实现分支不改 `.agents/works/`”冲突 | 已在 Work 规则里写明：实现分支不改的是 Work 目录；`.agents/works/README.md`、`AGENTS.md` 是治理规则，随命令行在同一分支修改、一起合入 | 决定 6 要求规则与命令行同一次切换 |
| 17. 规则是否改推 `nbdev status`，取代 `governance:context` 查记录 | 第一版不改，`nbdev` 稳定后再议 | 两者职责不同，先不动现有入口 |

## 数据、接口、安全、迁移、发布与回滚影响

- **数据**：
  - 入库的新增内容：产物目录里的 `versions/`、`answers/` 与确认文件；Task 与 Work frontmatter 的 `status`，以及待决的 `updated`；`nbdev` 与面板产生的提交，都在 `master` 上、路径限定。
  - 本地新增：主工作区 `.local/agent/` 下的登记表、锁、`panel.json`、`run/`、`logs/`。
  - 用户级新增：`~/.local/bin/nbdev`、`~/.config/nbdev/`，以及可选的 `~/.config/systemd/user/nbdev-panel.service`。
  - 已有的评审板没有发布记录，在面板里显示为“未发布”，可以浏览，但不进收件箱；有人 `artifact publish` 之后才进入收件箱。
- **接口**：命令行（命令、`--json` 结构、退出码）与面板的本机 HTTP、WebSocket 都是本工具的内部接口，合同写在包内文档；herdr 只经白名单使用。
- **安全**：见第八节。最大的风险是访问配置出错，例如绑到非回环地址、配对上线前打开 Tailscale Serve；第八节第 1、10 条让这两种情况都失败关闭。
- **迁移**：
  - 用 `nbdev registry import` 首次导入现有编号；
  - 编号规则随命令行同一次合入切换；
  - 记录迁移由 t05 按开发者授权逐条做，与本工具互不阻塞；过渡期的读法见第二节，迁完一个 Work，它就自动只读 `master`；
  - 缺少 `status` 与“目标”的记录显示“未标”，迁移或下次更新时补上；
  - Task 号扩成三位（t04 第 2 项）要在 `nbdev` 领号上线前完成。
- **发布**：不进 NeuroBook 的任何发布产物；包是 `private`，不发布到 npm。
- **回滚**：
  - 停掉面板，删除 shim 与单元文件，把 Work 规则的编号一节改回人工协调即可；
  - 入库的产物、答复与确认是普通文件，没有这个工具也能读；
  - `.local/agent/` 里的登记表与租约可以直接删除。

## 对 Spec 的预期改动

不改产品 Spec：`docs/specs/` 与 `packages/neuro-book/docs/` 不新增、也不修改任何 capability。面板与 `nbdev` 是开发工具，合同写在下列位置：

| 位置 | 内容 |
|---|---|
| `packages/dev-panel/CONTEXT.md` | 术语与不变量，由领域模型第三节搬入并补上本提案的新词（运行不持有租约、提问的四种结局、文档类产物）：项目数据与运行时两层、记录只有一份、项目数据不指向会话、答复只追加、决定只认记录 |
| `packages/dev-panel/docs/` | 命令行合同：各命令的输入、`--json` 输出、写什么、退出码与失败。文件格式：登记表、发布记录与提问标记、答复与确认、租约、通知记录。安全模型：绑定、配对、分级、请求校验、产物来源、herdr 白名单、审计。herdr 适配：用到的方法、版本要求、降级方式 |
| `packages/dev-panel/AGENTS.md` | 包的 owner 与验证命令，引用 `../../AGENTS.md` |
| `docs/modules/monorepo-boundaries.md`、`packages/AGENTS.md` | 新包的登记 |
| `.agents/works/README.md`、`.agents/works/AGENTS.md`、`.local/README.md`、design-review、根 `AGENTS.md` | 治理规则随上线改写，见第十节 |

验收以包内测试、治理检查与开发者在真实会话上的观察为准，按[测试规范的验证门禁](../testing/README.md#验证门禁)执行；各切片的判据见实施计划。

## 决策记录

开发者在 2026-10-12 作出的决定，原文见 [Work README](../../.agents/works/w00022-dev-panel/README.md)、[t03 README](../../.agents/works/w00022-dev-panel/tasks/t03-design/README.md) 与 [t05 README](../../.agents/works/w00022-dev-panel/tasks/t05-migrate-records/README.md)：

- 2026-10-12｜开发者｜面板是独立的本地开发工具，放在 `master` 上，不做成 NeuroBook 插件；开发者用网页、Agent 用命令行，Work 与 Task 编号会撞的问题借这个工具一起解决；同时重新划定本地与入库的边界（Work README）。
- 2026-10-12｜开发者｜确认需求分析第八节的七条：判据与本地目录、验证以摘要入库、第一版范围、面板只读、`packages/dev-panel`、共用核心库与登记表、经命令行领号。其中本地 Work、产物与答复留在本地、验收截图默认不入库、面板只读仓库几条，后来被领域模型第二版取代。
- 2026-10-12｜开发者｜决定 1：首页选 B（左栏导航加主区两栏），以后需要时再开三栏。
- 2026-10-12｜开发者｜决定 2：导航里 Work 与 Task 是层级关系（Work 下展开 Task）；另加 GitHub 的 Issue 与 PR。
- 2026-10-12｜开发者｜决定 3：“讲解页”这个概念要重新分类，先想清楚开发者经常要看哪些东西，再定导航与页面类型。
- 2026-10-12｜开发者｜决定 4：面板只做 herdr 的网页前端，会话由 herdr 后端托管，面板依赖 herdr。
- 2026-10-12｜开发者｜决定 5：内容分类与导航按主 Agent 的提议，分收件箱（只放要开发者动手的条目）、工作（Work › Task，Task 页是聚合页）、产物（设计稿、讲解与报告、审查、证据；提问能挂在任何产物上）、文档、现场（会话、在跑、代码、GitHub）。
- 2026-10-12｜开发者｜决定 6：需求补充分析里的待定项按推荐确认。具体为：
  - 产物页第一版只做 HTML；
  - worktree 一个 Task 一个；
  - Task 号允许三位（t100 起）；
  - omp 会话目录放 `.local/agent/…/reports/`；
  - 执行位置以 Work README 为准，登记表的 `home` 只当提示（worktree 改为一个 Task 一个以后，以 Task 记录为准）；
  - 新增本地目录 `run/`、`logs/`、`review/.pages/`、`panel.json`（`review/.pages/` 后因产物入库不再需要）；
  - 核心放 `packages/dev-panel`，并加编号规则一致性测试；
  - 命令名 `nbdev`，装用户级入口；
  - 小项：`dev stop` 默认不停别人的，同一 checkout 复用开发服务，未检出分支默认不显示，“治理文件落后 master”放第二版，允许 Agent 代录口头答复并标明，纯讲解页没有“已看”，只支持 Linux，`.local/agent` 不自动清理，`shot` 只做薄包装，用户区不动，编号规则随命令行同一次提交切换。
- 2026-10-12｜开发者｜决定 7：终端第一版就做到能接管键盘（observe 看，control 加 takeover 输入，按网页尺寸 resize，离开时 release）。
- 2026-10-12｜开发者｜决定 8：答复后的通知可选 followup（排在当前这一轮之后）或 steer（打断当前这一轮），按会话的 Agent 种类给出它支持的方式。
- 2026-10-12｜开发者｜决定 9：面板常驻，可以用包里的脚本启动，也允许装成用户级 systemd 服务。
- 2026-10-12｜开发者｜会话托管调研里其余的推荐，开发者没有提出异议，按推荐处理：自动排队通知；会话 id 变了不发；可操作设备能发任意文字；写 herdr pane 标签并在 `.local/agent` 留一份；跨设备走 Tailscale Serve；设备配对登录；令牌与审计放 `~/.config/nbdev/`；产物页放另一个来源；第一版不读会话 jsonl；herdr server 暂不升级；手机以输入框加纯文本为主。
- 2026-10-12｜开发者｜决定 10：记录只放主工作区 `master` 的 `.agents/works/`，实现分支不再带记录；不采用单独的记录分支。
- 2026-10-12｜开发者｜决定 11：面板能写仓库，先不限制写什么。
- 2026-10-12｜开发者｜决定 12：答复入库，只追加。
- 2026-10-12｜开发者｜决定 13：入库的是结论文字、不可重现的测量数值和少量精选截图（单张约 300 KB、每个 Task 约 5 MB 以内）；完整截图集、日志与原始输出留在本地。
- 2026-10-12｜开发者｜决定 14：取消本地 Work；Task 状态取 `planned`、`active`、`done`、`shelved`，写在 frontmatter；Work 取后三种，并在 README 开头写“目标”；租约在会话消失或 24 小时没有 Task 相关操作时失效，不入库。
- 2026-10-12｜开发者｜记录迁移先不大范围做，只迁本会话建的记录（已迁 w00017 的 t80、t81，见 t05）。
- 2026-10-12｜开发者｜接受本提案：17 条待决问题全部按推荐，其中首页的 Work 区用每个 Work 一张卡片（第三轮稿 A）；旧记录的 `status` 不集中补填，迁移或下次更新时补；常驻用正式的用户级 systemd 单元文件。按[实施计划](../../.agents/works/w00022-dev-panel/tasks/t03-design/plan.md)开始实施，开发者不在场时按 autonomous-delivery 的循环推进：计划与实现的审查都用 Claude Code 的 opus 子代理，不用 omp。
- 2026-10-12｜主 Agent（t06、t07 实施中，待开发者追认）｜实施修正，正文不改，以包内文档为准：
  - 第二节“没迁”的判定，改为 `master...HEAD` 与 `master HEAD` 两份 diff 的交集：只用三点 diff 时，分支按 t05 恢复记录之后仍会被判成没迁（t06 设计审查发现，主 Agent 复现）。
  - 第四节身份表“子代理靠 `CLAUDE_CODE_CHILD_SESSION` 认出”不成立：主会话的 Bash 里也有这个变量，它只表示“shell 是 Claude 派出的”；子代理与派出的进程都继承父会话的 `CLAUDE_CODE_SESSION_ID`，按它认即可。
  - 运行的归属改为先看进程环境变量里继承来的会话 id，再沿父进程链找 pane：实测父进程链会断（进程被收养到 PID 1）。
  - herdr 外的 omp 没有可用的会话 id，只能用 `--as`。
- 2026-10-13｜主 Agent（t08 实施中，待开发者追认）｜实施修正，正文不改，以包内文档为准：`answers ack` 带 `--through <cursor>`，只确认会话读过的答复，否则读完到确认之间开发者新交的答复会被一并确认；提问者、代录者与确认者的会话信息只放本地运行时，入库的发布记录、答复与确认里没有指向会话的字段；提问标记前缀为 `data-nbdev-*`；Task 提问集不能关闭，逐题撤回。
- 2026-10-13｜开发者｜跨设备访问：先用 SSH 端口转发（`ssh -L 4400:127.0.0.1:4400 -L 4401:127.0.0.1:4401`，再 `nbdev panel open --print`），不改代码；面板仍只绑回环。跨设备访问照原计划在 t11 之后做（实施计划的 t13），别的设备登录后与本机权限相同（改了待决问题 11“手机缺省只看”）。
- 2026-10-13｜开发者｜跨设备访问（t13）先不做：SSH 端口转发加 systemd 常驻服务已经够用，Tailscale Serve 搁置。
- 2026-11-10｜开发者（t22 评审板第 13 题与随后两问；t23 实施）｜页面里作答：评审板页面里每道题的材料末尾有答题控件（产物来源给 HTML 回应注入脚本，不改磁盘上的页面）；页面里填的经 `postMessage` 只进外壳的草稿，外壳只认这个 iframe 发来的、这一版待答题的合法取值，提交仍在外壳的侧栏里按。改了第六条“答案经 `postMessage` 交给外壳……经写事务提交”：页面不能替开发者提交，最多改动草稿，提交前开发者看得见。已知风险是页面能读到推给它的草稿，见 [panel.md 的“页面里作答”](../../packages/dev-panel/docs/panel.md#页面里作答t23)。
