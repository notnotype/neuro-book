---
schema: nbook.task/v2
taskId: t63-sash-size-neighbors
status: done
updated: 2026-11-26
---

# 分隔线宽度的函数也拿到两侧节点（摩擦 16、17）

## 目标与范围

sashSize 函数多收 {before, after}，与 sashDisabled 认分隔线的办法一致；ide 示例按挨着按钮条判，不再按分支 id 加序号写死

合同：包文档 `grid.md` 的“建树”（Spec 没有写分隔线宽度函数的签名）；t50 摩擦第 16、17 条。

## 结果

2026-11-26 完成，改动小，主会话自己写、自己验证并合入（`1f03e51ad`，变基后合入）：

- `GridSashResolver` 挪进 `grid-types.ts` 当唯一定义（`GridOptions.sashSize` 原来另写了一份同形的函数类型），多收第三个参数 `{before, after}`：挨着这条线的两个直接孩子的 id，与 `NestedGrid` 的 `sashDisabled` 同一个认法；只用前两个参数的函数照旧可用（nb-story 的 `book-grid.ts`、Lab 的验收场景不用改）。
- ide 示例：条旁的线改成“挨着按钮条的给 0”，不再按“`main` 的第 0、3 条、根的全部”写死；核对过树形，结果与原来相同（`examples-ide.test.ts` 的 `sashSizes` 断言照过）。
- 用例：`grid.test.ts`“sash 宽度的函数拿到挨着线的两个直接孩子”：三块里挨着 c 的线给 0，断言函数收到 `root:0:a|col`、`root:1:col|c`、`col:0:t|u`，在 c 前面插一块后序号变了照样是挨着 c 的那条为 0。
- 变异：给函数传空的两侧，新用例与 ide 示例的 `sashSizes` 用例都失败。
- 验证：nb-layout 全量测试、typecheck（含示例）、`api:check`（报告已重新生成），nb-story 与应用 typecheck，SDK 快照测试，都过。没跑 ide 示例的 e2e：线宽与原来逐条相同，单测断言了。
