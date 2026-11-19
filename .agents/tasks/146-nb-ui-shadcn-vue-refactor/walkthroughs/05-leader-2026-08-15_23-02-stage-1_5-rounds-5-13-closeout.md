---
schema: nbook.task-walkthrough/v1
taskId: 146-nb-ui-shadcn-vue-refactor
sequence: 5
role: leader
status: completed
createdAt: 2026-08-15T15:02:00Z
---

# 阶段 1.5 第 5–13 轮收口报告

日期：2026-08-15。工作仓：sibling `nb-ui`，分支 `refactor/t146-reka-tailwind-base`。主仓本轮只追加 Task 146 文档，零业务改动。

状态：**已完成**。`nb-ui` 的最终收口提交为 `a8ae8fe`：`fix(ui): make popover highlights translucent and route control radii through the token`。该提交包含 21 个文件，含必须随源码提交的 `dist/nb-ui.css`；没有 push、PR 或 merge。

## 轮次边界与可核验提交

Task 146 现有四份历史 walkthrough 覆盖阶段 1、设计语言实验室、主题系统和产品主题定稿。第 5–12 轮没有独立持久交接文件，不能诚实地建立“一轮一个提交”的映射；本报告按现存 Git 提交、代码、设计语言文档和临时浏览器证据归档，不把推断写成逐轮事实。

可核验的提交检查点如下：

1. `156bca8 feat(themes): make nbook the product theme and wire glass into real components`：产品默认主题改为从 `macos` 衍生的 `nbook`，主题阵容收为 `nbook` / `macos` / `editorial` / `aurora`；浮层基座接通真实组件；FormSelect 改为 Reka Select；两个 TimePicker 实现补齐 body Teleport、点外关闭和滚轮/列表交互；初版设计语言文档落地。
2. `2a528c3 fix(themes): make nbook's popovers read as glass instead of a gradient`：移除小浮层面上的镜面渐变，保留边缘内线；strong blur 收口为 14px，tint / brightness 取值同步收口，修正玻璃被读成渐变板的问题。该提交的统计为 4 个文件，不把后续 `--overlay-item-active` 误归入此提交。
3. `136e488 fix(ui): derive popover item radius from the panel so the corners stay concentric`：建立 `--nb-popover-pad` / `--nb-popover-inner-radius` 几何登记处，浮层项统一消费 `.nb-ui-popover-item`；nbook 下外框 20px、描边 1px、内边距 6px，内层半径为 13px。
4. `a8ae8fe`：完成本轮三项收口和两处文档勘误，形成当前可审查状态。

## 第 13 轮收口内容

1. **玻璃浮层高亮半透明化。** 新增 `--overlay-item-active` 主题角色；库裸 `:root` 退回 `var(--bg-hover)`，nbook 从 `--text-main` 派生 `color-mix(in srgb, var(--text-main) 12%, transparent)`。`prefers-reduced-transparency` 和 `prefers-contrast: more` 两个无障碍块写回不透明 `var(--bg-hover)`。Dropdown、ContextMenu、Combobox、FormSelect 的浮层交互态消费该角色；TimePicker 只有 hover 消费该角色，selected 仍保留 `--accent-bg`。
2. **控件圆角接通 token。** Button、IconButton、Pagination、SegmentedControl 外框、SwitchField、Combobox、FormInput、FormNumberInput、FormSelect、FormTextarea、TagInput、FileTree 的控件外框消费 `--radius-control`；SegmentedControl 的贴角段使用 `max(2px, calc(var(--radius-control) - var(--border-w) - 2px))`。不贴外框角的内部形状、Skeleton、Notification、Panel 保持独立圆角。
3. **滚动层下沉。** Dropdown 外框只负责浮层外观与 `overflow: hidden`，新增 `role="none"` 的 `.nb-ui-popover-scroll` 内层；Combobox 让原有 `<ul role="listbox">` 承担滚动。键盘导航、ARIA id/role、Portal 和定位行为未改。

本轮不改亚克力 blur / tint / brightness，不改 `themes/macos/`；第 12 轮对配方的 A/B 试验没有形成新的采纳值，当前 strong 档仍为 14px。

## 文档勘误

- `nb-ui/docs/design-language.md` 的坑 #44 和 §八几何检查表不再声称 `src/components` 全库不能出现 `rounded-md`。判据现在限定为控件外框必须消费 `--radius-control`，并明确 Skeleton、Notification、Panel 和不贴外框角的内部形状不纳入该迁移判据。
- `nb-ui/docs/authoring-themes.md` 的 `--window-backdrop` 示例从 `macos` / `aurora` 两套声明方更正为 `macos` / `aurora` / `nbook` 三套；变量迁入配色契约仍保留为阶段 2 的 TODO。

## 代码门禁

在 `C:/Users/<user>/Documents/CodeRepository/GithubProjects/nb-ui` 串行执行：

| 命令 | 结果 |
| --- | --- |
| `bun run test` | `Test Files 11 passed (11)`；`Tests 173 passed (173)` |
| `bun run typecheck` | `nuxt prepare playground && vue-tsc --noEmit` 完成，无诊断 |
| `bun run build:css` | Tailwind CSS v4.3.3 成功重建 `dist/nb-ui.css` |
| `git diff --check` | 通过；仅有 Windows 工作树 LF→CRLF 提示，无空白错误 |

## 真实 playground 验收

3000 端口已有服务，本轮使用 hub 启动的 `nbui-dev-3001`，实际 HTTP 页面为 `http://localhost:3001/`。探针副本和截图均保存在系统临时根，不进入仓库：

- `C:/Users/<user>/AppData/Local/Temp/neuro-book/nbui-select-probe-9f3c/round13-verify-3001.js`
- `C:/Users/<user>/AppData/Local/Temp/neuro-book/nbui-select-probe-9f3c/round13-menus-3001.js`
- `C:/Users/<user>/AppData/Local/Temp/neuro-book/nbui-select-probe-9f3c/round13-colorways-3001.js`
- `C:/Users/<user>/AppData/Local/Temp/neuro-book/nbui-select-probe-9f3c/seg-check-3001.js`

实际结果：

- FormSelect：外框 `20px`、padding `6px`、`--nb-popover-inner-radius` 为 `max(2px, calc(20px - 1px - 6px))`，外框 `overflow: hidden`，viewport `overflow-y: auto`、13px，5 个选项半径均为 13px、宽度均为 520px；高亮背景为 `color(srgb … / 0.12)`。
- Dropdown：外框 20px / padding 6px / hidden；内层存在、`role=none`、13px、auto；4 个菜单项均为 13px。
- ContextMenu：外框 20px / padding 6px；4 个菜单项均为 13px。
- 真实 `SegmentedControl`（`/components`，等待 hydration 后读取）：外框 10px，段 7px。最初对 `/` 运行的通用 `[role="group"]` 选择器命中了手写对照页 `.sc-seg`，读到其独立的 8px；该结果不是库组件，已用真实组件探针复核，不作为实现失败。
- NeuroBook 昼 / 夜：`--overlay-item-active` 的实际高亮背景均为 alpha `0.12`；昼色从深色 `--text-main` 派生，夜色从浅色 `--text-main` 派生。backdrop 仍为 strong 14px，分别保留亮色 `brightness(1.14)` 与暗色 `brightness(0.72)`。
- Playwright 控制台：0 errors、3 warnings；截图为 `r13-day.png` / `r13-night.png`，仍在上述系统临时目录。

## 边界与未运行项

正式阶段 1.5 已收口，正式阶段 2 尚未开始；本轮提前完成的 FormSelect、TimePicker、浮层基座、控件圆角和滚动层债务不代表阶段 2 已启动。`--window-backdrop` 配色契约迁移、主题市场分发与审核、主仓 `link:` 反向验收、主仓业务测试和 docs build 仍未运行或未完成，按 README 的既有 TODO 保留。主仓本轮未运行业务测试或文档构建，也未提交主仓 Task 目录。
