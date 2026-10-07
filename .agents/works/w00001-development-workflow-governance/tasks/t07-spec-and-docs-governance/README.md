---
schema: nbook.task/v2
taskId: t07-spec-and-docs-governance
---

# 实施“规格驱动开发：文档分工与 Spec 写法”

## 目标与范围

开发者 2026-10-07 接受 [规格驱动开发：文档分工与 Spec 写法](../../../../../docs/proposals/spec-and-docs-governance.md)，五个待定项按推荐：已实现的 Spec 加新行为用条目级“（planned）”；`storage/boundaries.md` 收窄而不并入 `persistence.md`；存量 Spec 改到哪份清理哪份，本次只做提案列出的试点；全部 `accepted` 提案冻结正文；提案第 6 节的机检全部采用。本 Task 按提案“对 Spec 与治理文档的预期改动”一节逐项落实。

执行位置为 `.worktree/w00017-runtime-foundation`（分支 `refactor/w00017-runtime-foundation`），与 w00017 的 K4 代码在同一工作树，只按路径提交本 Task 的文件。同一分支此前已完成、本 Task 不重做：删除 `docs/specs/TEMPLATE.md`，新增 `writing-specs` 与 `reviewing` 两个 skill，删除 `.claude/skills` 与 `report`、`repository-workflow`、`leader` 三个 skill，试做 [`storage/persistence.md`](../../../../../docs/specs/storage/persistence.md)。

非目标：清理其它存量 Spec；改动已接受提案的其它正文；远端动作。

## 当前状态

已完成，本地提交，未推送。

| 提交 | 内容 |
|---|---|
| `07eae3a2` | 提案改为 `accepted` 并追加决策记录；提案 README 按第 5 节改写；13 份提案与 3 份 ADR 补 frontmatter、删去状态节或状态行；Spec README 按第 1–3 节改写，注册表“说明”列只写范围；`docs/specs/AGENTS.md` 只留指向；新建 [运行时术语表](../../../../../docs/specs/runtime/glossary.md)；`writing-specs` 与新 README 对齐 |
| `e9b09836` | 清理 [`runtime/services.md`](../../../../../docs/specs/runtime/services.md)，补交互合同“签发在门面工厂返回之后完成”；[`runtime/application.md`](../../../../../docs/specs/runtime/application.md) 的同步段启动规则移到“状态与转换”；[`storage/boundaries.md`](../../../../../docs/specs/storage/boundaries.md) 收窄为跨能力的归属规则；`nb-runtime` 的 `services/composition.ts` 模块头补签发时机的原因（只加注释） |
| `4918f92a` | `implementation-planning` 的验收映射写 Spec 编号；`docs/testing/README.md` 的“测试写法”链接开发方式 |
| `6c3614dd` | `docs:check` 按提案第 6 节新增提案与 ADR 的 frontmatter 与索引登记校验（失败），Spec 正文 Task 引用与“证据”多余行（警告），配测试 |

清理 `services.md` 时核对了代码：实现合同原写的 `perConsumer(factory, {release?})` 与实际签名不符，已按代码写成 `perConsumer(facade, release?)`；门面工厂须同步、门面不是 thenable、作废原因这几条可观察行为从实现合同搬回输出与失败两节，行为未变。

## 验证证据

| 命令 | 结果 | 证据 |
|---|---|---|
| `bun run docs:check` | `failures: []`；新规则在存量 Spec 上产生 38 条警告（“证据”多余行 26、正文 Task 引用 12），按现有机制汇总为计数 | [docs-check.txt](evidences/docs-check.txt)、[new-spec-warnings.txt](evidences/new-spec-warnings.txt) |
| `bun run governance:check` | `failures: []` | [governance-check.txt](evidences/governance-check.txt) |
| `bun x vitest run scripts/ci/check-documentation.test.ts` | 20/20 通过 | [check-documentation-test.txt](evidences/check-documentation-test.txt) |
| 变异检查：六处新规则各改坏一次 | 每次恰有 1 例失败，恢复后 20/20 通过 | [mutation-check.txt](evidences/mutation-check.txt) |
| `bun x tsc -p scripts/tsconfig.json --noEmit` | 退出码 0，无诊断 | [tsc-scripts.txt](evidences/tsc-scripts.txt) |

## 待决定与未覆盖

- **`workbench-commands.md` 的状态**：正文决策记录写“2026-09-19：范围收敛并批准分批实施（w00016）”，没写决策者；[w00016](../../../w00016-workbench-commands/README.md) 的 Work README 仍称该提案为 draft；据它收窄的 `workbench/commands.md` 与 `quick-open.md` 已是 `implemented`。本次按批准事实标 `accepted`、`decided: 2026-09-19`，未在决策记录追加行；待决策点 4、6、7 当时留待后续批次。若开发者认为当时只批准了首批实施，应改回 `reviewing`。
- **`model-roles-contract.md` 的状态**：旧索引写 `draft`，正文与决策记录写 2026-09-10 开发者拍板、`accepted`；按正文标 `accepted`。
- “签发在门面工厂返回之后完成”这条交互合同是代码事实，目前没有专门的测试锁定。
- `workbench-view-host.md` 正文有 4 处 `§`（`governance:check` 警告）；提案正文已冻结，未改。
- Work README 没有 Task 表，按现有写法加一行正文登记本 Task。
