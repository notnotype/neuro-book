---
schema: nbook.task/v2
taskId: t03-ui-guide
status: active
updated: 2026-11-26
---

# 第一批实现：快照、界面目录、截图与引导（ui 对象）

## 目标与范围

按 t01 设计稿第四稿与 Spec agent/page-agent 实现 eval 全局对象 ui 的第一批：选当前窗口、文字快照与引用、稳定名、界面目录、截图、高亮引导与等用户；先补内核、harness、agent、设置与工作台的上游缺口

合同：[`agent/page-agent.md`](../../../../../docs/specs/agent/page-agent.md)（planned，新建）；上游几份 Spec 的 planned 条目见 [plan.md](plan.md) 的“Spec 与文档改动”。计划：[plan.md](plan.md)。

## 决定

| 编号 | 日期 | 决定 |
|---|---|---|
| 1 | 2026-11-26 | 稳定名由控件的拥有者写 `data-nb-target`（工作台与设置窗口的六处各加一行），删掉 page-agent 的映射表；按命令定位统一成同一对属性。取代 t01 决定 14 的“自动层”（计划审查整体视角第 5 条，开发者选“拥有者自己写”） |
| 2 | 2026-11-26 | 切片按功能分两轮：先把快照、目录、截图做通到真实应用并派第一段 e2e，高亮所需的 harness 改动与说明框放第二轮；说明框的静态稿写完 Spec 就出、与第一轮并行；每项上游改动单独提交（计划审查整体视角第 7 条，开发者选“按功能分两轮”） |
| 3 | 2026-11-26 | 选窗口只选打开会话所属作品的窗口；会话不属于作品时只选不绑定作品的窗口（Opus 第 6 条、整体视角第 6 条，开发者选“只选同一作品的窗口”） |

开发者 2026-11-26 对计划第一版的原话：“没问题”（确认先补上游的顺序、三个新依赖、e2e 分两段交子代理）；顺序已被决定 2 取代。

## 当前状态

- 2026-11-26：Spec 草稿与计划第一版提交（cf89b6a38）。计划审查：Opus、Sonnet 前端、Sonnet 整体三份已处理（[处理记录](evidences/plan-review-disposition.txt)），omp `@review` 在后台跑；计划改到[第二版](plan.md)，Spec 同步修订（bf94b13f5）。
- 第 1 片（上游 Spec 的 planned 条目）在 master 上提交（b3c875f37）。
- 第 3 片（nb-runtime：服务端列实例、服务端订阅在成员链路断开时以 `target-gone` 结束）在 Work 分支提交（d230b10c8），`remote` 目录 97 个测试与 nb-runtime 类型检查通过，两处改动各做了变异检查。
- 第 2 片：静态稿在草稿 worktree `.worktree/w00033-t03-drafts`（分支 `w00033-t03/drafts`，不合并），`@designer` 的意见已取舍；[评审板](artifacts/review/index.html) v1 已发布，两道题等开发者答复。

## 下一步

1. 读评审板的答复，决定写进本文件，再定稿说明框与 Profile 对象行的规则（补进 `profile-settings.md` 输出 28 的细则）。
2. 第 4 片：拥有者的只读目录、稳定名、悬停显示规则、消息列表的 skip。
3. omp 报告回来后按快速审查处理，修正单独提交。
