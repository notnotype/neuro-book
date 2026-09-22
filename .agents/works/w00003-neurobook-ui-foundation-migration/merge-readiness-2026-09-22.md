# 合并就绪核对（2026-09-22，非本 Work owner 执行）

停止并发 Agent 后，主线侧把本 checkout 的未提交改动按区域分成三个提交保留在 `refactor/w00003-nb-ui-adoption`：

- `39e50767` feat(nb-ui)：命令输入面、网格渲染与拖放反馈零件
- `565f792d` feat(workbench)：命令运行时、多分组面板与网格拖放
- `492de07f` docs(w00003)：命令、网格与工作台插件化批次

合并进 master 前按本 Work 的红分支规则核对主应用 typecheck，**未通过**，因此未合并。

## 证据

命令（cwd `packages/neuro-book`，checkout 本工作树）：

```text
bun run --cwd packages/neuro-book typecheck
```

结果：`exit 2`，`error TS` **123 条 / 15 个文件**。分文件计数：

| 文件 | 错误数 |
|---|---|
| `app/component-lab/fixtures/AgentSystemPromptPanelFixture.test.ts` | 30 |
| `app/component-lab/fixtures/AgentLinkedAgentPanelFixture.test.ts` | 24 |
| `app/component-lab/fixtures/AgentSidebarViewFixture.test.ts` | 20 |
| `app/component-lab/fixtures/AgentSessionHeaderFixture.test.ts` | 18 |
| `app/component-lab/fixtures/AgentComposerFixture.vue` | 11 |
| `app/utils/workbench/workbench-drop.ts` | 9 |
| `app/components/common/form/ReferenceSelectorPopover.vue` | 2 |
| `app/components/novel-ide/agent/dialogs/session-list/AgentSessionDialog.vue` | 2 |
| 其余 7 个文件各 1（含 `WorkbenchPartHost.vue`、`product-catalog.ts`、`AgentChatFlow.vue`） | 7 |

样例：

```text
app/component-lab/fixtures/AgentSystemPromptPanelFixture.test.ts(39,75): error TS2554: Expected 0-1 arguments, but got 2.
app/component-lab/fixtures/AgentComposerFixture.vue(45,5): error TS2353: Object literal may only specify known properties, and 'model' does not exist in type 'AgentSessionModelDraft'.
app/utils/workbench/workbench-drop.ts(508,13): error TS2339: Property 'kind' does not exist on type ...EdgeHit | RemainderHit...
app/components/workbench/WorkbenchPartHost.vue(332,41): error TS2304: Cannot find name 'WorkbenchTitleActionItem'.
```

## 判断

- 报错文件全部落在 `39e50767`/`565f792d` 两个提交所覆盖的批次内，属停止时的半成品状态（组件库夹具挂载 API、`model`→`modelId` 的 DTO 改名、`EdgeHit` 判别字段、`WorkbenchTitleActionItem` 类型导入未同步）。
- 本 Work 的红分支规则禁止红色 revision 合并 master；主线 typecheck 基线为绿，合并会把 123 条错误带入主线。
- 因此本轮只保留提交，不合并、不 push。恢复方式：修完上述类型错误并重跑本文件命令与 `packages/nb-ui` 门禁后，再由 owner 决定合并。

## 未运行

`packages/nb-ui` 自身门禁本轮通过（typecheck 通过；`bun run --cwd packages/nb-ui test` → 29 文件 / 519 用例通过），但未运行 nb-ui e2e、Lab smoke、真实浏览器矩阵、Product build；它们不在“只读核对合并就绪”的范围内。

## 处理结果（2026-09-22 后续）

开发者要求修复这 123 条错误，已按根因收敛并提交为 `779e23b4`：

| 簇 | 条数 | 修法 |
|---|---|---|
| Nuxt/H3 自动导入遮蔽 Vue 的 `createApp` | 92 | 四个 `Agent*Fixture.test.ts` 显式 `import {createApp} from "vue"` |
| 拖放命中类型半重构 | 9 | `EdgeHit` 补 `kind: "edge"` 判别字段；`edgeHitOf(insertion!)` 改为按 `kind !== "keep"` 收窄；`ContainerViewPresentation` 补 `collapsedViewIds`（catalog 已在产出、落点模块已在消费） |
| DTO / 尺寸契约改名未同步 | 21 | 夹具对齐 `AgentSessionModelDraft`（`modelKey`/`reasoningEffort`）、`EnabledModelOptionDto`（key/providerId/modelId/input/contextWindowTokens）、`AuthUserDto.displayName`、附件条目的 `sha256:` 定位与 `locator/firstSeenAt/referenceCount`、文本预览 `bytes/omitted`；`IconButton` 的 4 处 `xs` 改 `sm`（nb-ui 尺寸档只有 sm/md/lg） |
| 漏 import | 2 | `WorkbenchTitleActionItem`、`AgentSessionSummaryDto` |

修复过程中另暴露并处理同批次的两处非类型缺口：

- `NovelIdeActivityBar` 转交 `WorkbenchActivityBar` 时漏绑 `@invoke`，容器、工具与底部命令点击均无响应（两个活动栏用例失败）。
- `project-image-experience.contract.test.ts` 仍指向移动前的组件路径（附件卡/图库/正文气泡/附件面板），已更新到当前落点。

### 本轮验证（在 `refactor/w00003-nb-ui-adoption` checkout 内）

```text
bun run --cwd packages/neuro-book typecheck   → exit 0，error TS 0 条
bun run --cwd packages/neuro-book test app/component-lab app/utils/workbench \
  app/components/workbench app/components/common app/components/novel-ide
  → 117 文件 / 1266 用例通过，exit 0
```

未运行：`packages/nb-ui` e2e、Component Lab Lab smoke、Product build（含 Product 排除扫描）、桌面/窄屏浏览器矩阵。按本 Work 的红分支规则，合并前仍需这些证据；本轮只把主应用 typecheck 与聚焦测试恢复为绿。
