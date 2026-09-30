---
schema: nbook.task/v2
taskId: t02-planned-specs
---

# 写 planned Spec

## 目标

把已接受的[提案](../../../../../packages/neuro-book/docs/proposals/agent-conversation-view.md)转成可验收的黑盒合同。

## 当前状态（2026-09-28）：已完成

- 新增 [ui.agent-conversation-view](../../../../../docs/specs/ui/agent-conversation-view.md)（planned）：props、ctx 组成、消息形状、服务、注册表与内置工具类别、分轮视图与自动折叠规则、原始视图、完整 action 表、失败语义、19 条验收场景。
- 新增 [ui.component-lab.timeline](../../../../../docs/specs/ui/component-lab-timeline.md)（planned）：现有 `ui.component-lab` 已是 implemented，时间线回放尚未实现，按 Spec 规则另立文件，不混入。
- 两份 Spec 已登记到 `docs/specs/README.md` 的“待实现规范”；提案状态改为 accepted。

## 授权

开发者 2026-09-28 接受提案，并决定：摘要行显示用时、步数、读写文件数、tokens、费用，窄屏取舍实测后再定；原始视图入口放在顶栏溢出菜单。

## 相对提案新增的合同细节

写 Spec 时补充了几处提案没有细化的地方，需要开发者知悉：

- 视图输入拆成 `ctx`（可完整 JSON 化，Lab 数据 tab 可直接编辑）、`services`（HTML 消毒、附件地址、触发菜单三个纯函数）和 `registry` 三个 prop，另加 `viewMode` 与 `teleportTarget`。
- 运行中的用时依据 `ctx.now` 计算，视图自己不计时，这样 Lab 时间线可以确定性回放。
- 输入框草稿带版本号：宿主受理提交后提供空的新版本，视图据此清空；提交失败时文字不丢。
- 输入以 `/` 开头且命令已登记时发出 `command.run`，未登记的按普通文字发送。
- 折叠的过程区不渲染内部步骤。
- “步数”定义为本轮工具调用次数。

## 验证

- `bun run docs:check`：failures 为 0。
- `bun run governance:check`：通过。
