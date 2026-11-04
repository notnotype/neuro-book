---
schema: nbook.task/v2
taskId: t12-builtin-tools
status: active
updated: 2026-11-04
---

# 基础工具与外部命令行依赖

## 目标与范围

定第一批内置工具清单与语义（读写、搜索、bash、网页、待办、提问），bash 与记账和只读模式的关系，以及 rg、git、uv 等外部命令行的依赖策略。

来源：需求 10、15（[报告](../t01-survey/artifacts/report/index.html)）。

合同：本 Task 只做设计讨论，行为合同未变；定稿后在计划里写明改哪些 Spec。

## 要讨论的问题

- 第一批清单：现有 read、edit，加 write、grep、glob、bash、网页搜索与读取、待办、提问；以 omp 为基础、参考 Claude Code。
- 工具经资源地址读写（t08）。
- bash 会绕过 nb-history 记账与只读模式，怎样处理。
- 外部命令行（rg、git、gh、python、uv、jq 等）：安装时装、首次用到时检测还是随应用带；Windows。

## 材料

- [外部参照](../../../../../docs/research/agent-runtime-references.md)第 2、5 节
- [`workspace/resources.md`](../../../../../docs/specs/workspace/resources.md)
- [文件工具四种模式的调研](../../../w00002-neuro-agent-harness-redesign/research/2026-09-18-file-tools-four-modes-design.md)

## 前置

t04、t06、t08。

## 决定（开发者 2026-10-28）

事实见[外部参照](../../../../../docs/research/agent-runtime-references.md)“shell 工具、执行时限与后台任务”一节：`pi-natives` 自带原生 `grep`、`glob` 与内嵌的 brush shell。

开发者已定：

- 网页工具（`web_fetch`、`web_search`）不进 Agent 插件，单独做成插件；网页搜索先不做，另开 Work。
- shell 工具叫 `shell`（`builtin.shell`），同 omp。

- shell 的洞（绕过只读模式、nb-history 记不上账、绕过地址读写规则、读到密钥、被诱导往外发数据、进程失控）第一版都不补：nb-history 记不上账不补；其余几条是以后专门做安全时再考虑的事，第一版的挡板只靠只读命令白名单与 auto 模式的审批模型判断。读到密钥可以用正则拦住大部分，但各家 code agent 目前都没处理，我们也一样，以后再说。进程失控随“后台任务”讨论。
- 外部命令行的策略按 2026-10-28 会话里的表记下，本 Work 不做，发布时再做：离不开的只有 Bun 与 `pi-natives`（grep、glob、shell 都在里面），随包带；uv、git、gh、jq、python、rg 只检测、不擅自安装；目录包与桌面壳里 uv 在第一次有 Skill 需要时经用户同意下载到 `<状态根>/tools/` 并校验哈希；服务端启动时检测一次并缓存，命令不存在时再检测；系统提示词列出本机可用的命令，设置里有“外部工具”一页，Skill 声明需要的命令、缺了标不可用。

- eval（CodeAct）另开 [t21](../t21-eval-codeact/README.md) 搁置；后台任务、Agent Hub、Monitor 与 Agent 后台调用统一放进 [t22](../t22-background-work/README.md) 搁置。第一批 shell 只有前台：执行时限照 omp，缺省 300 秒、模型可设 1 到 3600 秒、不允许不限，输出过长截断、全文进 `session://artifacts/`（2026-10-28 会话里的推荐，开发者未单独否决，实施时可再调）。
- 第一批工具：`read`、`write`、`edit`（master 的五种模式，缺省 hashline，中文长段落用哪种在 t18 按模型评测）、`grep`、`glob`（都用 `pi-natives`）、`shell`（`pi-natives` 内嵌的 brush shell，工作目录 `session://`（2026-10-30 t14 改为：有主项目时 `project://`，没有时 `session://`；另加 `async` 转后台，见 [t14](../t14-multi-agent/README.md)），命令里能对应真实目录的地址替换成绝对路径，虚拟地址报错，提供 `$NBOOK_PROJECT`、`$NBOOK_SESSION`）、`todo`；`ask`、`switch_mode` 见 t06，子代理见 t14。不进第一批：ast_grep、lsp、eval、github、checkpoint/rewind、apply_patch。内置工具经资源地址读写（t08）；说明用中文，失败在 `details` 给 `code`，`pi-natives` 原生 edit 的英文错误原样（ADR 0034）。

### 补充决定（开发者 2026-11-02）

- `shell` 原样继承服务端进程的环境变量，不剔除模型密钥一类的变量：别的 code agent 都这样做，不处理。

### 开工前对齐（开发者 2026-11-02）

t08 之后重新对齐需求：

1. `read`、`edit` 先不针对长篇中文正文专门设计，用 LLM 最熟悉的 code agent 默认做法；以后有时间再优化。
2. t12 只交工具：审批接线（按 t08 的分类决定写入要不要问、`shell` 的只读白名单怎样参与审批）不在本 Task。
3. `write` 照 code agent 的做法，自动建上级目录。
4. `read` 能读图片，照 omp 的做法。
5. `edit` 首批只开 hashline 与 replace 两种模式。
6. `todo` 要先设计：调研 omp、Codex、Claude Code 各有哪些工具、参数与交回给模型的结果，再定。
7. 先不改 nb-agent-ui 的内置工具渲染器（它按旧应用的工具名写）。
8. `todo` 与 Claude Code 一样默认关闭（Codex 2026-08、Claude Code 2.1.233 起都对较新的模型默认不提供，见 [调研](research/todo-tools.md)）：它现在主要是让用户知道 Agent 在做什么。
9. 要做 omp 与 Claude Code 那种隔 N 轮没更新清单就提醒的机制。
10. 工具声明的 token 数（[脚本](experiments/todo-tokens.py)，[结果](evidences/todo-tokens.txt)，o200k）：omp `todo` 472，Claude Code `Task*` 四个合计 2,033，`TodoWrite` 2,152，Codex `update_plan` 186；DeepSeek-V3 分词结果相差不到 2%。只量工具声明，不含各家主提示词里关于待办的段落与提醒。
11. `todo` 暂定照 omp 的做法：一个工具、`op` 切换操作，交回的结果也照 omp（剩余项加整份清单）。`todo` 本 Task 先不做，搁置；第 8、9 条随它一起做。

第一批因此是 `read`（能读图片）、`write`（自动建上级目录）、`edit`（hashline 与 replace）、`grep`、`glob`、`shell`。

### 第一轮设计审查后的决定（开发者 2026-11-02）

12. `edit` 不加“冻结基线”的护栏：别的 code agent 都没有；写回前取一次当前基线即可。
13. 用户自己建的符号链接，目标当作书里的文件：文件工具取真实路径后直接读，顺着链接读到目标，不另做根内核对。文件服务对编辑器与文件树仍按 `outside-root` 拒绝根外链接，改成同样跟随链接另开 Task（nbook.files，不在本 Task）。
14. （被第 15 条取代）读用文件服务交出的绝对路径在本机读；写仍经文件服务。

### 文件访问的架构讨论（开发者 2026-11-02）

讨论 t12 的读写时发现，nbook.files 的读写接口是照“浏览器经 RPC 编辑一个文档”设计的（一次交整份文本、约 960 KiB 上限、不能读写字节），服务端使用方（作品统计、Agent 工具、以后的图生文插件）都用不上，作品统计已经自己绕开。开发者提出换思路：

15. 不再让 nbook.files 劫持所有文件访问（不现实），改为照 git 的思路记账：各方（Agent、用户经网页、插件）在服务端经一个共享接口直接读写文件，接口在写入时算出改动并连同操作者交给账本；不经接口的外部改动（shell、外部编辑器、git）由文件监视发现，账本用保存的上一版算出改动。读写文件的需求只在服务端。
16. 写入的顺序：在文件锁里读改前值、写临时文件、算改动、把记录交给账本并等确认、改名替换，再放锁。记录不挪到锁外：先实测本机 RPC 的延迟，可以接受就这样做（最干净）；不行再考虑锁外异步加序号。实测（2026-11-02，本机 Linux，真实项目子进程，服务端经 `{project}` 目标调 `nbook.files/project` 的 `realPath`，空载荷，500 次 × 3 轮）：p50 0.30–0.38 ms，p90 0.70–0.75 ms，p99 1.9–2.4 ms，最大 3.6–4.6 ms。可以接受，按锁内同步做；记录带上改动内容后载荷会变大，实施时再测一次。
17. 改名照 git：经接口的改名记为改名，外部改名记为删除加新建，看时间线时按内容相似度接起来。
18. 二进制照 git：只记“已更改”加前后哈希与大小。
19. nb-history 已经实现了这套账本的大半（代写并记账、观察型记账、对账、时间线、diff、恢复、收件箱、会话未见变更），但还没接进新应用，且只支持单进程单写者。是在它上面继续做，还是复用 git 或别的成熟实现，等调研（git 的做法、复用 git 或其组件、开源库、文件监视；Web 的文件资源管理器要能实时看到变化）再定。

20. 第 16 条的写入顺序被取代。提案第一稿经第一轮深入审查（omp、Opus、Sonnet，报告见 `evidences/proposal-review-*.txt`）后，三份 Sonnet 评估比较了写入方案 A（写入方自己写盘、先改名后记账）、B（写入方暂存、拥有根的进程提交）与开发者提出的 C（照 git，监视发现、账本提交、写入方只认领），并调研了 VS Code 的保存方式（`research/vscode-save.md`、`evidences/write-model-*.txt`）。开发者定用 B+：写入方把新内容写进暂存文件，拥有根的进程在锁里核对期望、读改前内容（中间有外部改动先补记）、改名、记账、发事件；文件监视只检测哪些路径变了，回声按 inode、修改时间与大小认；外部改动由记账在文件安静后读一次；记账是软依赖。
21. Agent 用 `shell` 改的文件归给该会话、标“推断（shell）”。
22. 提案按 B+ 重写（`b0e2dffa2`），第二轮深入审查改为宏观整体审查（第一轮已做细节）：omp 会话审架构，Sonnet 审接口与插件作者的整体体验。

23. 第二轮审查（宏观，[处理](evidences/proposal-review-r2-disposition.md)）后开发者按推荐定了五件事：
    - 分阶段交付：第一阶段只做写入接口（读路径、暂存提交、文件操作），不接 History，解锁 t12；第二阶段监视可靠性与根的归属；第三阶段接 History（t13：收件箱、恢复、分组）；第四阶段大文件、同步盘与平台；
    - 同一本书被两个 NeuroBook 打开：后开的照常写、不记账，先开的把它的写入记为外部，界面提示操作者不会被记下；
    - `history.sqlite` 是作品数据、随书走，只支持单设备：关闭时并回预写日志，换机器后对不上的记为外部，同步盘的冲突副本不读只写诊断，不做账本合并；
    - 单个版本 32 MB 以内存全量可恢复，超过只记哈希与大小，时间线标明不能恢复，总体积由保留策略控制；
    - shell 推断的改动不进“全部还原”，单独成组、用平常话说明，逐个还原。

这次改动牵涉已接受的 [项目文件底座提案](../../../../../docs/proposals/project-file-foundation.md)（“读写都经文件服务”）、`workspace/resources.md` 与 t08 刚做完的服务端文件服务，定稿后要写提案或追加决策记录。t12 的计划在这之后再定。

## 第二轮设计审查后的决定（开发者 2026-11-04）

24. 搜索不进根下面的目录链接，搜索根本身可以是链接：Claude Code、omp、opencode、Gemini CLI 的搜索工具都不跟随，以后要跟随只是新增行为（[处理](evidences/design-review-r2-disposition.md)）。
25. 不合法的正则不报错，按原生行为按字面搜或得到零条，写进工具说明；不设 `invalid-pattern`。
26. `edit` 不新建文件，目标不存在报 `not-found` 并提示用 `write`。

## 当前状态

切片 0–7 都已完成：Spec 在 master，其余在分支 `feat/w00032-t12-builtin-tools`（worktree `.worktree/w00032-t12-builtin-tools`），没有开发者允许不合并。[收口验证](evidences/closing-verification.txt)通过，真实模型 smoke（DeepSeek）通过。实现审查（omp）进行中。

实施中对计划的两处小改：`grep` 的搜索根也可以是文件（模型常这样用，Spec 已改）；`read` 的图片超过 500 KiB 时转 JPEG（图片随日志留在会话里、每次请求都发，上限取 omp 的做法）。

## 下一步

处理实现审查的结论 → 向开发者汇报，等合并的允许。
