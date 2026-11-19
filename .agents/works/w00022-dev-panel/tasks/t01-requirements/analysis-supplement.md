# 需求补充分析：数据、并发、跨 checkout、通道、命令行、迁移与非功能

2026-10-12 由子代理起草，主 Agent 核对后交开发者。依据 [需求分析](requirements.md)：第八节开发者已确认，本文不推翻；有不同意见的写进各节末尾“需要开发者决定的问题”和第九节。主 Agent 抽查属实的：根 `package.json` 的 `workspaces` 逐项列出；Task 号正则只认两位；会话环境里有 `CLAUDE_CODE_SESSION_ID`、`CLAUDE_CODE_CHILD_SESSION`、`CLAUDE_PID`、`HERDR_PANE_ID`，本机装有 `herdr`；w00005 的 worktree 里 `.agents` 有 10 万多个文件。

> 2026-10-12 后来的修订：领域模型第二版（[第八节](../t03-design/domain-model.md#八开发者的决定2026-10-12)）让记录只放主工作区 `master`、取消本地 Work、产物与答复入库，本文按“多个 checkout 各有一份记录”设计的部分随之过时，例如第三节 X1 到 X5 的跨 checkout 选当前快照、`.local/agent/works/` 作为本地 Work 的编号来源、本地 `review/.pages/`。方案以 [Proposal](../../../../../docs/proposals/dev-panel.md) 为准，本文保留当时的分析。

- 来源标注：**（现状）** 是 2026-10-12 在本机只读查到的事实；**（已确认）** 出自 requirements.md 第八节或已落地的规则；**（推断）** 是本文的设计推断，没有验证过。
- 路径默认相对仓库根；“主仓库根”指 `git rev-parse --git-common-dir` 的上一级，也就是本机的主工作区。

## 结论先行

1. **登记表只管号，不管状态**：登记表只记谁在什么时候、在哪里领了哪个号；标题、进度、执行位置都从 README 与 Git 现读，登记表里的执行位置只当提示。讲解页状态、进程是否在跑也一律现算，不存可变状态字段。这样它不会变成第二个真相源。
2. **核对已用编号要扫四处**：各 checkout 的工作区（包括未跟踪的目录）、全部本地分支与远程跟踪分支的已提交树、`.local/agent/works/`、登记表。实例：w00021 在 `master` 上没有提交，只在主工作区留了未跟踪的占号副本，再加上它自己的分支；只扫 `master` 的提交会漏掉它。（现状）
3. **命令行要用绝对路径调用**：worktree 分支里没有这个命令行。`bun run --cwd <主仓库根>` 会把 cwd 和 `PWD` 都换成主仓库根，命令行就不知道调用者在哪个 checkout。所以要用 `bun <主仓库根>/…/cli.ts` 或用户级 shim 调用，再由命令行用 `git rev-parse` 自己找主仓库根。（现状，已实测）
4. **所有写入都只建新文件**：登记表靠目录锁加“写临时文件再改名”；答案、确认、页面版本、进程登记一律一事一个新文件，用独占创建。读者不会读到写到一半的文件，几个会话同时写也不会互相覆盖。（推断）
5. **答案按问题 id 挂在页面版本上**：页面更新后，同 id 的旧答案继续有效，但标出“针对 v2”；只有新增或改了 id 的问题才回到待答复。这和 GitHub 评审意见在代码改动后标为 Outdated 的做法一样。（推断）
6. **第一版通道用 `answers --wait`**：Claude Code 用 `run_in_background` 跑它，开发者一提交，命令退出，会话就被唤醒，等待期间不耗 token，也不改任何配置。hooks、herdr 推送、omp 扩展都可行，但都要改用户级或项目级配置，留给开发者决定。（现状加推断）
7. **面板和命令行读 Git 时一律加 `--no-optional-locks`**：普通 `git status` 会顺手刷新并写回 index，要抢 `index.lock`；面板轮询时，正在提交的 Agent 可能报 `index.lock` 已存在。（推断，依据 Git 文档）
8. **扫描要有边界**：w00005 的 worktree 里 `.agents` 有 101,540 个文件、3.1 GB，其中 95,901 个未跟踪。索引只读固定深度的 README，不递归 `evidences/`。（现状）
9. **几处规则与事实要先对齐**（详见第九节）：
   - worktree 命名：规则写“一个 Work 共用一个 worktree”，实际做法和 design-review 都按 Task 建；
   - omp 会话目录：全局规则写“仓库之外”，新的 `.local` 规则写 `reports/`；
   - `workspaces` 是逐项列出的，不会自动收进 `packages/dev-panel`；
   - Task 号只有两位，w00017 已经用到 t81；
   - `master` 与 w00017 分支上的 nb-ui 差了 195 个文件。

## 一、数据模型

### 1.1 `.local/agent/` 的文件布局

在已确认的布局上补三处：进程登记 `run/`、不属于任何 Task 的日志 `logs/`、页面版本记录 `review/.pages/`。

```text
.local/agent/
├── registry.json                     # 编号登记表（已确认）
├── registry.json.lock/               # 登记表的目录锁（推断：proper-lockfile 的做法）
├── panel.json                        # 面板服务在跑时写：端口、PID、启动时间（推断）
├── run/<runId>.json                  # 进程登记，一个进程一个文件（新增，推断）
├── logs/                             # 不属于任何 Task 的进程日志（新增，推断）
└── works/<workId>/
    ├── README.md                     # 只有本地 Work 才有（已确认）
    └── tasks/<taskId>/
        ├── review/
        │   ├── index.html            # 评审板（design-review 的现有写法）
        │   ├── <pageId>.html 或 <pageId>/index.html   # 其它讲解页
        │   └── .pages/<pageId>/v<N>.json             # 页面版本记录，只增不改
        ├── answers/<pageId>/
        │   ├── <UTC 时间>-<随机>.json  # 一次提交一个文件
        │   └── ack-<UTC 时间>-<随机>.json  # Agent 确认已读
        ├── reports/ shots/ logs/      # 已确认
```

- **D1 页面身份**（推断）：`pageId` 由入口文件的位置决定。`review/index.html` 的 pageId 是 `board`；`review/<x>.html` 和 `review/<x>/index.html` 的 pageId 是 `<x>`。所属 Work 与 Task 由目录决定，版本记录里也存一份，用来校验。这样 t80 现有的 `review/index.html` 不用搬。

### 1.2 编号登记表 `registry.json`

```json
{
  "schema": "nbook.dev-registry/v1",
  "works": {
    "w00023": {
      "slug": "dev-panel-core",
      "claimedAs": "repo",
      "state": "claimed",
      "claimedAt": "2026-10-13T09:12:03+01:00",
      "claimedBy": {"tool": "claude-code", "sessionId": "…", "child": false, "herdrPane": "w1:p16"},
      "claimedFrom": {"checkout": ".", "branch": "master"},
      "home": {"checkout": ".worktree/w00023", "branch": "feat/w00023-dev-panel-core", "source": "worktree-new"},
      "tasks": {
        "t01": {"slug": "core-registry", "state": "claimed", "claimedAt": "…", "claimedBy": {}, "home": null}
      }
    }
  }
}
```

| 字段 | 含义 | 来源 |
|---|---|---|
| 键 `w00023` | 只用五位序号作键：规则规定“名称不同也不能复用同一序号” | 已确认 |
| `slug` | 领号时的名字；扫描到同号不同名就是撞号 | 推断 |
| `claimedAs` | 领号时是仓库 Work 还是本地 Work。**当前类别不存**，看 README 实际在 `.agents/works/` 还是 `.local/agent/works/`，所以本地 Work 转入仓库后不用改登记表 | 推断 |
| `state` | 三个值。`claimed`：经命令行领的；`imported`：首次导入时从现有目录登记的；`abandoned`：领了不用。三种号都**不再发放** | 推断；“不复用”是已确认 |
| `claimedBy` | 领号的会话。Claude Code 的 shell 里有 `CLAUDE_CODE_SESSION_ID`、`CLAUDE_CODE_CHILD_SESSION`、`CLAUDE_PID`、`HERDR_PANE_ID`，可以自动取；omp 的 shell 有 `OMPCODE=1`，但会话 id 怎么取还没核实 | 现状 |
| `claimedFrom` | 领号时所在的 checkout 与分支，只作来历 | 推断 |
| `home` | 预定的执行位置，由 `worktree new`、`task new --in` 写入。它只是提示：面板会校验它，失效时按第三节的顺序推算 | 推断 |
| 不存的字段 | 标题、进度、Issue、是否收尾：这些一律读 README | 已确认的“不是第二个真相源” |

需求：

- **D2 领号**：Agent 运行 `work new`、`task new` 时，命令行先取锁，再扫描 1.3 节列出的四处来源，取所有已知号的最大值加一，写回登记表，最后释放锁；接着建出 README。README 没建成时号也算用掉：`status` 会列出“已登记、没找到 README”，号不收回。（推断；“读最大值加一”是已确认）
- **D3 编号有空缺可以接受**：放弃和失败都会留下空号，不回填。（推断）
- **D4 Task 号用尽**：治理检查的正则规定 Task 号只能两位（`scripts/ci/agent-governance-contract.ts` 的 `WORK_TASK_ID_PATTERN = /^t(?!00)[0-9]{2}-…/`），而 w00017 在 t80 分支上已经到 t81。（现状）领到 t99 以后，`task new` 以退出码 3 失败，提示“w00017 的 Task 号已用完，需要开发者决定扩成三位或开新 Work”。（推断）

### 1.3 与仓库里已有编号的核对，以及撞号怎么报

扫描来源（推断；每一处都有现状依据）：

| 来源 | 为什么要扫 | 2026-10-12 的实例 |
|---|---|---|
| 各 checkout 的工作区 `.agents/works/`（包括未跟踪、未提交的） | 占号副本可以不提交 | 主工作区里 w00021 的占号副本和 w00019 的 t08、t09 都没有被跟踪 |
| 全部本地分支和 `refs/remotes/*` 的已提交树（`git ls-tree`，不 fetch） | 有的分支没有检出 | `backup/w00017-before-trailer-cleanup`、`remote` 没有检出；12 个本地分支全扫一遍用 0.15 秒 |
| `.local/agent/works/` | 本地 Work | 目前没有 |
| 登记表 | 领了号还没建目录的 | 目前没有 |

撞号的定义与报告（推断）：

- **Work 撞号**：同一个五位序号出现两个不同的 slug。
- **Task 撞号**：同一个 Work 里同一个两位序号出现两个不同的 slug。今天扫遍所有本地分支，没有发现。（现状）
- **绕过登记**：扫描到的号不在登记表里。命令行把它补登为 `imported`，同时给出警告，因为这说明有人按旧规则手工建了目录。
- **怎么报**：
  - `work new`、`task new` 照常发下一个号，不被冲突挡住，但输出 `conflicts[]`，每一项列出全部位置（checkout、分支、路径）；
  - `status` 把冲突列在“等我处理”里；
  - 不自动改名（已确认）；改号仍按 [Work 规则](../../../../works/README.md#编号分配与记录位置) 由人处理。

### 1.4 讲解页的元数据

版本记录 `review/.pages/<pageId>/v<N>.json` 用独占创建写成，之后不再改动：

| 字段 | 含义 |
|---|---|
| `schema` | `nbook.dev-page/v1` |
| `pageId`、`workId`、`taskId` | 身份，与目录一致 |
| `version` | 从 1 起递增 |
| `entry` | 入口文件，相对 Task 目录，例如 `review/index.html` |
| `title` | 标题 |
| `questions` | `[{id, label, type, required, options?}]`。`type` 取单选、多选、文字、确认、标注之一。发布时从入口文件的标记（例如 `data-nb-question`）解析，Agent 不用另写一份 JSON |
| `contentHash` | 入口文件与它引用的本地资源的摘要；发布之后文件又被改了，面板就能看出来 |
| `publishedAt`、`publishedBy` | 发布时间与会话，结构同 `claimedBy` |
| `supersedes` | 可选：这一页取代了哪些页 |

另有 `review/.pages/<pageId>/closed-<时间>.json`，由 `page close` 写，表示 Agent 已经把决定写进 README，这一页可以收起。

状态全部现算，不存字段（推断）：

| 状态 | 判定 | 开发者看到 | Agent 看到 |
|---|---|---|---|
| 草稿 | `review/` 下有入口文件，但还没有版本记录 | 在“浏览”里能打开，“等我处理”不列 | 不出现 |
| 待答复 | 最新版本有必答问题，其中至少一个在任何版本里都没有同 id 的答案 | 列在“等我处理” | `answers` 里是 `pending` |
| 已答复 | 必答问题都有答案，且最新的答案晚于最近一次确认 | 显示“等 Agent 读” | `answers --unread` 返回它 |
| 已读 | 最近一次确认不早于最新的答案 | 不再列出 | 不再返回 |
| 过期 | 有 `closed-*.json`，或被别的页面的 `supersedes` 指向，或所属 Work 的 README 已有“已收尾：”一行（规则规定的固定写法） | 可以看，提交按钮不可用 | `answers` 标出 `closed` |

- **D5 没有问题的页**（纯讲解）：不进“等我处理”，只出现在“最近的变化”。要不要“已看”状态见本节末尾的问题。

### 1.5 答案

`answers/<pageId>/<UTC 时间>-<4 位随机>.json`，先写临时文件再改名，之后不改：

| 字段 | 含义 |
|---|---|
| `schema` | `nbook.dev-answer/v1` |
| `pageId`、`workId`、`taskId` | 身份 |
| `pageVersion`、`pageContentHash` | 开发者**打开页面时**的版本，不是提交时的最新版本 |
| `submittedAt` | 提交时间 |
| `submittedBy` | `{kind: "developer"}`，由面板写；以后如果允许 Agent 代录开发者在会话里的口头答复，就写 `{kind: "agent-transcribed", sessionId}` |
| `values` | `{问题 id: 值}`，只含这次填写的问题 |
| `note` | 整页备注 |

- **D6 改答案**：重新提交即可。旧文件保留，以最新的为准。（推断，“只追加”是已确认）
- **D7 确认已读**：只有 `answers --ack` 写确认文件，内容是 `{ackedAt, upTo: 最新答案的文件名, by: 会话}`。只读不确认，Agent 这一轮失败时，答案仍然是“未读”。（推断）

### 1.6 进程登记 `run/<runId>.json`

| 字段 | 含义 |
|---|---|
| `runId` | 例如 `dev-20261012T1315Z-a3f9` |
| `kind` | `dev`、`omp`、`shot`、`other` |
| `checkout`、`branch`、`workId?`、`taskId?` | 归属 |
| `argv`、`cwd` | 启动方式 |
| `pid`、`pgid`、`procStart` | `procStart` 取 `/proc/<pid>/stat` 的第 22 个字段，用来防 PID 复用 |
| `bootId` | 取自 `/proc/sys/kernel/random/boot_id`；重启后的登记一律视为已结束 |
| `ports`、`url` | 从日志里解析出的实际地址 |
| `logPath` | 日志文件 |
| `startedAt`、`startedBy` | `startedBy` 带发起会话的 `CLAUDE_PID`，用来判断“发起的会话已经结束” |
| `supervisorPid` | 命令行自己的监管进程 |
| `endedAt`、`exitCode`、`signal` | 进程退出时，由监管进程写临时文件再改名补上 |

- **D8 判断已经结束**：满足任一条就算结束，并且不用 `pgrep -f`（全局规则）：
  1. 有 `endedAt`；
  2. `bootId` 变了；
  3. `/proc/<pid>` 不存在，或它的 `procStart` 与登记不同。

  （推断）
- **D9 疑似孤儿**：进程还在，但发起它的会话的 PID 已经没了，就标“发起会话已结束”。日志文件多久没增长也一并显示。（推断）今天 `.worktree/w00017-runtime-foundation` 里有两组开发服务：4217 到 4219 那组的父进程是 24 小时前启动的 `bun run --cwd=packages/neuro-book dev`，4317 到 4319 那组是 32 分钟前启动的；两组都没有登记。（现状）
- **D10 子代理看不到**：Claude Code 的子代理不是独立的系统进程；herdr 也只列出顶层会话（`herdr agent list` 列出 10 个会话，有会话 id、working 或 idle、pane）。所以运行状态里的“子代理”一项，只能靠它们自己登记，否则就不显示。（现状）

### 需要开发者决定的问题

1. Task 号只有两位，w00017 已到 t81：是把治理规则和正则扩成三位，还是满了就开新 Work？
2. 登记表要不要存 `home`（执行位置的提示）？不存的话，执行位置全靠目录名和分支名推算，第三节的例外情况就认不出来。本文建议存，只当提示。
3. 在已确认的布局之外新增 `run/`、`logs/`、`review/.pages/`、`panel.json`，可以吗？
4. 没有问题的讲解页要不要“已看”状态？要的话，面板除了答案还得写“已看”记录，只写答案的边界就要放宽。

## 二、多 Agent 并发

| 情形 | 会撞在哪里 | 处理（推断） |
|---|---|---|
| 两个会话同时 `work new` | 两边都读到同一个最大值 | 用登记表的目录锁把“扫描、分配、写回”整段包住（扫描只要 0.2 秒左右）。仓库根依赖里已经有 `proper-lockfile` 4.1.2，带本仓的补丁，可以直接用。写回时先写临时文件、刷盘、再改名。取锁超过 10 秒就以退出码 1 失败，并报出持锁进程 |
| 同时 `task new` 同一个 Work | 同上 | 同一把锁 |
| 一个会话按旧规则手工建目录，另一个同时用命令行领号 | 手工的目录还没落盘，扫描看不到 | 和今天的风险一样大。事后由 `status` 的“绕过登记”和“Work 撞号”发现 |
| 两个会话发布同一个 pageId | 版本号相同；页面文件被后写的覆盖 | 版本记录用独占创建，失败就取 N+1 重试。`page publish` 发现上一版是别的会话发布的，就给出警告，并把对方的会话 id 写进输出 |
| 开发者正在填写，Agent 发布了新版本 | 答案对应的是旧版本 | 页面顶部提示“已更新到 v3”；提交时仍按打开时的版本记录，见第四节 |
| 开发者提交两次，或开了两个标签页 | 文件名可能相同 | 文件名带随机后缀，并用独占创建；两份都保留，以最新的为准 |
| Agent 读答案时面板正在写 | 读到半个 JSON | 面板先写 `.tmp` 再改名，读的一方忽略 `.tmp` |
| 两个会话都读、都确认同一页的答案 | “已读”属于谁 | 确认文件按会话分开写，“已读”只要有一份确认就算；`answers --mine` 只看自己发布的页 |
| 两个会话在同一个 checkout 起开发服务 | 共用构建缓存和状态根；今天 w00017-runtime-foundation 里已经有两组（现状） | `dev start` 发现同一 checkout 已有在跑的登记服务，就直接返回它的地址（`reused: true`），要另起一个得加 `--new` |
| 不同 checkout 起开发服务 | 端口 | 应用自己会把三个端口一起加 100，最多试 10 组（w00017 分支 `src/server/dev/config.ts`，现状）；命令行从日志里解析实际端口再登记 |
| 一个会话要停另一个会话起的服务 | 停掉别人正在用的服务 | `dev stop` 默认只停自己起的；停别人的要加 `--force`，输出里写明属主 |
| 面板、命令行轮询 `git status`，同时 Agent 在提交 | `index.lock` | 所有读操作都用 `git --no-optional-locks`（或设 `GIT_OPTIONAL_LOCKS=0`） |
| 两个会话同时 `worktree new` 同一路径 | 后一个失败 | `git worktree add` 本身拒绝已有路径；命令行先查登记表和路径，冲突时以退出码 3 停下，不自动改名（与 [仓库维护流程](../../../../../docs/standards/repository-workflow.md#worktree-与分支) 一致） |
| 面板服务的代码比命令行旧 | 读不懂对方的新格式 | 每个文件都带 `schema` 版本；主版本不认识就明确报错，不猜 |

### 需要开发者决定的问题

1. `dev stop` 默认能不能停别的会话起的服务？本文建议不能，加 `--force` 才可以。
2. 同一个 checkout 已有开发服务时，默认复用（本文建议），还是默认另起一个？

## 三、跨 checkout 的索引

现状：

- 主工作区加 10 个 worktree，共 11 个 checkout；本地分支 12 个。
- w00017 有好几份副本：
  - `master` 上已提交的是 t01 到 t30 的**较旧版本**，不只是占号副本；
  - `refactor/w00017-runtime-foundation` 上是 t01 到 t79；
  - t80 和 t81 两个 Task 只在 `t80/settings-ui` 和 `t81/nb-ui-fixes` 两个分支上。
- 10 个 worktree 的目录名都以 `wNNNNN-` 开头，Task 级的 worktree 带 `-tNN-`，但分支名不统一：`t80/settings-ui`、`t81/nb-ui-fixes`，审查用的 worktree 是 detached。
- 主工作区的会话 cwd 都是主仓库根：herdr 列出的 neuro-book 会话 cwd 全是主仓库根，哪怕它们实际在 worktree 里干活。

需求（推断）：

- **X1 显示哪一份**：每个 Work 和 Task 按下列顺序选“当前快照”：
  1. 登记表的 `home`，前提是路径存在、分支对得上、里面确实有这个目录；
  2. 目录名匹配 `wNNNNN`（Task 还要匹配 `-tNN-`）的 checkout；有几个时，取 README 最近改过的一份（工作区看 mtime，未检出的分支看提交时间）；
  3. `master` 上的版本。
- **X2 怎么标**：
  - 快照上标来源，分四种：“实现分支的快照（路径、分支）”“主工作区的占号副本（冻结）”“master 上的版本（可能较旧）”“未检出的分支（只读，经 `git show`）”，本地 Work 另标“本地”；
  - 页面底部列出“其它 N 份副本：内容相同 M 份，不同 K 份”，用 README 的 blob 哈希比较，点开能看差异。
- **X3 未检出的分支**：编号核对一律要扫；页面上只在 `home` 指向它，或开发者打开“显示所有分支”时才显示，经 `git show <分支>:<路径>` 只读地读取，图片也一样。
- **X4 worktree 删了、分支合并了**：
  - worktree 删了、分支还在：从分支读，标“worktree 已删”；
  - 分支已经是 `master` 的祖先：显示 `master` 的版本，标“已合入”；
  - 分支也没了、`master` 里也没有：列进“等我处理”里的“执行位置丢失”。
  - 面板不改登记表（只读原则），这些都是现算。
- **X5 checkout 对应哪个 Work 和 Task**：首页每个 checkout 依次按登记表的 `home`、目录名的 `wNNNNN(-tNN)?`、分支名里的 `wNNNNN` 或 `tNN` 判断，都不中就标“未关联”。今天 10 个 worktree 都能靠目录名对上。（现状）
- **X6 扫描有边界**：
  - 索引只读 Work 层和 `tasks/<T>/` 层的 `README.md`；某个 Task 的文件列表在打开时才读第一层；永不递归 `evidences/`。
  - 未提交文件数用 `git --no-optional-locks status --porcelain=v2 -unormal`，未跟踪目录合成一项计数。在 w00005 里实测 0.045 秒、68 项；如果逐个列出未跟踪文件，会得到 95,901 项。
- **X7 搜索去重**：同一相对路径、同一内容在几个 checkout 里出现时合成一条，标“5 个 checkout 相同”，内容不同的分开列。例如 w00017 t79 的 README 在 5 个 checkout 里各有一份。
- **X8 Spec 与规则也分 checkout**：默认显示 `master` 的版本，可以切换 checkout，切换后标“与 master 不同”。今天 w00017 系列的分支连根 `AGENTS.md` 都不一样（v2 重建）。还有一项可选：首页标出“治理文件落后 master”的 checkout，只比较 `.agents/works/README.md`、`.local/README.md`、`.agents/skills/` 这几处。现状是 w00017 系列与 w00021 的 worktree 里，`.local/README.md` 还写着“Agent 不得读写 `.local/`”，也没有 design-review 这个 Skill。

### 需要开发者决定的问题

1. 没有检出的分支（例如 `backup/w00017-before-trailer-cleanup`、`remote`）默认要不要在面板里显示？编号核对无论如何都会扫它们。
2. “治理文件落后 master”的提示要不要放进第一版？

## 四、Agent 与开发者的通道

### 4.1 开发者提交以后，Agent 怎么知道

| 做法 | 可行性 | 代价 |
|---|---|---|
| A0 开发者在会话里说“填好了”，Agent 跑 `answers` | 已确认的基线 | 开发者要回会话打字 |
| A1 `answers --wait --timeout 2h`，Agent 用 Claude Code 的 `run_in_background` 跑 | Claude Code 的后台命令一退出，就会重新唤起会话（现状：工具说明如此）。命令行只要轮询或 inotify 盯住答案目录 | 不改配置，等待期间不耗 token；只在会话活着时有效；超时就以退出码 4 退出，Agent 可以再挂上；要受 Claude Code 后台任务存活上限的约束（全局规则提到过）；omp 的 `proc://` 后台进程退出时会不会唤醒会话，还没核实 |
| A2 Claude Code 的 Monitor 工具跑 `answers --watch` | 可行 | 每次最多盯 30 分钟，到期要重挂，每次重挂都耗一轮；只适合短时间等待 |
| A3 Claude Code hooks：`UserPromptSubmit` 时跑 `answers --unread --mine --brief`，把结果注入上下文；`SessionStart` 时列出待读 | 可行；项目里现在没有 `.claude/settings.json`，只有 `settings.local.json`（现状） | 要改项目或用户配置；每条消息多 0.1 到 0.3 秒；会影响本仓库的所有会话，包括无关的，所以只在有未读时输出 |
| A4 herdr 推送：面板上有“通知会话”按钮，调用 `herdr agent prompt <pane> "<页面> 有新答案，跑 answers"` | herdr 在跑（0.9.1）；`agent list` 有会话 id、pane 和 working／idle 状态；发布时能从环境变量记下 `HERDR_PANE_ID` 与会话 id（现状） | 往别的程序的输入里打字，越出了“面板只写答案”的边界；要先核对 pane 上还是原来的会话，并等它空闲（`herdr agent wait`）再发；依赖用户级工具；Claude 和 omp 都能用 |
| A5 omp 扩展：盯答案文件，用 `pi.sendMessage(…, {triggerTurn: true})` 把消息注入会话 | omp 自带这样的示例（`examples/hooks/file-trigger.ts`，现状） | 用户级扩展，每个 omp 会话都会加载，包括 `omp -p` 跑的编码任务，所以要限定只在交互会话里生效 |

建议：第一版做 A0 和 A1，只有命令行，不碰配置；A3、A4 留给开发者决定，作为后续选项。（推断）

### 4.2 讲解页更新以后，旧答案怎么办

- **A6 答案不删、不改**：每份答案带着开发者打开时的 `pageVersion`。（已确认“只追加”，加上推断）
- **A7 按问题 id 沿用**：
  - 新版本里问题 id 不变的，旧答案继续有效：表单用它预填，`answers` 输出 `stale: true` 和对应的版本，面板标“沿用 v2 的答案”；
  - 新增或换了 id 的问题回到待答复；
  - 页面写法要规定：问题的意思变了，就换一个 id。

  （推断）
- **A8 按旧版本提交**：开发者对着旧版本提交时，服务端照收，按旧版本记，页面提示“已有 v3，请看变化”。这样开发者填的内容不会丢；该采纳哪一份由 Agent 判断。（推断）
- **A9 关闭或被取代的页**：答案仍然能读，`answers` 标出 `closed`。（推断）
- **A10 决定以文字入库**：读到答案以后，Agent 要把决定写进 Task README（已确认）。`answers --ack` 的输出里带一句提醒；面板可以把“答复晚于 Task README 最后一次修改”的页面标成“答案还没写进 README”，这只是提示，不作门禁。（推断）

### 需要开发者决定的问题

1. 第一版是不是只做 A0 和 A1？A3（hooks，要改 `.claude/settings.json`）和 A4（herdr 推送）要不要排进后续？
2. 要不要允许 Agent 代录开发者在会话里的口头答复（`submittedBy: agent-transcribed`），让答案记录完整？

## 五、命令行

### 5.1 总则

- **L1 调用方式**（现状加推断）：
  - 命令行在 `master` 上，worktree 分支的 `package.json` 里没有它；`bun run --cwd <主仓库根>` 又会把 cwd 和 `PWD` 都换掉（`INIT_CWD` 也没有，已实测）。
  - 所以调用方式只能是 `bun <主仓库根>/packages/dev-panel/src/cli.ts <命令>`，或者一个用户级 shim。下文用 `nbdev` 作占位名。
  - 命令行自己用 `git rev-parse --path-format=absolute --git-common-dir` 找到主仓库根，与 `scripts/ci/agent-governance-contract.ts` 的 `primaryCheckoutRoot` 是同一个做法；再用 `--show-toplevel` 确定调用者所在的 checkout。
- **L2 输出**：
  - 默认输出给人看的文字；
  - `--json` 时 stdout 只有一个对象：`{schema: "nbook.dev-cli.<命令>/v1", ok, data, warnings: [], errors: [{code, message, detail}]}`，诊断信息走 stderr；
  - 时间一律带时区的 ISO 格式，文件名用 UTC，界面按 Europe/London 显示。
- **L3 退出码**：

  | 退出码 | 含义 |
  |---|---|
  | 0 | 成功，包括带警告的成功 |
  | 1 | 运行失败：git、IO 或子进程出错 |
  | 2 | 用法错误 |
  | 3 | 需要人决定的冲突：撞号、路径被占、Task 号用尽、动的是别人的进程 |
  | 4 | 等待超时 |
  | 5 | 找不到对象 |

- **L4 调用者身份**：从 `CLAUDE_CODE_SESSION_ID`、`CLAUDE_CODE_CHILD_SESSION`、`CLAUDE_PID`、`HERDR_PANE_ID`、`OMPCODE` 自动取，也可以用 `--as <标签>` 覆盖。注意子代理的 `CLAUDE_CODE_SESSION_ID` 与父会话相同，只能靠 `CHILD_SESSION` 区分出“这是子代理”。（现状）
- **L5 写入范围**：每个命令写什么都列在下表；除此以外不写任何文件。

### 5.2 各命令

| 命令 | 输入 | `--json` 的 data | 写什么 | 失败 |
|---|---|---|---|---|
| `status` | `[--checkout <路径>] [--work <id>] [--fast]`（`--fast` 不算领先落后） | `checkouts[{path, branch 或 null, head, work, task, dirty, ahead, behind, mergedIntoMaster, runs[]}]`、`works[{id, kind, title, home, current, copies[{location, label, readmeHash}], tasks[]}]`、`pending[{type, workId, taskId, pageId, status, version, since}]`、`runs[{runId, kind, checkout, url, alive, ownerAlive, logIdleSec}]`、`conflicts[]` | 不写 | 某个 checkout 读不了（例如已被删除的 worktree），记一条警告，退出码仍是 0；主仓库都读不了才是 1 |
| `find <词>` | `[--name] [--in <checkout 或 all>] [--local] [--limit 200]` | `matches[{relPath, checkouts[], sameContent, line, text}]`、`truncated` | 不写 | 没有命中也是 0（`matches: []`）；不沿用 grep 用 1 表示无命中的习惯，因为 1 在这里表示失败 |
| `work new <slug>` | `[--title] [--local] [--issue <n>] [--task <slug>]` | `{workId, kind, path, task?: {taskId, path}, conflicts[]}` | `registry.json`；仓库 Work 在主工作区新建 `.agents/works/<id>/README.md`（规则要求同时建首个 Task，所以 `--task` 会一并建 `tasks/t01-…/README.md`）；本地 Work 建在 `.local/agent/works/<id>/` | slug 不合规是 2；目标路径已存在是 3；主工作区不在 `master` 是 3；取锁超时是 1 |
| `task new <workId> <slug>` | `[--in <checkout>]`，默认 Work 的 `home`，没有就取第三节选出的当前快照 | `{taskId, path, checkout, conflicts[]}` | `registry.json`；在目标 checkout 里新建 Task 的 README。不改 Work README 里的 Task 表，由 Agent 自己补 | t99 用完是 3；Work 不存在是 5；目标 checkout 里没有这个 Work 目录是 3 |
| `worktree new <workId>` | `[--task <taskId>] [--purpose code 或 drafts 或 review] [--from <rev>] [--branch <名>] [--install]` | `{path, branch, from, copied[], installed, logPath}` | `.git` 里的 worktree 与分支；新 worktree 里复制未提交的占号 README（规则第 4 步）；登记表的 `home`；安装依赖的日志 | 路径或分支已被占是 3，不改名；`bun install` 失败是 1，但保留 worktree，`installed: false` |
| `dev start` | `[--checkout] [--package packages/neuro-book] [--script dev] [--work --task] [--new] [--ready-pattern <正则>] [--ready-timeout 120]` | `{runId, url, ports[], logPath, reused}` | `run/<runId>.json`；日志写到 Task 的 `logs/`，没有 Task 时写 `.local/agent/logs/` | 同一 checkout 已有服务时直接返回它，退出码 0；等就绪超时是 4，但进程照留，输出日志路径；子进程启动即退出是 1 |
| `dev status` | `[--checkout] [--wait-ready]` | `runs[]` | 不写 | 无 |
| `dev stop` | `<runId>` 或 `--checkout <路径>`，`[--force]` | `{stopped[], skipped[{runId, reason}]}` | 给登记补上 `endedAt` | 找不到是 5；属于别的在世会话、又没加 `--force` 是 3；PID 与 `procStart` 对不上（已复用）时只标结束，不发信号 |
| `page publish <workId> <taskId> <pageId>` | `[--entry <路径>] [--title] [--supersedes <pageId>]` | `{version, url, path, questions[], warnings[]}` | `review/.pages/<pageId>/v<N>.json` | 入口文件不存在是 5；问题 id 重复是 2；页面已关闭是 3（要重开就加 `--reopen`） |
| `page close <pageId>` | `[--reason]` | `{closedAt}` | `closed-*.json` | 无 |
| `answers` | `[<workId> [<taskId> [<pageId>]]] [--mine] [--unread] [--all-versions] [--wait [--timeout]] [--ack]` | `pages[{pageId, workId, taskId, status, currentVersion, questions[{id, label, answer: {value, version, submittedAt, stale}}], note}]` | 只有加 `--ack` 时写确认文件 | 等待超时是 4；指定的页面不存在是 5 |
| `shot` | `--checkout`、`--work --task`，其余参数原样交给目标 checkout 的 `lab:shot` | `{outDir, files[], report, exitCode}` | `shots/<UTC 时间>/` | 该 checkout 没有在跑的开发服务是 3，并提示先 `dev start`；`lab:shot` 本身失败是 1 |

逐条说明（推断）：

- **L6 `dev start` 只在前台监管**：
  - 命令行不让服务脱离会话。Agent 用自己的原生后台机制运行它：Claude Code 用 `run_in_background`，omp 用 `proc://`。这样开发服务随会话退出，符合全局规则“后台进程默认随会话退出”。
  - 子进程的 stdout 和 stderr **直接接到日志文件**，不经过命令行的管道。否则命令行一退出，子进程写日志就会 BrokenPipe（全局规则）。
  - 就绪以后打印一行 `READY <url>`，方便 Agent 用 until 循环或 Monitor 捕获。
  - 就绪的特征各分支不同：w00017 分支打印 `[dev] page-ready <url>`；`master` 的旧应用走 `scripts/cli/source-dev.ts`，打印的格式不同。所以 `--ready-pattern` 可以配置，认不出来就返回“已启动、地址未知”，并给出日志路径。（现状加推断）
  - 开发者明确要求服务活过会话时，才用 `--detach`，按全局规则改走 `systemd-run --user`。这个放第二版。
- **L7 `dev stop`**：按登记的 PID 与 `procStart` 核对之后，先给进程组发 SIGTERM，10 秒后再发 SIGKILL。不用 `pkill -f`。没有登记的进程一律不碰，只列出 PID 交给人处理。
- **L8 `shot` 只是薄包装**：`master` 和 w00017 分支各有自己的 `lab:shot`，实现不同。w00017 分支的版本已经支持 `--url` 和 `--out`，默认输出到系统临时目录，而且必须用 node 运行，因为在 Bun 下 Playwright 握手会超时。（现状）所以 `shot` 只做两件事：从登记里找到这个 checkout 的地址，把 `--out` 指到 `shots/`；不另写截图逻辑。
- **L9 `worktree new` 用绝对路径调 git**：一律用 `/usr/bin/git`，以防 omp 接管 `git worktree add`（全局规则）。omp 是在 shell 层面拦截，还是连子进程里的 git 也会拦，还没实测。
- **L10 装依赖不写死代理**：`--install` 跑的是 `bun install`。命令行不写死 `prox`，而是读环境变量 `NBDEV_NET_PREFIX`（例如设成 `prox`），或者由 Agent 在外面整体加 `prox`。网络慢的时候命令要一直有输出，不要静默。

### 5.3 与现有规则的冲突

1. **worktree 命名**：
   - [Work 规则](../../../../works/README.md#创建与执行) 和 [仓库维护流程](../../../../../docs/standards/repository-workflow.md#worktree-与分支) 规定：同一个 Work 共用 `.worktree/<workId>`，分支名是 `{type}/{refs}-{slug}`；
   - 实际做法和 [design-review](../../../../skills/design-review/SKILL.md) 是按 Task 建：`.worktree/w00017-t80-settings-ui`，分支 `t80/settings-ui`；草稿 worktree 是 `.worktree/<Work 短名>-<Task>-drafts`，分支 `<Task>/drafts`；
   - w00017 的主 worktree 叫 `.worktree/w00017-runtime-foundation`，也不是完整的 workId；
   - requirements 第七节的 `worktree new <Task>` 也是按 Task。

   命令行必须二选一。（现状）
2. **omp 会话目录**：全局规则（`~/.agent/AGENTS.md`）写“会话目录放在仓库之外……不能进入工作区”；新的 [`.local/README.md`](../../../../../.local/README.md) 写 `reports/` 存放“报告原文与会话目录”。`.local/` 已被 Git 忽略，放进去不会污染提交，但两处文字矛盾，第二版的 `review start` 要以哪一处为准？（现状）
3. **包的边界**：[packages 规则](../../../../../packages/AGENTS.md) 不允许包依赖仓库根的脚本，`packages/dev-panel` 就不能导入 `scripts/ci/agent-governance-contract.ts` 里的编号正则和 `primaryCheckoutRoot`。复制一份会和 `governance:check` 不一致，所以要么加一条一致性测试，要么把命令行的核心放在 `scripts/`。（现状加推断）
4. **`governance:worktree` 的名字**：它实际运行的是 `scripts/cli/create-agent-worktree.ts`，但只报告、不创建。新的 `worktree new` 上线后容易混淆，建议以后改名。这不在本 Work 范围内。（现状）
5. **主工作区很脏**：今天主工作区有 121 项未提交改动，来自别的会话。`work new` 会在这里建 README，所以输出里要给出确切路径，提醒 Agent 提交时用路径限定。（现状）

### 需要开发者决定的问题

1. worktree 按 Work 共用（规则现在的写法），还是按 Task 建（现在的实际做法）？定了以后，Work 规则与 design-review 要同步改。
2. 命令名（占位 `nbdev`）和调用方式：每次写绝对路径，还是装一个用户级 shim？
3. 命令行的核心放 `packages/dev-panel`（需要一致性测试），还是放 `scripts/`（直接复用治理代码，但网页要依赖 nb-ui，这一层还是得放在 `packages/`）？
4. `shot` 第一版要不要做？它只省掉“找地址、指定输出目录”两步。

## 六、迁移与过渡

- **M1 首次导入登记表**：用 `nbdev registry import` 扫描四处来源，把现有的号登记为 `imported`；可以重复运行，结果不变。按今天的数据（现状）：
  - Work 用到 w00022，w00021 只在它自己的分支和主工作区的未跟踪副本里，下一个号是 w00023；
  - w00017 的 Task 用到 t81，其中 t80 和 t81 只在各自的分支上，下一个号是 t82；
  - 没有撞号。
- **M2 什么时候切换规则**（推断；先后顺序是已确认的，t02 特意把编号规则留到命令行可用之后）：
  1. 命令行合入 `master`；
  2. 跑一次导入，并与手工扫描的结果对一遍；
  3. 在同一个提交里把 Work 规则“编号分配”一节改成“经命令行领号”，Task 号同样经命令行领（已确认第 7 条）；
  4. 长期分支（w00017、w00002、w00005、w00021）下次同步 `master` 时，把新规则带过去。在 worktree 里干活的会话读的是本分支的规则，今天那些分支的 `.local/README.md` 还写着“Agent 不得读写 `.local/`”。

  过渡期间混用新旧两种做法也安全：手工建的号只要落了盘，下一次领号时的扫描就会看到。
- **M3 现有的 `.local`**：t02 已经搬完 t80、t81 和 `artifacts/`。（现状）用户区里还有 `agent-thinking/`、`fim-completion-spike/`、`temp/`、`AgentThinkingStatusMessages.md`、`ReAct.ts`，看名字像是 Agent 或实验的产物，但用户区的东西 Agent 不碰。
- **M4 会话临时目录**：`/tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/` 下有 83 个条目，共 3.0 GB。（现状）不整体搬迁；只有 Task 还要用的报告，由所属会话自己搬，例如 t02 下一步写的 t80 的 omp 审查。
- **M5 现有的 worktree**：照原样索引，不改名、不移动。导入时按目录名推算 `home`，并标 `source: heuristic`。
- **M6 正在跑、把原始输出写进仓库路径的任务**：w00005 的 ingest（PID 1991184，已跑 1 小时 26 分）正把结果写到 worktree 里 Task 目录下的 `evidences/run-med-100`。这个 worktree 的 `.agents` 已有 95,901 个未跟踪文件。（现状）它在跑的时候不要动；跑完以后，由所属会话按新规则决定搬不搬。索引不受影响，见 X6。
- **M7 没有登记的开发服务**：第一版不管理它们。第二版的运行状态里列为“未登记”（按 `/proc/*/cwd` 是否在仓库内来判断），停不停交给人。
- **M8 现有的评审板**：t80 的 `review/index.html` 是纯 HTML，没有表单、没有脚本，图片用相对路径（现状）。它会以“草稿”出现在浏览里；要进“等我处理”，得有人 `page publish`。导入时不自动补版本记录。

### 需要开发者决定的问题

1. 用户区里的 `agent-thinking/`、`fim-completion-spike/`、`temp/` 等，有没有要转成本地 Work 的？
2. 编号规则是不是随命令行合入同一个提交一起切换？长期分支要不要为此提前同步一次 `master`？

## 七、非功能

- **N1 启动与常驻**（推断）：
  - 面板服务是开发者的工具，不随任何 Agent 会话的生命周期；命令行不依赖它。
  - 有三种起法：
    1. 开发者需要时在终端或 herdr 的 pane 里起；
    2. 常驻成用户级 systemd 服务。全局规则只在开发者明确要求时才允许常驻；临时单元停了以后不能用原名再起，所以建议写一个正式的单元文件，不用 `systemd-run`；
    3. 由 Agent 用 `run_in_background` 起。这种会随会话一起退出，不适合面板。
  - 面板启动后写 `.local/agent/panel.json`，命令行据此给出页面链接。
  - 面板跑的是主工作区里的代码，而主工作区常被别的会话改动。面板记下启动时 `master` 的 HEAD，变了就提示“代码已更新，重启后生效”。
- **N2 性能**（数字是现状，在本机热缓存下测得；目标是推断）：

  | 操作 | 实测耗时 |
  |---|---|
  | 11 个 checkout 串行跑 `git status` | 0.30 秒 |
  | 计算领先落后 | 0.04 秒 |
  | 读 1,845 个 Work 与 Task README 的开头 | 0.23 秒 |
  | 12 个分支的 `ls-tree` | 0.15 秒 |
  | 跨所有 checkout 用 rg 搜 “t81” | 0.95 秒；排除 node_modules、`.git` 以后 0.14 秒 |

  目标：
  - 首页首屏：20 个 checkout 以内不超过 1 秒，冷启动不超过 3 秒；
  - 搜索：2 秒内出第一批结果，5 秒内完成，超出就截断并标 `truncated`；
  - 扩到 50 个 worktree 时，串行要 1.5 秒左右，所以要并行执行（4 到 8 路），并按 checkout 缓存：HEAD、index 的 mtime、`.agents/works` 各层目录的 mtime 都没变，就复用上次的结果。

  图片是原尺寸 PNG（t81 的截图有 67 MB），只做懒加载，第一版不生成缩略图。
- **N3 只读保证**（推断；“只写答案”是已确认）：
  - 服务端只有一个写入函数，只接受 `.local/agent/**/answers/` 下的路径：先解析 realpath，路径的任何一段是符号链接就拒绝；
  - Git 只调用白名单里的只读子命令，一律加 `--no-optional-locks`；
  - 服务端不启动任何安装或构建；
  - 测试时先建一个带 worktree 的临时仓库，跑完整个流程后，断言答案目录以外的文件哈希和 `git status` 都没变。
  - 命令行不是只读的，它写什么见 5.2 节的表。
- **N4 安全**：
  - 只监听 127.0.0.1（已确认）。
  - 另外要防两类攻击（推断）：一是 DNS 重绑定，所以要校验 `Host`；二是开发者浏览器里任何网页都能向 127.0.0.1 发 POST（CSRF），所以写操作要校验同源 `Origin`，再加一个每次启动随机生成的令牌。
  - 文件服务只覆盖各 checkout 和 `.local/agent`，拒绝 `.git/`、`.env*`、`node_modules`，并防路径穿越和符号链接逃逸。
  - 开发者在用 VS Code Remote（本机有 vscode-server 进程），可能经端口转发打开面板，所以允许的 `Host` 要能配置。（现状加推断）
  - 讲解页的脚本按受信对待（已确认），前提是 Agent 不把外部来的 HTML（Issue、PR、网页内容）不加转义地贴进页面。建议讲解页放在另一个来源里（第二个端口，用 iframe 嵌入），答案经 `postMessage` 交给面板外壳。这样页面脚本出了错也调用不到文件接口。现在做成本小，以后再改就难了。
- **N5 平台**：进程登记要用 `/proc`、`ss`，只能在 Linux 上跑；登记表和答案的格式本身不依赖平台。仓库的其它部分支持 Windows。
- **N6 测试**（推断，按 [测试规范](../../../../../docs/testing/README.md) 的通用包合同：`bun test`、L1 到 L4 分层、临时根用测试支持包）：
  - L1：编号解析、状态推导、路径守卫；
  - L2：用临时 Git 仓库测领号与扫描，仓库里要有 worktree、未跟踪的占号副本、只在分支上的 Work、远程跟踪引用；并发测试同时起 10 个进程领号，断言号各不相同、登记表仍是合法 JSON；读答案的一方永远读不到半个文件；
  - L3：命令行合同，即 JSON 的 schema 与退出码；
  - L4：用一个会打印就绪行的假开发脚本，测 `dev start` 和 `dev stop`；把 `procStart` 写成旧值，模拟 PID 复用；
  - 服务端：只读测试，加上 Host、Origin、令牌、路径穿越的安全测试；
  - 界面按 [UI 验收分档](../../../../../docs/testing/README.md#ui-验收分档) 的“普通 UI 改动”取证。
- **N7 保留与清理**：`.local/agent` 只用了一天就有 95 MB（现状）。不自动删除；面板按 Work 显示占用；清理只在开发者要求时做。

### 需要开发者决定的问题

1. 面板服务怎么起：需要时手动起，还是常驻成用户级 systemd 服务？
2. 讲解页要不要放在另一个来源（第二个端口加 iframe）？
3. 面板是否只支持 Linux？
4. `.local/agent` 要不要定一个保留策略，例如分支合入以后提示清理？

## 八、参照

- **VS Code 多根工作区**：值得借鉴的是每个根都带清楚的标签；要避开的是它不处理重复。我们的 worktree 彼此是同一棵树的副本，同一路径、同一内容的结果必须合并（X7）。
- **GitHub Projects**：状态汇总之所以可靠，是因为字段是结构化的。这印证了“Task 状态先不解析”：真要汇总，就给 frontmatter 加字段，不要从正文里猜。
- **GitHub 评审的 Outdated 标记**：代码改了以后，评审意见仍挂在旧 diff 上，标为过期但不删除。答案对页面版本照此处理（A6、A7）。
- **Backstage 的软件目录**：描述文件留在各仓库里，目录只是可以随时重建的缓存。这和“面板是索引、不是存储”一致；它的插件平台加数据库太重，是要避开的方向。
- **herdr**（本机在用）：它已经跟踪各 Agent 会话（种类、会话 id、working／idle／blocked、pane），能管理 worktree 工作区，能给 Agent 发提示。面板不要再造一套 Agent 状态跟踪：第二版的运行状态可以直接读 `herdr agent list` 的 JSON，推送通道见 A4。
- **按 worktree 绑定 Agent 的编排工具**：这类工具按 cwd 归属会话，在这里行不通，因为本仓的会话 cwd 都是主仓库根（现状）。归属只能靠命令行记下的身份（L4）。

### 需要开发者决定的问题

无。

## 九、风险与建议

### 容易做大、做重的地方

1. **讲解页平台**：
   - 要在运行时编译 `.vue`，就得有一条 Vite 管线；
   - `master` 与 w00017 分支上的 `packages/nb-ui` 差了 195 个文件（增 4,111 行、删 17,357 行），`master` 的版本还是 Nuxt 模块（现状）；
   - 面板在 `master` 上，依赖的是 `master` 的 nb-ui；可讲解页多半由 w00017 分支上的 Agent 来写，它们熟悉的是分支上的 nb-ui；w00017 合入以后，面板也要跟着移植。

   建议分阶段，不改变已确认的范围：
   - 第一版：讲解页只支持 HTML，加一套小的表单约定（例如 `data-nb-question` 属性和面板提供的一段脚本），配上面板自带的样式；现有评审板本来就是纯 HTML，已经够用；
   - w00017 合入以后：再提供 Vue 与 nb-ui 讲解组件。
2. **“等我处理”的来源**：t03 的首页排序把“待定的决定、待批准的回写建议、审查报告里没处理的条目”放在第一位，但这些都要从正文里解析，和“Task 状态先不解析”相矛盾。建议第一版只列已发布、还没答复的讲解页：Agent 把要拍板的决定发成决定卡页面，把审查报告发成每条一题的页面（场景 4 也由此实现），面板不去解析报告。
3. **`shot`、`review start` 包装过头**：两者都只该是现有脚本和全局规则的薄包装，不要重新实现截图或 omp 的启动逻辑。
4. **运行状态里的“子代理”**：观察不到（D10），不要为此造一套登记机制。

### 可能变成第二个真相源的地方

1. **登记表**：只存领号的事实；标题和进度读 README，执行位置现算，`home` 只当提示，见 1.2 节。
2. **答案与决定**：决定只认 Task README（已确认）；提醒手段见 A10。
3. **Work README 里的“执行位置”一行**：规则要求在主工作区的占号副本里写明执行位置。有了扫描和 `home` 以后，这行字和登记表是两份记录，迟早不一致。建议命令行可用以后，把这一行改为可选；或者反过来，以 README 为准，登记表不存 `home`。
4. **进程登记**：只有 PID 与 `procStart` 都对得上，才认为进程活着，不信登记文件本身（D8）。

### 事实更正与规则冲突

1. requirements 第八节第 5 条说放进 `packages/dev-panel` 会被 Bun 工作区“自动收进来”，这不对：根 `package.json` 的 `workspaces` 是逐项列出的，`master` 上 15 项（现状）。两个位置选项都要登记（`workspaces`、[`docs/modules/monorepo-boundaries.md`](../../../../../docs/modules/monorepo-boundaries.md)、`packages/AGENTS.md` 里的包清单），两个选项的差别比原文写的小。另外，w00017 分支也改过这个列表（删了 `neuro-book-manager`，加了 `nb-runtime`、`neuro-book-legacy`），两边合并时会冲突。
2. worktree 命名、omp 会话目录、包的边界：见 5.3 节。
3. Task 号两位封顶：见 D4。

### 需要开发者决定的问题

1. 讲解页第一版只支持 HTML，等 w00017 合入以后再做 Vue 与 nb-ui 组件，可以吗？
2. 第一版的“等我处理”是不是只列已发布、未答复的讲解页？决定和审查条目都由 Agent 发成页面，不解析正文。
3. omp 会话目录放 `.local/agent/…/reports/`（新规则）还是放在仓库之外（全局规则）？定了以后改另一处的文字。
4. Work README 里的“执行位置”一行，命令行可用以后还保留吗？与登记表的 `home` 二选一，以哪一个为准？
5. 位置选项改用正确的说法（两者都要登记 `workspaces`）以后，仍然选 `packages/dev-panel` 吗？
