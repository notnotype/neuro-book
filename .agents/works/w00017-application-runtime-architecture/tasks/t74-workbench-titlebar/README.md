---
schema: nbook.task/v2
taskId: t74-workbench-titlebar
---

# 外壳四：标题栏与状态栏

## 目标与范围

开发者 2026-10-10 要求完善 web 主页面的外壳，把旧应用的标题栏迁过来，迁移中可以排错、优化与调整样式。现在的标题栏只有“NeuroBook”和项目短名两段文字；状态栏只有项目名与“显示面板”，也没有让插件放条目的接口。外壳 Spec 把这些明确留到外壳一到三之后：标题栏的菜单、搜索、窗口控制，以及状态栏与标题栏条目的贡献点。

实施计划见 [plan.md](plan.md)。拟定范围：

- **标题栏**：迁移旧应用 `DesktopTitleBarShell` 一组零件（`packages/neuro-book-legacy/app/components/desktop-title-bar/`），按新应用的命令重新接线：
  - 品牌；
  - 菜单：文件、编辑、视图、帮助，每项是一条命令；
  - 居中命令搜索：点开命令面板；
  - 项目切换：与 t75 书架共用作品列表；
  - 布局按钮：侧栏、面板、右栏。
  - 桌面窗口控制等有了桌面宿主再做。
- **贡献点**：状态栏条目、标题栏操作。第一批使用者从编辑器区与资源管理器里选，例如光标位置、未保存数量；只显示真实数据。
- 每个迁移的组件带同名 `.md` 与 Lab 场景。

行为合同：[`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md)（新增“外壳四”）、[`workbench/commands.md`](../../../../../docs/specs/workbench/commands.md)。

## 计划须回答的问题（t73 计划审查，2026-10-10）

omp 审查（报告在 [t73 证据](../t73-lab-nb-ui-and-storage/evidences/design-review.txt)）对本 Task 的范围提出的条目，写计划时逐条回答：

- **P07 菜单映射**：旧标题栏 15 个菜单 id 逐个对到新命令。每项写明是现成命令、需要参数适配的命令、浏览器里不画，还是留待以后。
  - 例子：`file.open` 不能直接别名到要求 `{address, mode}` 的 `nbook.editor.open`；
  - 剪贴板、退出、缩放这类桌面动作，在浏览器里不画成假入口。
  - 菜单由“能力模型”生成：每项带 canonical 命令、可见条件、禁用原因、参数工厂（F04）。先写纯模型测试，再迁 Vue 零件。
- **P08 贡献点合同**：先在外壳 Spec 定义 `workbench.titlebar-items` 与 `workbench.statusbar-items`，内容包括：
  - 声明、实现、排序、槽位，`when` 与公开状态；
  - 同 id 冲突、插件停止时撤回、窄屏按优先级折叠（F05）；
  - 外壳不直接读领域状态，条目数据由 owner 经公开状态提供。
- **P09 验收**：要验收以下几项：
  - 标题栏 36px、状态栏 22px，菜单从完整到紧凑的切换阈值；
  - 无项目时的呈现，以及编辑焦点在编辑器、原生输入或别处时的禁用原因；
  - 菜单的键盘与焦点行为；
  - 未实现的项不渲染。

## 前置

[t73](../t73-lab-nb-ui-and-storage/README.md)。

## 当前状态

- 2026-10-10 建立，未开工；t73 计划审查对本 Task 的三条意见见上。
- 2026-10-10 计划起草（[plan.md](plan.md)），逐条回答 P07–P09、F04、F05；交 omp 计划审查。
- 2026-10-10 omp 计划审查（一个会话）：13 条（阻断 1、重要 11、建议 1）与补充功能 3 条，全部成立，报告 [evidences/plan-review.txt](evidences/plan-review.txt)。计划按审查修订，处理表在 plan.md 的“计划审查的处理”。主要变化：
  - 菜单作用于活动编辑器，不按焦点区分（P1）；
  - 宿主增加“重新载入”和“新标签打开”两个端口（P2）；
  - nb-ui 菜单的叶子项接入 reka 的导航集合，菜单项增加 `description`，单独成为 S1（P3、P7）；
  - Part 的可见性定义与公开键（P6）；条目的公开键与溢出预算（P8、P11）；宽度三档，任何宽度都保留菜单入口（P10）；
  - 跳到行不接（P9）；光标位置只在源码编辑器显示，另加字数条目（P12）；快捷键按平台格式化（P13）。
  - 产品取舍登记在 [待开发者确认](../../pending-confirmations.md)。
- 2026-10-10 S0 完成（Spec，新增条目都标“planned”）：
  - `ui/workbench-shell.md`：新增“外壳四”输出 28–35（标题栏结构、应用菜单的能力模型与条目表、宽度三档、菜单键盘与焦点、Part 可见与 `set-part-hidden`、三个可见性公开键、条目贡献点、溢出、状态栏布局），验收 32–39；非目标改为只剩桌面窗口控制。
  - `workbench/commands.md`：`set-part-hidden`、应用命令 `nbook.app.reload` 与 `nbook.help.documentation`、快捷键的显示、旧桌面 15 个 id 的去向；验收 17、18。
  - `workbench/editor.md`：两个公开键、三个状态栏条目（输出 26–28，字数算法与光标坐标）；验收 12–14。
  - `runtime/browser-host.md`：`windowNavigationKey` 的 `reloadDocument`、`openExternal`。
