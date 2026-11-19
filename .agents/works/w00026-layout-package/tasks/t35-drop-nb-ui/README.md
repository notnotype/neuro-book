---
schema: nbook.task/v2
taskId: t35-drop-nb-ui
status: active
updated: 2026-11-19
---

# nb-layout 去掉 nb-ui 依赖与 CSS 变量迁移

## 目标与范围

按提案第一档第 3 项：nb-layout 读的变量改名 `--nb-layout-*`、每处带回退（根上不声明缺省值，只在减少动效时归零）、导出变量清单、`layoutMotionMs`、层级变量、文案注入；桥接样式放 nb-ui 的 `tokens.css`；主题合同 `theme/system.md` 与受影响的主题文件、e2e

合同：布局行为与装了 nb-ui 时的外观不变；变的是 nb-layout 读的变量名（经 nb-ui 桥接）与文案的注入点。改 [`theme/system.md`](../../../../../docs/specs/theme/system.md) 第 2 层（桥接与对照表），[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md)、[`ui/layout-drag`](../../../../../docs/specs/ui/layout-drag.md) 里提到变量名的地方。依据：[提案](../../../../../docs/proposals/nb-layout-general-library.md)“去掉 nb-ui 依赖”“CSS 变量迁移”、[ADR 0054](../../../../../docs/adr/0054-nb-layout-general-library.md)。

## 当前状态

2026-11-19 开工。计划见 [`plan.md`](plan.md)（第 3 稿）。盘点由 Claude Haiku 只读整理（`.local/agent/works/w00026-layout-package/tasks/t35-drop-nb-ui/reports/inventory/`）：导入 nb-ui 的只剩 3 个文件，Vue 层读 46 个变量名另有 JS 读 3 个，e2e 有 18 个文件按这些名字设或读样式（提案写的是 6 个），`--radius-sm` 在哪都没定义；提案说主题作者文档里有布局变量，实际没有。

第 1 稿的设计审查（Claude Sonnet，[`evidences/design-review.txt`](evidences/design-review.txt)）：10 条，阻断 1、重要 5、建议 4，都成立，改成第 2 稿：

| 条 | 内容 | 处理 |
|---|---|---|
| 1 | 根上不分层的 `:where(:root)` 缺省值会压过 nb-ui 放在 `layer(base)` 里的桥接（层叠层先于特异性），装了 nb-ui 的外观会变、约 20 处 e2e 调不动过渡（阻断） | 根上不声明缺省值，只靠每处的回退；JS 读到空串用常量；只留一份减少动效时归零的样式（与 nb-ui 的归零一致） |
| 2 | 桥接约 40 行手写，拼错只会静默落到回退；截图看不出时长、层级、暗色 | 加桥接一致性测试（两个包都看得到的 neuro-book 里）与真实浏览器探针（四种主题与减少动效下旧名、新名计算值相等） |
| 3 | 子树上设旧名的还有 `lab-grid-structure.e2e.ts:184` 与 nb-layout 的 6 处 dom 测试 | 列入第 3 片，e2e 清单加 `lab-grid-structure` |
| 4 | 目录登记放应用是死代码（窗口引擎已登记）；提供文字端口的地方远不止 `mount.ts`；键要用 `Symbol.for`；`i18n.md` 输出 8 要写例外 | 应用侧 `provideHostText` 帮手，所有提供 `TEXT_PORT_KEY` 的地方改用，加检查；`Symbol.for`；`i18n.md` 写例外；别的共享包子树里的语言写成已知限制 |
| 5 | 三处按钮用 nb-ui 的 `nb-ui-focus-ring` 类，盘点与扫描都看不到 | nb-layout 自己的 `nb-layout-focus-ring`（照抄规则、经桥接读焦点变量）；扫描加样式类；自己的 `nb-ui-drop-indicator*` 改名 |
| 6 | `boundary.test.ts` 仍放行 nb-ui；变量扫描漏 JS 里的名字；临时空项目挡不住仓库根的 `node_modules` | 收紧 `boundary.test.ts` 就是“不读 nb-ui”的检查；扫描所有自定义属性名（含字符串）；删掉临时项目方案 |
| 7 | 回退值不能从 `tokens.css` 机械抄（多是 `var()` 与 `color-mix` 链，配色根本没有 `:root` 缺省） | 链在新名里重写；颜色用系统色；非颜色回退与 `tokens.css` 比对的测试 |
| 8 | 减少动效归零最弱、声明哪几个没写明 | 写明四个时长；`reduced-motion.css` 只做这一件事；JS 读到 `0ms` 当 0 |
| 9 | 层级进 CSS 变量违反 nb-ui 的规范（层级用 `:style` 绑登记表），且五份副本 | 第 2 稿改成浮层的 `zIndex` 属性；第 3 稿改回变量（见第二轮第 4 条） |
| 10 | 文档清单漏项、数字对不上、`--radius-sm` 改名会改外观 | 补全清单；数字按盘点改；`--radius-sm` 那句删掉（今天就是 0） |

第 2 稿的设计审查（Claude Sonnet，[`evidences/design-review-r2.txt`](evidences/design-review-r2.txt)）：9 条，阻断 0、重要 5、建议 4，都成立，改成第 3 稿。都是给了改法的细化，第 3 稿不再送审，由实现审查兜底：

| 条 | 内容 | 处理 |
|---|---|---|
| 1 | 桥接写进 `tokens.css`，SDK 的 `docs/tokens.md` 会把 `--nb-layout-*` 当主题变量列给插件作者 | 桥接照提案留在 `tokens.css`；`pack.ts` 的 `cssTokens` 跳过 `--nb-layout-`，`pack.test.ts` 加一条 |
| 2 | 空串改当缺省时长后，nb-layout 现有 dom 测试会走过渡（实测 `NestedGrid.dom.test.ts:1206` 会红） | dom 测试公共准备在根上设 `0ms`；非空但解析不出的仍当 0；`nested-grid.md` 补一条（planned） |
| 3 | 帮手的调用点不全（Lab 夹具 18 个文件、返回记录的写法），检查写法、公开导出没定 | 帮手两种形式；检查限定 neuro-book 非测试源码、认三种写法、豁免帮手与 `shared/testing`；`LAYOUT_TEXT_KEY` 等从 `vue/index.ts` 导出 |
| 4 | ADR 0054、提案、Task README 仍写旧做法：ADR 第 3 条写了“层级常数改变量” | 层级改回 CSS 变量，照 ADR 做，不另写 ADR；nb-ui 规范 2.1 写例外（待确认清单）；提案追加决策记录；本 README 的目标改成现在的写法 |
| 5 | 一致性与回退测试按字面写不出来，范围没定 | nb-layout 导出变量清单 `NB_LAYOUT_THEME_VARS`，扫描、一致性测试、文档对照表、JS 缺省值都以它为准；回退只比标量类；探针查“桥接没被盖过”，显式设不减少动效 |
| 6 | 减少动效的样式不带 `!important`，宿主在 `:root[data-theme]` 上设的时长会压过它 | 加 `!important` |
| 7 | 类名改名漏 `nb-ui-drop-feedback*`；变量扫描照字面会把 BEM 修饰符当变量 | 一起改名；扫描用 `(?<![A-Za-z0-9_-])--[a-z]` |
| 8 | 焦点环放哪里、`!important` 保不保留没写 | 与减少动效同放 `vue/global.css`（nb-layout `AGENTS.md` 写例外）；不带 `!important`，写明理由 |
| 9 | 层级缺省与 `NB_Z_INDEX` 之间没有机检；变更记录漏“在自己容器上设旧名”这一类 | 一致性测试核对桥接与回退等于 `NB_Z_INDEX`；变更记录补上 |

## 下一步

Spec 已写（planned）：[`theme/system`](../../../../../docs/specs/theme/system.md) 的“布局组件的桥接”、[`ui/i18n`](../../../../../docs/specs/ui/i18n.md) 输出 8 的例外、[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 输出 141 到 143 与“边界与兼容”的变量清单；提案追加决策记录，待确认清单加三行。

进展（worktree `w00026-t35-drop-nb-ui`）：第 1 片文案 `d387d5148`、第 2 片类名 `1526647be`。第 1 片的 `test:affected` 10 条失败：`nbook.stickers` 清单 7 条与 SDK 导出面 `ImagePreviewDialog` 1 条是 master 上原有的；`pack.test` 生成 SDK 包的 2 条是负载 26 到 30 时 vue-tsc 超时，负载 10 时单独重跑 13 条全过。

1. 第 3 片变量与焦点环、第 4 片依赖与机检；收口跑受影响的测试与 e2e，启动实现审查（前端，Claude Sonnet）。
