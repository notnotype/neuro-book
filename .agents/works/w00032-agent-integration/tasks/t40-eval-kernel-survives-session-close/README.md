---
schema: nbook.task/v2
taskId: t40-eval-kernel-survives-session-close
status: active
updated: 2026-11-19
---

# eval 内核在会话关闭后保留，重置原因写准

## 目标与范围

会话关闭不再结束 eval 内核：内核照样按 30 分钟空闲与 8 个上限回收，会话再打开、叶子与 Profile 没变时接着用；重置提示的原因写准（关闭期间被空闲回收或被回收、换了 Profile、意外退出各写各的）。来源：开发者 2026-11-19 在 t21 交付后的问答里确认（不做内存转储）。

合同：待补充（链接具体 Spec，或说明行为合同是否改变）。

## 当前状态

2026-11-19 经 nbdev 新建，尚未开工。

## 下一步

待补充。
