---
schema: nbook.task/v2
taskId: t03-agent-workflow-slimdown
---

# Agent 协作规则与技能精简

## 目标与范围

执行开发者在 2026-09-21 批准的 `agent-workflow-slimdown` 计划：缩窄专项技能、退役正式角色及机器消费者、简化本地登记与 Task 快照，以 [Work](../../README.md)、[仓库流程](../../../../../docs/standards/repository-workflow.md) 和 [测试规范](../../../../../docs/testing/README.md) 为长期规则来源。

## 当前状态

实施、聚焦验证与独立审查已完成；交付未提交 diff，不请求或执行远端动作。主 Agent 集成项目文档、39 份既有 current Task 元数据和两个独立切片；本 Task 自始无 role。

## 授权与基线

- 用户明确批准用户级 Skills 一并精简及执行完整计划；不授权提交、push、合并、发布、部署或产品数据操作。
- checkout：`.worktree/w00001-development-workflow-governance`；branch：`refactor/w00001-agent-workflow-slimdown`；基线 HEAD：`45906272915ff43e83318653af62afa9ce668206`。
- 从主 checkout 保留目标文件已有内容；原内容及复制清单位于系统 Temp `neuro-book-governance-baseline-Q7qY6x/manifest.json`。另按已有链接原样保全 34 份依赖（含 Spec 注册表、提案、规范及历史证据），清单见同目录 `dependencies.json`；后续对 w00017 implementation-plan 的登记前置修订属于本轮，其余依赖不算本轮成果。主 checkout 和产品树 t67 未修改。
- 验证覆盖未提交 diff，无独立 revision。历史 provenance、用户的 w00003 合并后才能进入 w00017 实施的条件不变。

## 验证与边界

所有命令在上述治理 checkout 根运行，证据覆盖当前未提交修改，不对应独立提交 revision：

| 验证 | 实际结果 |
|---|---|
| `bun x vitest run --config scripts/vitest.config.ts scripts/ci/agent-governance.test.ts scripts/ci/check-documentation.test.ts` | 首次 120 秒外部时限终止，无通过结论；随后分文件定位 |
| 同配置单独运行 `scripts/ci/check-documentation.test.ts --reporter=verbose` | 16 例通过 |
| 同配置单独运行 `scripts/ci/agent-governance.test.ts --reporter=verbose` | 142 例通过、4 例因 5000/15000ms 时限失败，耗时 229.90s；无行为断言失败 |
| 四个超时场景定向重跑 | PATH 临时优先 Git 实际安装入口，3 例通过；历史身份用例仍超时并出现清理 EBUSY；仅该例增加命令行 `--testTimeout=30000` 后通过（实际 3.51s），未修改全局时限或 legacy 实现 |
| 新参数组合拆成独立场景后 `-t "agent-context 拒绝非法参数"` | 默认时限下 5 例通过；最终治理 150 例与文档 16 例有分次有效证据，不宣称一次全绿 |
| `bun x tsc --noEmit -p scripts/tsconfig.json` | 通过；参数测试拆分后再次通过 |
| `bun run governance:context -- --work w00001-development-workflow-governance --task t03-agent-workflow-slimdown` | exit 0，v2、真实路径／branch，无角色字段，failures 空 |
| 上述命令追加 `--role tasker` | 预期 exit 1，JSON 报未知参数，Work/Task 路径为 null，未进入身份解析 |
| `bun run docs:check` | 首次发现隔离复制缺少继承提案依赖；补齐原文后通过，5488 files |
| `bun run governance:check` | exit 1，仅既有 `w00003-neurobook-ui-foundation-migration/tasks/t14-agent-profile-nav-lab-migration/README.md` 缺失；warnings 空，未修无关 Task |

- 定向检查 61 份文档的 167 个相对链接均存在；用户级及仓库活跃技能／scripts 无四个退役技能或删除 verifier 引用；历史 Proposal、legacy provenance 和历史执行叙事保留。
- 八类语义场景已核对：只读问题、局部 UI、核心 bug、独立并行、无远端权限新 Work、长任务恢复、产品决定／发布、内置浏览器不可用。均没有形式角色、远端占号或叠加全量验证前置；具体授权及 w00003 业务依赖仍有效。这是文档语义核对，不是产品场景运行。
- 用户级备份：`%TEMP%/nbook-skill-slimdown-backup-20260921-232446/`，14 份目标原文件 SHA-256 已核对；`manifest.json` 保存安装来源，`links.json` 保存宿主链接目标。四技能目录及八个宿主链接已删除，锁仅移除四键，其它条目完全相同；Playwright 两入口及 10 份 references 保留。
- 未运行产品测试、应用 typecheck、生产构建、浏览器、发布或全部 scripts 测试；无对应变化，不追加。尚未重启／新建用户会话，磁盘入口退役不代表当前已注入技能消失，也不证明新会话发现缓存已更新。上游 Skills 更新可能覆盖本地定制。
- 独立机器合同审查未发现缺陷；规则审查指出本地提交授权措辞和冻结占号副本收口两处歧义，已澄清“按当前任务授权、不自动提交”并补充“已授权同步时仅处理确认未被他人修改的精确占号副本”。本轮仍不提交、不同步主树，不扩大产品或数据操作授权。
