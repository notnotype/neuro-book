---
schema: nbook.task/v2
taskId: t52-grid-structure-semantics
status: planned
updated: 2026-11-22
---

# nb-layout 结构操作的语义：不压固定栏、展平与拆分继承尺寸规则、setSize

## 目标与范围

从 t51 拆出（开发者 2026-11-22 定的“原地增删不压固定栏、加设宽度入口”）：addLeaf、removeLeaf、moveLeaf 只让按比例分的兄弟让出或吸收；展平单孩子分支与 splitLeaf 继承被替换节点的 sizing、约束与收起策略；按比例分的意图单位写清（addLeaf 收份额）；grid.setSize 与宿主一次改多步的入口。依据 t51 两份审查（evidences/design-review.txt 第 3、4、5 条，api-review.txt 第 4、5、6、7、8 条）。

合同：待补充（链接具体 Spec，或说明行为合同是否改变）。

## 当前状态

2026-11-22 经 nbdev 新建，尚未开工。

## 下一步

待补充。
