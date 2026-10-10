---
schema: nbook.task/v2
taskId: t74-workbench-titlebar
---

# 外壳四：标题栏与状态栏

## 目标与范围

开发者 2026-10-10 要求完善 web 主页面的外壳，把旧应用的标题栏迁过来，迁移中可以排错、优化与调整样式。现在的标题栏只有“NeuroBook”和项目短名两段文字；状态栏只有项目名与“显示面板”，也没有让插件放条目的接口。外壳 Spec 把这些明确留到外壳一到三之后：标题栏的菜单、搜索、窗口控制，以及状态栏与标题栏条目的贡献点。

拟定范围（计划在 t73 确认后起草）：

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

## 前置

[t73](../t73-lab-nb-ui-and-storage/README.md)。

## 当前状态

- 2026-10-10 建立，未开工。
