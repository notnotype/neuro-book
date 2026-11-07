---
schema: nbook.task/v2
taskId: t03-failure-projection
status: active
updated: 2026-10-27
---

# 失败投影与切片设计

## 目标与范围

依据 t02 的通道矩阵，设计“给用户看的失败投影”，并把开发诊断改英文按错误域与通道切片（不按包）：

- 码从哪来；插件自定义的失败码怎么带文案（消息键是拥有者命名空间加码，文案在拥有者的目录里）；未知码显示通用说明并附码；
- `NotificationInput`、命令结果的 `reason`、跨进程 detail 这些字符串槽改成码加结构化参数；
- 共用的校验函数（例如 nbdev 后端与面板共用的中文校验）改成返回问题码加参数，CLI 与网页各自拼文字；
- 领域工具在 `details` 里给结构化 `code`，按码写中文说明；harness 只保证 `isError`、原样记录、字段不丢；
- `nbstory` 分三层：提示词与工具说明、给人看的输出（中文产品文案）、`--json` 与 API 的 `message`（要版本化，或拆成 `message` 与 `detail`）；
- 旧持久化数据怎么读；不按旧文案猜码；
- 诊断构造入口带类型，机检检查入口而不是按中文判断。

产出：提案与 Spec 修改，切片清单与每片的验收（直接消费者、真实子进程、会话与 QA 读回、CLI JSON）。

合同：会改 [`workbench/commands.md`](../../../../../docs/specs/workbench/commands.md) 的失败结果、[`agent/harness.md`](../../../../../docs/specs/agent/harness.md) 的工具结果、[`story/cli-skill.md`](../../../../../docs/specs/story/cli-skill.md) 的 JSON 输出等；开工时补全清单。

## 当前状态

计划：[plan.md](plan.md)（自主推进，2026-10-27 开工）。

计划审查（2026-10-27）三份，有效 34 条，阻断 0：omp 9 条（`evidences/plan-review-omp.txt`）、Claude Sonnet 前端 15 条（`evidences/plan-review-sonnet-frontend.txt`）、Claude Sonnet 拉远看 10 条（`evidences/plan-review-sonnet-zoom-out.txt`）。三份共同的结论是：计划在 w00028 的目录机制之前就定了消息键与文字表，同一批文字要迁两次；也缺几个共用的小件（失败值类型与参数上限、未知码的中性兜底、界面的“详情”载体）。这些要先和 w00028 t01 一起定，属于推进顺序的调整，按自主推进的规则停下等开发者。其余发现（命令失败原因的模型、用户要照着改的校验原因算哪类读者、给模型的失败文字与英文诊断的冲突、B4、命令行三层、旧数据载体、线协议版本、切片依赖、待定项的推荐）等顺序定了再随修订后的计划处理。

开发者 2026-10-27 同意先做 w00028 t01（扩大范围），并定了失败页语言、nb-story 网页、nbdev 面板三项（Work README 第 7 到 10 条）。本 Task 暂停，等 w00028 t01 定稿后按错误域重写计划；现在的 `plan.md` 作历程保留。

## 载体合同（2026-11-07，来自 w00028 t04 计划审查）

通知的详情载体（w00028 t04）只接收已脱敏、有界（载体截到 8000 字符）的字符串 `detail`。本 Task 的失败投影要在进入通知之前把码与参数投影成这个字符串，不得把 `NotificationInput.detail` 改成别的形状；载体不脱敏，脱敏是诊断提供者的责任。

## 下一步

w00028 t01 与 t03 已完成（2026-10-29）。2026-11-07 开发者同意的顺序：先做 w00028 t04（“详情”组件），再按错误域重写本 Task 的计划与切片。
