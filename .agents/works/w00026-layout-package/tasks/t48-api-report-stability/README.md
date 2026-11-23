---
schema: nbook.task/v2
taskId: t48-api-report-stability
status: active
updated: 2026-11-23
---

# API 报告 CI 与 @stable、@experimental 标注

## 目标与范围

公开入口出 API 报告并在 CI 里比对，全部公开符号标 @stable 或 @experimental（提案第二档第 2、3 项）；报告与导出名清单测试的分工、与 @stable 范围的对应在这个 Task 定。

合同：nb-layout 的行为合同未变（标注是包的发布承诺，写在包 README 与 [ADR 0054](../../../../../docs/adr/0054-nb-layout-general-library.md) 第 10 条）；[`runtime/plugin-code-loading`](../../../../../docs/specs/runtime/plugin-code-loading.md) 的“共享入口即兼容承诺”加 nb-layout 名字跟着 nb-layout 的标注走（开发者 2026-11-23 定）。

## 当前状态

2026-11-23：开发者在会话里定了第 2 轮停下的两件，连同 nb-layout 可以首发、`ui/nested-grid` 与 `ui/layout-drag` 可以晋升：
1. **稳定范围**：nb-layout 0.x 期间全部名字 `@experimental`，包括插件 SDK 转出的；SDK 写明它转出的 nb-layout 名字跟着 nb-layout 的标注走。
2. **`@stable` 由谁定**：nb-layout 自己的标注；SDK 加一行转出不替 nb-layout 许诺。

据此写了[计划](plan.md)第 3 稿。第 3 轮（最后一轮）设计审查（Claude Sonnet，重要 6、建议 2，[证据](evidences/design-review-3.txt)）八条都成立；其中第 4 条（SDK 转出名变了要不要提兼容起点）交开发者，答复：
3. **SDK 转出的 nb-layout 名字发生不兼容的签名改动时提 `PLUGIN_API_SINCE`**，由测试提醒；兼容的改动不提。

按审查与这个答复改出第 4 稿，不再交设计审查（三轮上限），开始实施。

此前：第 2 轮设计审查（Claude Sonnet，重要 7、建议 3，[证据](evidences/design-review-2.txt)）十条都成立，其中第 2、4 条牵涉对外承诺，停下等开发者；第 1 轮（Sonnet，阻断 2、重要 5、建议 3，[证据](evidences/design-review.txt)）都成立，改出第 2 稿；探针见[证据](evidences/probes.txt)。

## 实施

2026-11-23 按第 4 稿实施，合入 master（`89c08b916`）：

| 片 | 提交 | 内容 |
|---|---|---|
| 1 | `3d344e02d` | `scripts/api-surface.ts`：从发布声明读公开面（检查器解别名、标注齐全、引用、可达未导出、`@stable` 闭包），11 个单测 |
| 2 | `2145bbff5` | 源码 156 处声明加 `@experimental`（一次性语法树脚本，留在本地 `codemod/`；文件头那一处手改）、`.vue` 里的类型 1 处、组件 7 行行尾；nb-layout 与插件 SDK 的打包都把组件标注插进声明；SDK 模块头与 README、Spec `runtime/plugin-code-loading`（master `46cd63ee1`） |
| 3 | `821cc2a8d`、`57e444d68` | `api-components.ts`（组件五段）、`api-report.ts`（头、格式、比对、`api:report`、`api:check`）、`api/*.api.txt` 入库；应用的 `scripts/nb-layout-surface.ts` 与 `src/sdk/nb-layout-surface.txt` 快照（48 个名字）；CI、验证门禁（master `0accdf432`）、README“版本承诺”、AGENTS.md、两份变更记录 |

验证：
- nb-layout `bun run typecheck`、`bun run test`（bun 433、vitest 294）通过；`bun test scripts` 39 个通过；`build:package` 两次逐文件相同。
- 应用 `bun run typecheck` 通过；`bun test src/sdk` 通过；`plugin-sdk/pack.test.ts` 13 个通过（SDK 的 `NestedGrid` 声明前有 `@experimental`）。
- 变异：改 `clampFloatRect` 的签名、给 `NestedGrid` 加一个可选属性，`api:check` 都失败并列出差异；改报告里 `NestedGrid` 的 `layout` 类型，SDK 快照测试失败。恢复后都通过。
- 单测里抓到一处真问题：`Pick<HTMLAttributes, "id">` 这种包在工具类型里的透传认不出来，改成遍历这一项里的全部类型引用。
- `docs:check`、`governance:check` 的失败都是 master 上原有的（network 插件的消息目录、`bots/view.md`、nb-models 与 lab-agent-ui 的固定等待），不在本 Task 的文件里。

## 当前状态

已合入；实现审查（Claude Sonnet，不阻塞）在跑，报告回来后处理，修正单独提交。

## 下一步

处理实现审查；之后 nb-layout 首发（发布手册“新包首发”，要开发者在本机登录 npm）。
