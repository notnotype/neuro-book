---
schema: nbook.task/v2
taskId: t21-hover-cpu
status: done
updated: 2026-11-26
---

# 不按键划过界面时 CPU 高

## 目标与范围

开发者 2026-11-07 观察到鼠标快速划过界面时 CPU 从 1% 飙到 50%，要开 Task 查清原因并降下来。

行为合同不变，只降开销。

## 当前状态

已修两处，合入 master。改动小、只在分隔线两个文件里，没另做实现审查。证据 [`evidences/hover-cost.txt`](evidences/hover-cost.txt)。

- 每划过一条分隔线，光标所有权往 `head` 插一张样式表、离开时移除，每次整页重算。改成第一次插入后常驻，只切根上的属性。
- Vue 每次更新都重新调用 `SashHandle` 的函数 ref，每次都排一遍对齐，所有分隔线重量。改成元素真的换了才排。

400 次移动的样式重算时间约 442ms 降到 214ms，主线程任务约 995ms 降到 754ms。nb-ui 里那份分隔线代码有同样的样式表问题，一并改了。

验证：nb-layout `splitter.dom.test`、`NestedGrid.dom.test`，nb-ui `splitter.test`，两包类型检查；e2e `lab-grid-structure`、`lab-nested-grid`、`lab-grid-panels`、`lab-workbench-surface`、`editor-area`、`workbench-views` 144 项通过。

没解决的：开发者量到 CPU 50%，这里主线程约 11%，差额可能在 GPU 进程与合成，无头环境量不到。

## 下一步

请开发者在真实 Chrome 里录一段划过界面的 Performance（勾上截图与 GPU），看剩下的开销在哪。

## 收尾

2026-11-26 w00026 收尾时核对：两处修正已合入 master（`911f98955`）。“下一步”请开发者录 Performance 的那一项没有留下结论，随 Work 收尾关闭；以后再觉得划过界面卡，另开 Task。
