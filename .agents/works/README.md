# Agent Works

`.agents/works/` 是 current Work 与 Task 的唯一入口。Work 是 current Task 的强制容器；一个 Work 包含一个或多个 Task，并可通过 `issueId` 引用零或一个 GitHub Issue。Proposal 独立存在，可被多个 Work 引用。

## 目录与身份

```text
.agents/works/
└── w00001-work-title/
    ├── README.md
    └── tasks/
        └── t01-task-title/
            ├── README.md
            ├── artifacts/<name>/   # 产物（可选）：index.html 是入口，各轮放 r1/、r2/…，答复放 answers/
            ├── walkthroughs/       # 可选
            └── evidences/          # 可选
```

- Work 目录使用 `w`、五位非零序号和 kebab-case 名称，例如 `w00001-work-title`。
- Work README 使用 `schema: nbook.work/v1`，`workId` 与目录一致，`issueId` 为 `i<正整数>` 或 `null`。
- Task 目录在所属 Work 内使用 `t`、非零序号和 kebab-case 名称，例如 `t01-task-title`。序号 01 到 99 写两位，100 起写三位（例如 `t100-task-title`）；三位序号不带前导零。
- Task README 使用 `schema: nbook.task/v2`，`taskId` 与目录一致，不指定正式角色。
- Work 与 Task 的 frontmatter 写 `status`。Task 取 `planned`（计划中）、`active`（进行中）、`done`（已完成）、`shelved`（已搁置），Work 取后三种。“等开发者答复”不是状态，由未答的提问现算。2026-10-12 以前建的记录没有这个字段，下次更新时补上；治理检查暂不校验取值。frontmatter 可另写 `updated: YYYY-MM-DD`（最近一次改记录的本机本地日期）：`nbdev` 写记录时自动更新，直接编辑记录时顺手改；没有这个字段时，面板与 `nbdev status` 退回最后一次提交的日期。
- Task 不保存 `role`、`actionIssueId`、`agentWorkflow`、`kind`、`worktreeId` 或 `branchId`。治理只校验身份、容器和退役字段；`status` 供面板与命令行汇总，正文是协作参考，都不是权限门禁。
- `.agents`、`.agents/works`、Work、`tasks` 与 Task 五级 current 路径必须由真实目录项组成；symlink/junction 不形成 Work/Task identity，`governance:check` 与 `governance:context` 都明确拒绝。

## 编号分配与记录位置

### 记录只放主工作区

Work 与 Task 的记录（README、`artifacts/`、`walkthroughs/`、`evidences/`）只放主工作区 `master` 的 `.agents/works/`，只有这一份。Agent 会话是临时的，记录是持久的：任何会话都从这里读到目标、状态、决定、产物与答复，不依赖当初写它的会话还在。

- 在实现 worktree 里工作时，读写主工作区里的记录（`<主工作区>/.agents/works/<workId>/…`），在主工作区用路径限定提交（`git commit -- <路径>`；主工作区的暂存区里常有别人的改动）。
- 实现分支只带代码、测试与组件文档的改动，不改 `.agents/works/` 下的 Work 目录，也不改 `docs/specs/`、`docs/proposals/`（Spec、提案与 Task 记录都在主工作区的 `master` 上更新，与根 `AGENTS.md` 一致，开发者 2026-10-29 定）；worktree 里这些目录是分出时的旧副本，不读不改。本目录的 `README.md`、`AGENTS.md` 是治理规则，不是记录，按治理文档的流程修改。`governance:context` 默认读它所在 checkout，在 worktree 里查记录时加 `--repo-root <主工作区>`。
- 本节 2026-10-12 起生效。已在实现分支上维护记录的 Work，迁到主工作区之前照旧在原处维护，迁移见 [w00022 的 t05](w00022-dev-panel/tasks/t05-migrate-records/README.md)；这类 Work 新建 Task 也一律经 `nbdev task new` 写进 `master`，不在分支上建。

### 编号分配

Work 的五位序号在项目内唯一，名称不同也不能复用同一序号；Task 序号在所属 Work 内唯一。新编号经命令行 `nbdev` 领取（[命令行合同](../../packages/dev-panel/docs/cli.md)），各会话不自己选“下一个编号”。

1. 先复用符合目标的 Work。确需新编号时用 `nbdev work new`（Work 与首个 Task 一起建）或 `nbdev task new`：它在主工作区的锁里扫描主工作区、登记表、全部本地与远程跟踪分支和各 worktree，取最大值加一，建最小 README，并在 `master` 上路径限定提交。领号即占号，不要求 Issue 编号、push 或远端登记；保护已有文件，不因登记授予远端权限。
2. `nbdev` 不在 PATH 上时，用 `bun <主工作区>/packages/dev-panel/src/cli.ts …` 调同一入口；仍不可用才手工建号：按上面同样的来源取最大值加一，在主工作区建记录并提交，下次 `nbdev` 扫描会补登并给出警告。
3. 改 Work 或 Task 的状态用 `nbdev work status`、`nbdev task status`：只改 `status` 与 `updated` 两行并提交；目标文件有别人未提交的改动时默认拒绝。

`nbdev` 发现同一序号有两个名称（撞号）时照常发号，在输出的 `conflicts` 里列出各处位置，不自动改名。处理撞号时先暂停冲突身份的集成，由开发者或主 Agent 确定保留项，并为另一项领一个新号。同步修改 Work 目录、`workId`、当前引用及关联执行路径，再用 `governance:context` 核对实际身份；Task 的局部序号无需因 Work 改号改变。已发布的历史记录保留原始身份，在当前记录中说明映射。已提交或推送的内容通过后续提交修正，不覆盖另一项工作，不为改号重写历史或强制推送。只在改名或删除后留下的旧副本里的撞号（`live: false`，常见于改号之前开出的分支）不用处理：改不动那些分支的历史，`nbdev status` 与收件箱也不提它们，要查时看 `--json` 的 `conflicts`。

`nbdev` 只在本机加锁，不是跨机器的编号服务；治理检查通过不能代替领号。现有冲突按上述方式处理。

## 本地与入库

一件东西进 Git，当且仅当它会约束之后的人或 Agent 的行为、开发者或之后的会话要看它，或者丢了就无法重现：

| 进 Git | 留本地（`.local/agent/works/<workId>/tasks/<taskId>/`） |
|---|---|
| 代码、测试、脚本与配置 | 能重新生成的：构建产物、测试与检查的原始输出、日志、完整截图集 |
| Spec、ADR、Proposal、规范与 Skill | 子代理与 omp 的会话目录与原始输出 |
| Work 与 Task 的目标、范围、授权、状态、决定，验证结论（跑了什么、多少通过、失败原文） | 大体量数据 |
| 产物（设计稿、讲解与报告、审查报告）与开发者的答复，放 Task 的 `artifacts/` | |
| 证据：不可重现且必须保留的原始数据（例如一次性测量的数值）、少量精选截图，放 `evidences/` | |

- **决定以文字入库**：答复是讨论记录；开发者的决定由 Agent 摘成文字写进 Task README。
- **答复只追加**：写进对应产物的 `answers/`，不改已有的答复。
- **证据不覆盖**：写证据前先看 `evidences/` 里有没有同名文件；同一 Task 有多轮审查时，文件名带上轮次或对象（例如 `impl-review-redesign-omp.txt`），已入库的旧证据不改。
- **图片有体积上限**：入库的图片（产物引用的图与证据截图）单张约 300 KB 以内，每个 Task 合计约 5 MB 以内；超出时转成 WebP 或缩小，原图留在本地 `shots/`。能用 HTML 直接表达的不截图。
- **富内容经 nbdev 交给开发者**：会话窗口适合纯文字的交流。要给开发者看图片、并排比较、长报告、复杂表格这类富内容时，做成 Task 的产物（待定的设计问题用 `design`，交付、讲解与报告用 `report`），用 `nbdev artifact publish` 汇总发布，回复里写要点并指向产物；不在回复里列本地路径让开发者自己去项目目录里找。
- **已入库的不动**：历史里的文件删了也不会让仓库变小，不为瘦身删除已入库的证据或改写历史；本规则从 2026-10-12 起对新内容生效。

## 创建与执行

主 Agent 按当前已知结果创建 Work 与至少一个可执行 Task，可直接执行或按独立边界委派。开发者确认要做、还没开工的后续工作可以先建 Task 防止遗忘：快照写目标、来源、已知范围与前置，标明未开工；开工时按当时的结果修订范围再写计划。不为依赖未知结果的设想预建 Task 链。非平凡 Task 的实施计划按 [implementation-planning](../skills/implementation-planning/SKILL.md) 写在 Task 目录的 `plan.md`，开发者确认后再实施；Task README 只链接计划并记录进展。CLI 使用 `--work <workId>`，需要具体 Task 时追加 `--task <taskId>`；`governance:context` 输出 `nbook.governance-context/v2`，不再接受 `--role` 或返回角色字段。

代码改动通常一个 Work 一条分支、一个 worktree：从本地 `master` 创建 `.worktree/<Work 编号>-<短名>`，branch 为 `{type}/{Work 编号}-{slug}`，例如 `.worktree/w00027-plugin-platform` 与 `feat/w00027-plugin-platform`，Work README 写明这条分支。各个 Task 在这条分支上提交，验证也在这条分支上做，不为验证先合入 `master`。同一 Work 里多个 Agent 并行、改动会冲突时，才基于 Work 分支另开 Task 级 worktree（`.worktree/<Work 编号>-<Task 编号>-<短名>`），做完合回 Work 分支；何时同分支、何时另开见 [仓库维护流程](../../docs/standards/repository-workflow.md#worktree-与分支)。恢复时在 worktree 里运行 `governance:context` 记录实际 worktree 与 branch；路径已属于其它仓库、Work 或不匹配 branch 时报告冲突并停止，不覆盖或另建第二身份。执行位置写在 Task README 正文，不写入 frontmatter。

Work README 开头写“目标”一节。Task README 只保留当前快照：目标／范围与非目标、当前状态、授权来源与限制、下一步或阻塞、合同与有效证据链接；状态取值写在 frontmatter，正文写具体情况。长期行为在 Spec／组件文档，Work 保存总体目标、范围与授权，Task 引用而不复制。

状态变化时替换已失效快照，不在底部不断追加“当前状态”。交给开发者看的页面进 `artifacts/`，需要恢复的决策或历程按需进入 `walkthroughs/`，不可替代的原始证据才进入 `evidences/`，其余按上文“本地与入库”留在本地；小改动不强制建文件或空目录。恢复先读快照，历史仅按问题读取；旧证据与旧授权不能冒充当前状态。

膨胀的 current Task 在其 owner 可协调的恢复点渐进整理：把失效叙事移入已有 walkthrough，保留日期、授权和失败记录，README 留最新快照与链接。不批量整理无关 Task，不回填历史验证结果。

旧 `.agents/tasks/` 与包级 `.agents/tasks/` 只保存 legacy `nbook.task/v1` provenance，不接收 `nbook.task/v2`。历史名称、worktree、branch、PR 与 Task 不迁移。

## 收尾与清理

- Work 分支（及其全部 Task）合入 `master` 后，把 Work 的 `status` 改为 `done`，并在正文记一行：`已收尾：<master 上的合入提交号>；待清理：<worktree 路径>、<branch>`；未全部合入时不写，改在快照里继续。
- `governance:worktree` 报告的 `cleanup: "待清理"` 是清单来源：分支已是 `master` 祖先的 worktree 会被标记（判定为 `git merge-base --is-ancestor <branch> refs/heads/master`）；报告只读，不执行删除。
- 清理 worktree 与分支是受限动作：需开发者明确授权，且只清理 Work README 清单内的项；删除前逐项确认没有未提交改动；清单外的 worktree 一律保留并报告。
