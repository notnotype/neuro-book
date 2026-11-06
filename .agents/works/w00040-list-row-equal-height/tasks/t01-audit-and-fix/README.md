---
schema: nbook.task/v2
taskId: t01-audit-and-fix
status: shelved
updated: 2026-11-04
---

# 现有列表与卡片按“同一列表的行等高”整改

## 目标与范围

开发者 2026-10-23 定：同一个列表里的行与卡片等高，整个 neuro-book 与 nb-ui 都遵守。规则写在 [nb-ui 开发规范](../../../../../packages/nb-ui/docs/ui-development-spec.md) 的“3. 几何、排版与动效”第 5 条与自检清单“同一列表的行等高”。本 Task 把规则出来之前写的列表逐个核实、整改。

合同：不改产品行为合同；涉及的组件按规则改布局，同名 `.md` 一起改，有 Spec 写到行结构的一并改。做法参照 w00019 的 `AgentSessionList`（`1897b5828`）：每行行数与行高固定，可选内容放进已有的行，没有时那一行留着；e2e 或 Lab 里比同一列表各条目的高度。

## 候选

2026-10-23 子代理按 `v-for` 渲染的行扫了 nb-ui、neuro-book、nb-agent-ui、nb-story、dev-panel（不含旧应用），以下未逐个核实。dev-panel 是开发工具，是否纳入由开发者开工时定。

| 位置 | 疑点 | 把握 |
|---|---|---|
| `packages/neuro-book/src/plugins/projects/web/components/ShelfList.vue` | 说明是可选的一行，标题 `overflow-wrap: anywhere` 会换行 | 高 |
| `packages/neuro-book/src/ui/settings/SettingsPageList.vue` | 说明是可选的第二行，状态与修改点可选 | 中高 |
| `packages/neuro-book/src/ui/settings/SettingsRow.vue`、`src/plugins/settings/web/components/SettingsListSection.vue` | 说明、多条原因、适用范围、覆盖提示可选（设置项是表单行，可能属例外，开工时先定） | 中 |
| `packages/neuro-book/src/plugins/projects/web/components/FileBrowser.vue` | 标记与色块可选，文字是否截断未确认 | 低 |
| `packages/nb-story/src/web/shell/LibraryPage.vue` | 抽取进行中多出进度条与一行说明 | 高 |
| `packages/nb-story/src/web/shell/CardRelations.vue` | 摘要一到两行，词与身份可选 | 高 |
| `packages/nb-story/src/web/shell/DrawerCard.vue` 的记录行 | 正文不截断，方式、标签、出处可选 | 中高 |
| `packages/dev-panel/src/web/parts/WorkCard.vue` | 标题不截断，目标一到两行，分支提示与“谁在动”可选 | 高 |
| `packages/dev-panel/src/web/parts/PrList.vue` | 失败检查列表等可选 | 高 |
| `packages/dev-panel/src/web/parts/ProcList.vue`、`SessionList.vue`、`InboxList.vue`、`RunList.vue` | 第二行字段可选、`flex-wrap` 与长文字换行 | 中高 |
| `packages/dev-panel/src/web/parts/IssueList.vue`、`ArtifactList.vue`、`SearchResults.vue` | 徽标可选且 `flex-wrap` | 中 |

已核对合规：`ExplorerRow.vue`（固定 22px）、`ShelfCards.vue`（书卡固定尺寸）。未查的候选：nb-story `SearchBox.vue`、neuro-book `PluginsPage.vue`、`WelcomePage.vue`、nb-agent-ui `AgentQueuedMessages.vue`。

## 当前状态

2026-10-23 在 w00029 t09 新建后按开发者要求搁置，未开工。2026-11-04 开发者同意从 w00029 移到本 Work（它是全仓整改，超出“nb-ui 组件整理”的目标），继续搁置。

## 下一步

开工时先逐个截图核实候选（同一列表放最空与最满的条目），确认范围后写计划；改动按包分批，每批跑对应包的 Lab 场景与 e2e。
