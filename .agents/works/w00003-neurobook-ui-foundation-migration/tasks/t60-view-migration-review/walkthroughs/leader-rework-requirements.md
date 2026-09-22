# t55/t56 返工要求（视图迁移增量复核后）

依据：[t60 复核记录](../../t60-view-migration-review/walkthroughs/review.md)（被审 revision `c2152f83`，裁定「需修复」）。
复核已证实成立的部分（无需返工）：Q1 迁移原语的回读/并发/删除门禁、Q2 单写者、Q4 定义与注册幂等、Q5 视图解析与两处注入缝隙的缺省路径、Q3 的抽取等价性。

| # | 级别 | 要求 | 证据 |
|---|---|---|---|
| R1 | P2 | **文件树手势必须在记录首读完成前不可用**。现状 `WorkspaceFilePanel.vue:51-56` 只消费 `expandedPaths/notice/commit/retry/abandon`，从不读 `expandedPathsRecord.loading`；读取窗口内 `WorkspaceFileTree.vue:98-104` 会把**整份 `props.expandedPaths`（此刻是产品默认）** emit 给 setter 并 `commit`，合成以已确认记录为底、以这份整份数组为意图 → 记录里原有展开项被静默丢弃（无诊断）。规范要求「初次加载可以显示产品默认布局，**尺寸调整控件在读取就绪前不可用**」，同批的 World Engine 已用 `resizeDisabled = panelSizes.loading` 做到。最小修复二选一：`loading` 为真时拒绝提交；或读取就绪前不渲染树、复用既有 `t("ide.workspace.filePanel.loadingTree")` 占位。 | `probe-01-first-read-intent.probe.test.ts`；复现命令见复核报告 Q1 段 |
| R2 | P3 | **覆盖共享迁移原语的保留分支**。`legacy-record-migration.ts` 的价值主张是「任一步失败都保留旧键」，但现有替身无法构造失败路径，`unavailable`（隐私模式/被禁用）、`deferred`（意图在飞）、迁移未确认（`commit` 失败）三条保留分支与 `createBrowserLegacyValueStore` 的 SSR/不可用分支**零测试**。补测（不需改产品代码）：给替身加可控 `read()`（可返回 `{kind:"unavailable", diagnosis}`）与可控 `remove()`（可返回 `false`）+ 用传输钩子让 `commit` 失败一次。 | 复核 Q6 段 |
| R3 | P3 | **修正文档与实现不符的 4 处**（两份新文档：`WorkbenchViewHost.md`、`WorkspaceFilePanel.md`，复核逐处指出）；并更正清单/报告里「四个 legacy 组件都不能删」的口径——实际只有 3 个满足被引用/被断言的条件，第 4 个（`WorldEngineTimeline.vue`）另因与 `…SubjectStateViewer` 互为引用而保留，请写清各自原因。 | 复核 Q7/Q8 段 |

## 约束

- 不启停 3001、不起第二个 dev server（共享 `.nuxt`）；类型信息用只读方式或按 Leader 给的窗口。
- 不提交、不 push；只逐文件 `git add`；不覆盖用户 dirty `app/utils/workbench/descriptors{,.test}.ts`。
- 完成后更新对应 Task 的 `walkthroughs/implementation.md`（逐条 R1–R3 证据 + 命令/退出码/用例数），并 `hub send` 通知 `MigrationIncrementsReview` 做追加复核。