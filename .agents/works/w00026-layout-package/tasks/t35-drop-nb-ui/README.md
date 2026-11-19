---
schema: nbook.task/v2
taskId: t35-drop-nb-ui
status: active
updated: 2026-11-19
---

# nb-layout 去掉 nb-ui 依赖与 CSS 变量迁移

## 目标与范围

按提案第一档第 3 项：--nb-layout-* 变量带回退、:root 默认值（含减少动效）、layoutMotionMs、层级变量、文案注入；桥接样式放 nb-ui 的 tokens.css；主题合同 theme/system.md 与受影响的主题文件、e2e

合同：布局行为与装了 nb-ui 时的外观不变；变的是 nb-layout 读的变量名（经 nb-ui 桥接）与文案的注入点。改 [`theme/system.md`](../../../../../docs/specs/theme/system.md) 第 2 层（桥接与对照表），[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md)、[`ui/layout-drag`](../../../../../docs/specs/ui/layout-drag.md) 里提到变量名的地方。依据：[提案](../../../../../docs/proposals/nb-layout-general-library.md)“去掉 nb-ui 依赖”“CSS 变量迁移”、[ADR 0054](../../../../../docs/adr/0054-nb-layout-general-library.md)。

## 当前状态

2026-11-19 开工。计划见 [`plan.md`](plan.md)（第 2 稿）。盘点由 Claude Haiku 只读整理（`.local/agent/works/w00026-layout-package/tasks/t35-drop-nb-ui/reports/inventory/`）：导入 nb-ui 的只剩 3 个文件，Vue 层读 46 个变量名另有 JS 读 3 个，e2e 有 18 个文件按这些名字设或读样式（提案写的是 6 个），`--radius-sm` 在哪都没定义；提案说主题作者文档里有布局变量，实际没有。

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
| 9 | 层级进 CSS 变量违反 nb-ui 的规范（层级用 `:style` 绑登记表），且五份副本 | 改成浮层的 `zIndex` 属性，缺省 59、60，调用点传 `NB_Z_INDEX` |
| 10 | 文档清单漏项、数字对不上、`--radius-sm` 改名会改外观 | 补全清单；数字按盘点改；`--radius-sm` 那句删掉（今天就是 0） |

## 下一步

1. 第二轮设计审查（Claude Sonnet），阻塞。
2. 处理完写 Spec，开 worktree 按计划四片实施。
