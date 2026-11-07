---
schema: nbook.task/v2
taskId: t18-motion-curve
status: done
updated: 2026-11-06
---

# 全应用的动效向布局曲线看齐

## 目标与范围

开发者 2026-11-06：“我发现目前 grid 布局工具的这个动画曲线非常丝滑，NeuroBook 其他地方也用这种动画曲线。例如：tab 切换，ActivityBar 的 tab 切换，文件资源管理等等（开一个 task，后续再派子代理做迁移）”。

规范已改（[设计语言](../../../../../../packages/nb-ui/docs/design-language.md) 的“缓动”、[`ui-development-spec.md`](../../../../../../packages/nb-ui/docs/ui-development-spec.md) 第 7 条）：看得出在动的都用 `--ease-layout`。这个 Task 做迁移。

要向它看齐的：标签切换（`Tabs`、`SegmentedControl` 的指示线）、活动栏切换、文件资源管理器（`ExplorerRow`、`ExplorerTree` 的展开与选中）、`Tree`、内容换页（`styles.css` 的 `.nb-ui-switch-*`）、浮层展开。旧应用不动。

合同：动效的规范在设计语言，不改行为合同；Spec 里写死时长的条目（例如 `workbench/views.md` 输出 12 的淡入淡出）不在范围内。

## 当前状态

2026-11-07 已合入，实现审查已处理（`a0f70d315`）。

规则（`--ease-standard` 148 处，按种类分，直接照这张表迁移，改动机械，没有另写 plan.md）：

| 种类 | 做法 |
|---|---|
| 只变颜色、阴影、透明度的状态反馈 | 换 `--ease-layout`，时长不动 |
| 控件里有位移或形变（开关滑球、分段控件指示块、chevron、展开收起的高度、程序开合的分栏、标签条滑开、抽屉、进度条） | 换 `--ease-layout`，时长换新令牌 `--motion-move`（280ms） |
| 菜单入场、`out-in` 换页 | 换 `--ease-layout`，时长照旧 `--motion-fast`：设计语言写明这里的等待读作迟钝 |
| 退场（遮罩、弹层、右键菜单、通知、对话框的缺省） | 换 `--ease-dialog-leave`：主曲线配淡出看着像直接关掉 |
| 循环（骨架屏、不确定进度、编辑器读取进度） | 新令牌 `--ease-loop`：首尾对称，接缝才不跳 |
| 主题的覆盖 | 四个主题的 `--ease-standard` 一起删 |

开发者点名的几处原来没写曲线（缺省 `ease`）：`Tabs` 的下划线、`ExplorerRow` 的行与 chevron、`WorkbenchPanelHead` 的标签，都补上。`WorkbenchToolStrip` 自己没有过渡，按钮是 `IconButton`，变色走它的过渡，已换。

验证：`test:affected --typecheck` 只有已知失败（`AgentModeSwitchWizard`、`qa-service`、`permission-page` 的类型，`plugins/agent` 的跨插件导入）；e2e `themes`、`files-explorer` 全过，`lab-scenes` 只有 ThemeEditor 假素材的 404。

和原计划不同的地方：README 原来写“在 Lab 里并排试，开发者定时长”。开发者要求先推进，这里按推荐定了一个令牌，改时长只改 `tokens.css` 一处（读时长的 JS 也改成读令牌，见下），进了待确认。没有做 Lab 对比场景。

实现审查（一个 Sonnet，[`evidences/impl-review.txt`](evidences/impl-review.txt)，7 条：重要 3、建议 4）：

| 条 | 判定 | 处理 |
|---|---|---|
| 1 资源树的过渡窗口短于动画 | 成立（审查者在真实 Chrome 复现了离开的行闪回） | 窗口按 `--motion-move` 算，拖影飞回取大者 |
| 2 nb-story 写死 240ms | 成立 | 运行时读 `--motion-move`，加余量 |
| 3 档位顺序打乱 | 成立 | `--motion-enter` 提到 320 到 340ms：大位移入场还是控件里最慢的一档；顺序改成 `fast < base < move < enter < layout`，基线和四个主题都查（`tokens.test.ts`）；写明 `move`、`layout` 不随主题变 |
| 4 漏网 | 成立，部分不改 | `Select`、`SearchSelect`、`ProviderDetail`、`ModelEditDialog` 的 chevron 补上；`nb-markdown` 写死的 `120ms ease` 换令牌；`DropFeedbackOverlay` 的半区照旧 `--motion-base`，写明理由（要跟上指针）；只变颜色、没写曲线的不补，设计语言改了说法；playground 不动 |
| 5 文字没跟上 | 成立 | Splitter 注释、`TabStrip.md`、`ExplorerTree.md`、`files-explorer.md` |
| 6 令牌表与合同测试 | 成立 | 归零名单补全，`nbMotionTokens` 补对话框的三个 |
| 7 菜单、对话框入场的短时长没有实测 | 接受取舍 | 进待确认，开发者试手感时一起看 |

## 下一步

开发者试了手感之后定 `--motion-move`。
