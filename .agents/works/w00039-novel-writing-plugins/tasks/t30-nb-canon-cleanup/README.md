---
schema: nbook.task/v2
taskId: t30-nb-canon-cleanup
status: planned
updated: 2026-11-04
---

# nb-canon 整理

## 目标与范围

在加内置 Component（t10）之前，把 t29 可维护性与 API 形状审查里“成立、不改行为”的整理做掉，让加补丁种类、加服务方法、改引擎规则时要改的地方变少。差分测试（增量引擎等于整本重算）与现有的 Spec 测试兜底。

范围是 [t29 审查处理](../t29-kernel-impl/evidences/api-review-resolution.txt)里“留给后续的整理”一组：

- 补丁种类的语义集中成一张表，套用里两份加法合成一个；
- 地址路径的解析只留 `parsePath` 一份，覆盖判断只留一份；
- 两个引擎共用的规则抽到 `engine/shared`（语义档起点、按计划纳入哪些计划、待处理的拼装、Point 与排序），生产代码不再从 `reference.ts` 导入；
- 服务的失败统一成 `{ok, value | failure}`，失败码按方法给联合类型，远程层不再逐个拆装；参数形状统一；
- 放对象 id 的键从 schema 反推或有测试守住；临时 id 与局部 id 的前缀导出；
- `world.ts` 按职责拆分；`WorldService` 里几处小重复；
- 宿主装配：日志目录布局与端口收成一个打开函数，第二个宿主不必照抄；
- 公开面收窄（主入口 93 个运行时导出，应用只用到 1 个）。

不在范围：同一份处理里“留给作者界面与 Agent 工具”的一组（要按实际用法定，归 t16、t20）；内存优化（待确认清单里的已知限制）。

合同：行为合同未变（Spec `docs/specs/canon/` 不变）；失败形状的统一若改到远程合同（`nbook.canon/world`）的结果形状，先改 Spec project 再改代码。

前置：t29（分支 `feat/w00039-t29-canon-kernel`）。

## 当前状态

2026-11-04 经 nbdev 新建。开发者同日同意按推荐单开这个 Task，在加内置 Component 之前做（Work README 决定表）。

## 下一步

排期随 Work 的讨论顺序定；开工时在 t29 的分支上（或基于它的分支）做，内核分支合并前不进 master。
