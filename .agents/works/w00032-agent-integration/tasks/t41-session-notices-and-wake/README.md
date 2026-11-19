---
schema: nbook.task/v2
taskId: t41-session-notices-and-wake
status: planned
updated: 2026-11-19
---

# 内核缓冲区的提示与会话级唤起门

## 目标与范围

按已接受的[提案“统一后台任务”](../../../../../docs/proposals/unified-background-tasks.md)第四节第 1 小节与 [ADR 0056](../../../../../docs/adr/0056-background-work-providers-and-session-notices.md) 改 nb-harness 内核：

- 缓冲区的提示：在取插话的同一处取走、同一次请求里排在插话与新话前面（可以调整现有边界的先后）；不进输入的就绪与留着；会话级、一直待发；渲染成带来源行的 `<system-reminder>`；不算授权、不解除守卫；单条与会话合计的上限、与输入共用快照预算；`key` 替换、发出者撤回、用户取消；预览只读显示。
- 唤起：受理时与每个收口批里判；收口时只开一次后继运行，推迟的用户的话优先、提示随它带上；唤起的提示在第一次请求前全被撤回时不发空请求。
- 门挂在会话上：停止受理、非正常结束时关，用户自己的发话、继续、放行真正开起运行时开；回退、换分支、压缩不开；旧日志的初值。
- 提示与插话同等对待；“取走后那次请求没发出去就放回缓冲区”简单就一起做，复杂就接受限制（开发者 2026-11-19）。

合同：改 [`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md)、[`harness/session.md`](../../../../../docs/specs/harness/session.md)（先写 planned）。

依赖：无。t22 的结果送达与 eval 的提示依赖本 Task。

## 输入

两轮提案审查（证据在 [t22](../t22-background-work/README.md) 的 `evidences/`）里归本 Task 的：

- [第一轮](../t22-background-work/evidences/proposal-review-r1.txt)：1、2、3、4、9、20、23（多数已在第 2、3 稿处理，作背景）。
- [第二轮](../t22-background-work/evidences/proposal-review-r2.txt)：1（取的位置与先后）、2（Profile 裁历史）、3（收口只开一次运行）、5（开关门的受理边界）、6（出错也关门）、7（快照预算）、8（唤起被撤回后不发空请求）、9（只有提示时的预览）。

## 当前状态

2026-11-19 经 nbdev 新建，尚未开工。

## 下一步

开工时先在 `packages/nb-harness` 用真实内核写探针，列出：取插话、取新话、压缩、组请求在边界上的先后；会话进入空闲与开后继运行的全部路径；停止受理到收口之间各指令的去向；再写 planned 的 Spec 与计划，交设计审查。
