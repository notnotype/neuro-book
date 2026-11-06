---
schema: nbook.task/v2
taskId: t28-conversation-ui-followups
status: planned
updated: 2026-11-06
---

# 对话界面第二批：分支树、上下文检查器、附件、草稿、触发符与 Agent 模式

## 目标与范围

t17 第一版之后补齐对话界面：分支树、简版上下文检查器、附件、草稿、斜杠命令与 $ @ 触发符、模式菜单里的 Agent 模式

合同：[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md)；决定见 [t17](../t17-conversation-ui/README.md) 第 5、6、7、8、12 条。依赖：t17 第一版；Agent 模式要 t06，`$` 要 t15，`/compact` 要 t11。

## 开发者体验反馈（2026-11-06）

开发者上手后的反馈里，和输入框、状态栏相关的并进本 Task：

- 配置完模型角色后当前会话没有立刻更新，还显示要先绑定模型角色。
- 输入框要有模型选择组件，模型选择、推理档、模型角色选择一体（旧应用做过）。
- 缓存命中率要能在状态栏显示，点进去能看上下文详细情况。

其余记到 [t29](../t29-ui-polish-after-t15/README.md)。

## 当前状态

开发者 2026-11-06 定下一步做 t28。计划：[plan.md](plan.md)（待开发者确认）。

## 下一步

开发者确认计划后交设计审查，按批实施。
