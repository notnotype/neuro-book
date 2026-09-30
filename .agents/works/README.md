# Agent Works

`.agents/works/` 是 current Work 与 Task 的唯一入口。Work 是 current Task 的强制容器；一个 Work 包含一个或多个 Task，并可通过 `issueId` 引用零或一个 GitHub Issue。Proposal 独立存在，可被多个 Work 引用。

## 目录与身份

```text
.agents/works/
└── w00001-work-title/
    ├── README.md
    └── tasks/
        └── t01-task-title/
            └── README.md
```

- Work 目录使用 `w`、五位非零序号和 kebab-case 名称，例如 `w00001-work-title`。
- Work README 使用 `schema: nbook.work/v1`，`workId` 与目录一致，`issueId` 为 `i<正整数>` 或 `null`。
- Task 目录在所属 Work 内使用 `t`、两位非零序号和 kebab-case 名称，例如 `t01-task-title`。
- Task README 使用 `schema: nbook.task/v2`，`taskId` 与目录一致，不指定正式角色。
- Task 不保存 `role`、`actionIssueId`、`agentWorkflow`、`kind`、`worktreeId` 或 `branchId`。治理只校验身份、容器和退役字段；正文是协作参考，不是机器状态或权限门禁。
- `.agents`、`.agents/works`、Work、`tasks` 与 Task 五级 current 路径必须由真实目录项组成；symlink/junction 不形成 Work/Task identity，`governance:check` 与 `governance:context` 都明确拒绝。

## 编号分配与记录位置

Work 的五位序号在项目内唯一，名称不同也不能复用同一序号。各实现 worktree 不独立选择“下一个编号”。

1. 先复用符合目标的 Work。确需新编号时，与并行执行者明确唯一分配者，从查号到本地占号串行完成；无法确认归属时只暂停新编号分配，不阻塞已有 Work。
2. 分配者在保持 `master` 的主工作区核对已登记 Work，以及本地分支、linked worktree 中尚未合入的 Work；已占用序号不复用。多台机器也通过同一个分配者协调，不各自从本机最大值递增。
3. 在主工作区创建最小 Work README 和首个已知可执行 Task 即完成本地占号；不要求提交、Issue 编号、push 或远端 `master` 登记。保护已有文件，不因登记授予远端权限。
4. 需要隔离实现时，从已批准且具备所需源码的本地 `master` revision 创建实现 worktree。占号文件未提交时，仅复制该新 Work 的初始 README 与首个 Task；主树副本此后冻结为占号记录，Work README 指明执行位置，不回填进度。执行状态和证据只在实现 worktree 维护；登记随实现正常集成，不要求独立登记 PR 或非 squash 祖先关系。纯规划可在主树维护唯一快照。

主树占号副本只作执行位置指针，不是第二份当前快照。登记随实现合入后，集成 owner 在已获授权的主树同步中先核对这些副本确为本次创建且未被他人修改、集成结果已完整保留记录，再移除精确的占号副本并同步已集成版本；不清理整个 Work 目录或其它未提交文件。副本被修改、owner 不明或尚无同步授权时保留并报告，不用 stash/reset 或覆盖来获得干净主树。

发现两个不同 Work 撞号时，先暂停冲突身份的集成，由分配者确定保留项，并为另一项重新登记未占用编号。同步修改 Work 目录、`workId`、当前引用及关联执行路径，再用 `governance:context` 核对实际身份；Task 的局部序号无需因 Work 改号改变。已发布的历史记录保留原始身份，在当前记录中说明映射。已提交或推送的内容通过后续提交修正，不覆盖另一项工作，不为改号重写历史或强制推送。

这是协作规则，不是自动锁或跨机器编号服务；治理检查通过不能代替分配协调。规则不追溯搬迁已有 Work；现有冲突按上述方式处理。

## 创建与执行

主 Agent 按当前已知结果创建 Work 与至少一个可执行 Task，可直接执行或按独立边界委派，不预建依赖未知结果的链。CLI 使用 `--work <workId>`，需要具体 Task 时追加 `--task <taskId>`；`governance:context` 输出 `nbook.governance-context/v2`，不再接受 `--role` 或返回角色字段。

需要隔离代码改动时，同一 Work 默认共享 `.worktree/<workId>`；branch 继续使用根规则的 `{type}/{refs}-{slug}`，其中 `refs` 使用 Work 编号。恢复时运行 `governance:context` 记录实际 worktree 与 branch；默认路径已属于其它仓库、Work 或不匹配 branch 时报告冲突并停止，不覆盖或另建第二身份。执行身份不写入 Work/Task frontmatter。

Task README 只保留当前快照：目标／范围与非目标、当前状态、授权来源与限制、下一步或阻塞、合同与有效证据链接；不强制固定标题或新状态字段。长期行为在 Spec／组件文档，Work 保存总体范围与授权，Task 引用而不复制。

状态变化时替换已失效快照，不在底部不断追加“当前状态”。需要恢复的决策或历程按需进入 `walkthroughs/`，不可替代的原始证据才进入 `evidences/`；小改动不强制建文件或空目录。恢复先读快照，历史仅按问题读取；旧证据与旧授权不能冒充当前状态。

膨胀的 current Task 在其 owner 可协调的恢复点渐进整理：把失效叙事移入已有 walkthrough，保留日期、授权和失败记录，README 留最新快照与链接。不批量整理无关 Task，不回填历史验证结果。

旧 `.agents/tasks/` 与包级 `.agents/tasks/` 只保存 legacy `nbook.task/v1` provenance，不接收 `nbook.task/v2`。历史名称、worktree、branch、PR 与 Task 不迁移。

## 收尾与清理

- Work 不新增状态字段；收尾事实写进 Work README 正文。Work 的全部 Task 合入 `master` 后记一行：`已收尾：<master 上的合入提交号>；待清理：<worktree 路径>、<branch>`；未全部合入时不写，改在快照里继续。
- `governance:worktree` 报告的 `cleanup: "待清理"` 是清单来源：分支已是 `master` 祖先的 worktree 会被标记（判定为 `git merge-base --is-ancestor <branch> refs/heads/master`）；报告只读，不执行删除。
- 清理 worktree 与分支是受限动作：需开发者明确授权，且只清理 Work README 清单内的项；删除前逐项确认没有未提交改动；清单外的 worktree 一律保留并报告。
