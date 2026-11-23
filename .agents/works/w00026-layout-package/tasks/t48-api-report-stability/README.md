---
schema: nbook.task/v2
taskId: t48-api-report-stability
status: done
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

## 实现审查

Claude Sonnet（[证据](evidences/impl-review.txt)），重要 2、建议 8，都成立；修正在 `2c01811da`，合入 master `dfa4fb999`：

1. 组件的 `@stable` 闭包是空的（重要）：组件的引用改由 `readSurface` 按五段的类型文字认（去掉行首的属性名、事件名，同名不算），闭包对组件照样核；补“`@stable` 组件引到 `@experimental`”的单测；变异：`NestedGrid` 行尾改 `// @stable`，`api:check` 报出它引到的 16 个非 `@stable` 名字。
2. 报告与快照没固定换行（重要）：`.gitattributes` 给它们 `text eol=lf`，`api:check` 与快照测试读入时再按 LF 比。
3. 组件段的正则读法（建议）：`<script>` 属性顺序任意；`defineProps<Props>()` 这种读不到透传的报错要求写在宏里；`inheritAttrs` 读语法树；认 `v-bind="{...$attrs}"`；各补单测。
4. SDK 快照的闭包不含没导出的声明（建议）：报告每段另有“引用（没导出）”行，没导出的段也记引用，快照沿它们取闭包（现状快照不变）。
5. 闭包里“引到没导出的”用名字正则（建议）：改成按符号算出的结果直接判。
6. 声明不在根文件时静默为空（建议）：公开名字的声明不在本包声明文件顶层时报错，补单测。
7. 入口清单三处各一份（建议）：报告脚本开头核对产物 `package.json` 的子路径，对不上就报错。
8. SDK 提醒照不了做（建议）：提示列出变了的名字、给 `PLUGIN_API_SINCE` 所在文件与变更记录、写明在哪个目录重写；报告目录改成按仓库路径。
9. 测试缺口（建议）：补 SDK `tagLayoutComponents` 的单测（含两个抛错分支）与产物里 `GridIssue` 带标注的断言；变异做了第 1 条与改签名两种。“两次生成同字节”不另加单测：`api:check` 每次都拿新生成的与入库的逐字比，已经守着。
10. 文档（建议）：README 写明报告与变更记录在 GitHub 仓库里、不随 npm 包发布；SDK 模块头那句另起一段。

验证：nb-layout `bun test scripts` 44 个、`typecheck`、`api:check` 通过；应用 `bun test src/sdk`、`plugin-sdk/layout-tags.test.ts`、`plugin-sdk/pack.test.ts`（13 个）、`typecheck` 通过。

## 当前状态

完成，已合入。

## 下一步

nb-layout 首发（发布手册“新包首发”，要开发者在本机登录 npm）。
