# Project identity alias 失败归因

2026-09-16，主 Agent 实跑，未修改被测文件或锁实现。

## 当前结果

cwd `packages/neuro-book`：

```text
bun run test server/workspace-files/project-identity.test.ts -t '稳定Workspace Root alias' --testTimeout 25000 --maxWorkers 1
```

1 failed / 3 skipped，24.56 秒。第34行期望 `PROJECT_IN_USE`，实际收到 `ELOCKED`。
这是延长测试期限后可稳定观察的断言失败，不能只称为运行慢。

## 提交前对照

在系统 Temp 的 `neuro-book/acceptance/storage-adapter-t26/project-identity-baseline.vitest.mjs`
建临时 Vitest 配置，继承仓库原配置；pre load hook 仅将测试依赖的两份本轮已改文件
`project-lifecycle.ts` 与 `novel-workspace.ts` 替换为 `git show 0d66064b:<path>` 的原内容。
保持原模块位置以维持相对依赖解析，工作树文件不改写；锁实现、identity 测试均未被本轮修改。

```text
bun run test --config <临时配置> server/workspace-files/project-identity.test.ts -t '稳定Workspace Root alias' --testTimeout 25000 --maxWorkers 1
```

同样 1 failed / 3 skipped，25.21 秒，同一行、同一 `ELOCKED` 对 `PROJECT_IN_USE` 差异。
这是相关依赖的提交前对照，不是整个仓库旧 checkout 的全量测试。

## 判断与边界

证据支持将该 alias 用例列为已有失败，不能归因于本轮 Storage 边界或新增 revalidate 方法。
本 Task 不改锁竞争合同，也不把聚焦通过写成全库通过。
后续若修复 Workspace Root alias 的锁错误归一，应单独调查 ProjectLockModule mutation/occupancy 层次。

本轮文件边界当前已完成的聚焦验证为 13 文件 131 用例通过、主应用 typecheck exit 0；
随后新增的 CLI/普通目录/资产 ZIP 补修仍需单列最终结果。
