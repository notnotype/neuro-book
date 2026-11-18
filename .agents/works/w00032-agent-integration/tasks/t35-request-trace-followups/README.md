---
schema: nbook.task/v2
taskId: t35-request-trace-followups
status: planned
updated: 2026-11-15
---

# 模型请求查看器的后续：t30 没做的几项

## 目标与范围

[t30](../t30-model-request-trace/README.md) 收口时没做的几项，开发者 2026-11-15 定：统一新建一个 Task 以后做。

Spec 里已标“（planned）”的（[`agent/request-trace.md`](../../../../../docs/specs/agent/request-trace.md)）：

1. 输出 27：页面关掉之后再打开时从全部开始。难点：编辑区切走页签时页面组件也会卸载，又没有“页签关了”的信号，分不清关页与切走；要先给编辑区加“页面开着”的公开状态（合同在编辑区的 Spec）。
2. 输出 28：查找词是 `#N` 时结果顶上多一项“跳到 #N”。
3. 输出 29：消息页按轮分段；长消息展开时先露前几行、“看全文”看完；按角色筛选（“提醒”要内容的来源才分得出，先查记录里有没有）；从查找打开时多一个“有命中”的筛选。
4. 输出 30：比较页列出变了的系统提示词与工具的逐行差异。
5. 输出 31：响应页可以复制。

Spec 里没写、t30 的计划里有的：

6. 查找条里回车、Shift+回车跳下一处、上一处。
7. 窄屏：宽窄切换的迟滞（在边界上来回拖不来回跳），切换时保留列表的滚动位置。

t30 记为已知限制、要不要做开工时再定：比较的候选只来自已加载的行；英文界面用途徽标宽度不一（要对齐得把列表改成共用的 grid）。

合同：改 [`agent/request-trace.md`](../../../../../docs/specs/agent/request-trace.md)，做完的条目去掉“（planned）”；第 1 项另改编辑区的 Spec。组件文档 `AgentRequestTrace.md`、`AgentRequestDetail.md`、`AgentRequestList.md` 的“不支持”同步改。

## 当前状态

2026-11-15 新建，尚未开工。

## 下一步

开工时先写计划（第 1 项要先定编辑区的“页面开着”状态怎么给）。
