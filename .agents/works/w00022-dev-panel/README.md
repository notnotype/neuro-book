---
schema: nbook.work/v1
workId: w00022-dev-panel
issueId: null
status: active
---

# 开发者项目面板与本地／入库边界

## 目标

做一个本地的开发者项目面板（网页，开发者用）与命令行 `nbdev`（Agent 用），把散落在各分支、worktree 与本地目录里的 Work、Task、产物、文档与 Agent 会话收在一处：开发者在面板上看各 Work 的目标与 Task 状态、看产物并答复、经 herdr 接管或通知会话；任何 Agent 经命令行新建 Work 与 Task、发布产物、读答复。项目数据持久入库，会话与租约是临时的。

## 当前结论与授权

2026-10-12 开发者在 t80（设置界面）的评审中提出：worktree、分支、`.agents` 的 Work 与 Task、`.local`、Issue、PR、界面设计稿、文档太散、太多，难以管理；希望有一个项目管理面板把它们收在一起，并作为 Agent 与开发者之间除会话窗口外的第二条沟通通道（Agent 用网页讲解，开发者在面板上填表、审查，回到会话说“填好了”）。

开发者已定：

1. 面板是独立的本地开发工具，放在 `master` 上，不做成 NeuroBook 插件；后定为 `packages/dev-panel`（见 t03）。
2. 本 Work 同时重新划定“哪些留在本地、哪些进 Git”：之前全部进 Git，后来引入 `.local/`，这次再优化一轮。
3. 先做需求分析与功能分析，再定方案。
4. 开发者用网页，Agent 用命令行；Work 与 Task 编号会撞的问题借这个工具一起解决。

记录在主工作区维护（[记录只放主工作区](../README.md#记录只放主工作区)）；进入实现时每个 Task 从 `master` 建自己的 worktree。

## 实施

按 [Proposal](../../../docs/proposals/dev-panel.md)（2026-10-12 `accepted`）与 [实施计划](tasks/t03-design/plan.md) 推进。开发者 2026-10-12 指定开发者不在场时按 autonomous-delivery 的循环推进（计划、opus 子代理设计审查、实施、opus 子代理实现审查不阻塞、下一个 Task），本该开发者确认的点记入 [待确认清单](pending-confirmations.md)，事后追认。

- 实现 Task 严格先后依赖，共用一条集成分支 `feat/w00022-dev-panel`（worktree `.worktree/w00022-dev-panel`，从 `master` 分出）；互相独立的切片另开 worktree，再合回集成分支。
- 集成分支每次提交后 push 到 `origin` 作备份；合入 `master` 要开发者授权。
- 2026-10-13 漏出一次：t14 开工时集成分支快进到了 `master`（`16da3544b`），带进了下一条说的含账户名的历史；主 Agent 10:28、11:49 两次 push 前没查，这段历史随分支进了公开仓库。开发者定先删远端分支，13:50 已删，远端已没有分支含 `8065e1aa2`。这些提交在 GitHub 上仍可按提交号访问，直到 GitHub 回收；要彻底清掉，得由开发者向 GitHub 支持申请。此后集成分支不再 push，直到历史洗过；push 任何分支前先查 `git merge-base --is-ancestor 8065e1aa2 <分支>`。
- 主会话调度，编码交给 opus 子代理；主会话审查 diff、自跑验证。
- **push `master` 之前必做**（开发者 2026-10-13 定）：本地 `master` 从 `8065e1aa2`（2026-10-12 23:58）起的历史里有本机另外两个账户的用户名，出现在 t09、t10 的几份记录与审查报告里；当前版本已删，历史里还在。push `master` 之前，按[仓库维护流程](../../../docs/standards/repository-workflow.md)里“本地未推送历史含隐私”那一段重写这段历史，并按新旧对照表更新记录里引用的 `master` 提交号（例如合并提交 `7e837bd80`、`9df2f7d82`、`137be5b5a`）。查找命令：`git log -G '<用户名>' master`，用户名用 `getent passwd 1001 1002` 查。

## Task

| Task | 当前范围 |
|---|---|
| [t01](tasks/t01-requirements/README.md) | 需求分析、功能分析与本地／入库边界的现状调查；2026-10-12 开发者全部确认（其中“Work 分仓库与本地两类”后被领域模型第二版取消） |
| [t02](tasks/t02-local-vs-repo-rules/README.md) | 按 t01 的判据改规则：`.local/` 分 Agent 区与用户区、验证与截图的入库边界、`design-review` 的路径；已完成，其中本地 Work 与产物留本地两条后被 t03 改掉 |
| [t03](tasks/t03-design/README.md) | 面板与命令行的设计：领域模型第二版、三轮静态稿（首页 Work 区用卡片）、Proposal 与实施计划；2026-10-12 完成，Proposal `accepted` |
| [t04](tasks/t04-rule-followups/README.md) | 已确认的规则跟进：worktree 一个 Task 一个（已完成）、Task 号允许三位、omp 会话目录改放 `.local/agent`；2026-10-13 随集成分支合入 `master`，完成 |
| [t05](tasks/t05-migrate-records/README.md) | 把实现分支上维护的记录迁到主工作区、`.local/agent` 里的产物搬进 `artifacts/`；开发者定先只迁本会话建的，w00017 的 t80、t81 已迁，其余分支暂不动 |
| [t06](tasks/t06-cli-core/README.md) | 命令行核心：包骨架、写事务、记录读取与领号；2026-10-13 合入 `master`（`7e837bd80`），完成 |
| [t07](tasks/t07-session-leases/README.md) | 会话身份、运行归属与租约；2026-10-13 合入 `master`（`7e837bd80`），完成 |
| [t08](tasks/t08-artifacts-answers/README.md) | 产物、提问与答复（命令行）；2026-10-13 合入 `master`（`7e837bd80`），完成 |
| [t09](tasks/t09-panel-readonly/README.md) | 面板服务与只读视图；2026-10-13 实现审查修正后合入 `master`（`7e837bd80`），完成 |
| [t10](tasks/t10-panel-writes/README.md) | 面板写入：答复、新建 Work 与 Task、状态切换、编辑记录与文档；2026-10-13 实现审查修正后合入 `master`（`9df2f7d82`），完成 |
| [t11](tasks/t11-notify/README.md) | 通知、会话消息与常驻；2026-10-13 合入 `master`（`137be5b5a`），服务已装、管理脚本已合入（`66cc4d85d`），场景 1 验收通过，完成；通知误报随 t14 修正 |
| [t12](tasks/t12-web-terminal/README.md) | herdr 网页终端；2026-10-13 合入 `master`（`a9d2fac84`），开发者在场验收通过，完成 |
| [t13](tasks/t13-cross-device/README.md) | 跨设备访问；2026-10-13 写了计划后搁置：开发者定先不做 Tailscale，SSH 转发加常驻服务够用 |
| [t14](tasks/t14-runs-and-github/README.md) | 运行登记、开发服务与现场补充，含 t11 通知误报与 t12 接管尺寸的修正；2026-10-13 两轮实现审查修正后合入 `master`（`da3781d99`） |
| [t15](tasks/t15-ui-polish/README.md) | 面板界面打磨：左栏可调宽度、细滚动条、系统审查 UI、UX 与前端设计后调优；2026-10-14 阶段 1 到 4 全部合入 `master`（最后一批 `66bb8a5fe`），完成；阶段 5 推迟 |
| [t16](tasks/t16-cli-papercuts/README.md) | nbdev 命令行修补：产物只提交引用到的文件、不合规逐条列出、`answers --wait` 接 SIGHUP、`shot` 找不到组件立即失败、`--no-lease`、只报相关撞号；2026-10-15 合入 `master`（`8634c9d70`），完成 |
| [t17](tasks/t17-panel-small-fixes/README.md) | 面板小修：nb-ui 勾选框的根上修法、会话页紧凑写法（1440×650 下终端 222 到 345px）、显示租约处带会话标题；2026-10-15 合入 `master`（`8634c9d70`），完成 |
| [t18](tasks/t18-agent-self-check/README.md) | Agent 自助验收：`dev start --sample` 带样例作品、`nbdev shot --page` 与 `page:shot` 截产品页面；2026-10-15 合入 `master`（`8634c9d70`），完成 |
| [t19](tasks/t19-answer-notify-fixes/README.md) | 评审板能不选（清空的题回到没答、什么题标选答）、自动通知认带会话名的 Claude 输入框、发布后给出挂等待的命令；2026-11-02 合入 `master`（`bd8116055`），待重启 4400 |
| [t20](tasks/t20-panel-review-close-and-reading-width/README.md) | 评审题缺省选答、开发者能在面板上关闭评审（在等的会话会醒）；只在旧副本里的撞号不再进收件箱；Task 与文档页的 Markdown 加宽；左栏 Task 多的 Work 缺省收起一部分；2026-11-05 合入 `master`（`2b4f7b4f8`），待重启 4400 |
