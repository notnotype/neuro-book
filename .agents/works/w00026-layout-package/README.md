---
schema: nbook.work/v1
workId: w00026-layout-package
issueId: null
status: active
updated: 2026-11-05
---

# 布局工具独立成包

## 目标

把 Grid、Splitter 与拖放落点这类布局工具从 nb-ui 拆成单独的包 `@notnotype/nb-layout`，并用它重做工作台的布局：外壳、视图容器和编辑组合成一棵树，内容改成按矩形摆放在同一层，拖动同时支持 VS Code 模式和 Trellis 模式，支持浮动 View 与编辑器标签（应用内做完，操作系统级先验证），并做竖屏手机呈现（验证级）。决定与调研见 [t01](tasks/t01-requirements/README.md)
