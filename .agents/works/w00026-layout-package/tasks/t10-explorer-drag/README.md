---
schema: nbook.task/v2
taskId: t10-explorer-drag
status: done
updated: 2026-11-05
---

# 资源树拖到编辑区与浮动打开

## 目标与范围

优先级低。实现 t01 决定 5：拖到编辑组时中央打开、标签条插入、四边拆分；拖到无落点时浮动打开；窗口外在 5 秒内开独立窗口（依赖 t12 的结论），否则回退成应用内浮动。树内保持 VS Code 模式。实在难就全程用 VS Code 模式。

合同：[files-explorer](../../../../../docs/specs/workbench/files-explorer.md)、[workbench-layout](../../../../../docs/specs/ui/workbench-layout.md)。计划见 [`plan.md`](plan.md)。

## 当前状态

2026-11-07 已合入（`a952343fc`），实现审查待处理。

- 验证：`test:affected --since master --typecheck` 只有已知失败；e2e：`files-explorer`（新增“文件拖出树”一条，覆盖中央、标签条、外缘、没有落点、树所在的面板、活动栏、目录）、`workbench-float`、`editor-area`、`lab-editor` 全过。
- 和计划不同的地方：`DropAction` 里不放 `host`（Lab 夹具的输入按 JSON 类型检查，函数放不进去），`host` 只在 `DropOver` 上。窗口外松手没有写 e2e：Playwright 里鼠标移出视口的行为没试，代码上和状态栏同一条路径。
- 没做的：文件来源的实时布局（进了待确认）。

设计审查（一个 Sonnet，[`evidences/plan-review.txt`](evidences/plan-review.txt)，13 条：阻断 1、重要 6、建议 6），计划照改：

| 条 | 判定 | 处理 |
|---|---|---|
| 1 `shared/` 带 DOM 类型 | 成立（已复现） | 负载不写 `Element`、`./vue`；`top` 是 `unknown`，反馈归外壳，负载里没有 preview |
| 2 和提案第 3 节不一致 | 成立 | 保留两个会话，进待确认，提案追加决策记录 |
| 3 `floatDrop` 对 `new` 不通 | 成立 | 判定拆三个入口，`new` 不查文档 |
| 4 标签条插入的时序 | 成立 | 打开之前固定 `before`，`samePlace` 算成功，键带 `part` |
| 5 反馈谁画 | 成立 | 外壳画（改法 B）：资源树只报落点 |
| 6 自己的面板误开窗 | 成立 | 拖动源那块面板里取消，进待确认 |
| 7 判据被替换 | 成立 | Spec 写明被替换的判据 |
| 8 `new` 进 `LayoutSource` | 成立 | 单独的 `LayoutDropSource` |
| 9 失败与多文件 | 成立 | 遇拒绝就停；不做关空组的回退 |
| 10 缓存 | 成立 | 文件这一路不用缓存、冻结与预备区 |
| 11、12 接口与文档清单 | 成立 | 补全 |
| 13 验收写不出来 | 成立 | 对话框一条不写 e2e |

## 下一步

处理实现审查的报告。
