---
schema: nbook.task/v2
taskId: t21-end-key-after-ruby
status: planned
updated: 2026-11-11
---

# 一行里有注音时 End 键到不了行尾

## 目标与范围

一行里有注音时，按 End（以及 Shift+End）光标停在注音后面，到不了行尾；t20 取证时在 master 上复现，不是 t20 引入的。查根因，修到 Home、End、Shift+Home、Shift+End 在带注音的行里都停在行首、行尾

合同：待补充（链接具体 Spec，或说明行为合同是否改变）。

## 当前状态

2026-11-11 经 nbdev 新建，尚未开工。

## 下一步

待补充。
