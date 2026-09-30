---
schema: nbook.work/v1
workId: w00019-agent-conversation-view
issueId: null
---

# Agent 对话视图重做

右侧 Agent 面板（现 `packages/neuro-book/app/components/novel-ide/agent/`）的文件层级、命名、状态归属和抽象都很混乱。本 Work 在 `packages/neuro-book/app/components/agent/` 下参考旧代码重新实现一套纯视图组件，顶层为 `AgentConversationView`，重点是 UI/UX、组件规范和可扩展性。方案见 [Agent 对话视图重做提案](../../../packages/neuro-book/docs/proposals/agent-conversation-view.md)。

## 授权与边界（开发者，2026-09-28）

- 直接在 `master` 主工作区开发。
- 只做前端组件。后端接口不改，也不写后端规范；会话模型层和数据层不重写，相关问题记入[数据层后续提案](../../../packages/neuro-book/docs/proposals/agent-session-data-layer.md)，等 w00017 插件体系就绪后再做。
- 只以 Component Lab 验收，不接入主页面；开发期间主页面的 Agent 面板不可用可以接受。
- Inline AI 不在范围内。左侧会话栏和 Trace Viewer 只需保证各自的 Lab fixture 可用。
- 不提交、不 push，除非开发者另行要求。

## 合同

- [ui.agent-conversation-view](../../../docs/specs/ui/agent-conversation-view.md)（planned）
- [ui.component-lab.timeline](../../../docs/specs/ui/component-lab-timeline.md)（planned）

## 实现路线

按可在 Lab 中单独验证的切片推进；每个切片开始时再建对应 Task。

| 切片 | 内容 | 依赖 |
|---|---|---|
| S1 | 视图类型、注册表构造、分轮规则纯逻辑与单测、最小可挂载视图、首个长对话场景 | 无 |
| S2 | 共享外壳的视觉方案，在 Lab 中做 2 到 3 套对比，**由开发者确认后**再推广 | S1 |
| S3 | 消息流：轮次、摘要行、过程时间线、工具组、自动折叠与阅读锚点、原始视图、历史分页与滚动、消息状态 | S2 |
| S4 | Lab 时间线回放（`ui.component-lab.timeline`）与完整 ReAct 回放场景 | S3 |
| S5 | 工具与条目渲染器：通用、读写改与补丁 diff、提问留痕、模式切换、任务清单、Workflow、系统条目、错误 | S3 |
| S6 | 输入框：发送与 steer/followup/停止、触发菜单、命令、图片、模式与模型、横幅、提问向导、草稿版本；编辑器独立成组件，历史消息的就地编辑与输入框共用它 | S2 |
| S7 | 顶栏与溢出菜单、面板、待处理区、状态栏、弹窗 | S2 |
| S8 | 验收：Spec 的 19 条场景、390 与 1200 宽、明暗主题、Lab smoke、组件文档；判断 Spec 能否晋升 | 全部 |

## Task

- [t01-proposal](tasks/t01-proposal/README.md)：现状分析、需求调研与提案起草。已完成。
- [t02-planned-specs](tasks/t02-planned-specs/README.md)：写 planned Spec。已完成。
- [t03-view-skeleton](tasks/t03-view-skeleton/README.md)：切片 S1，视图类型、注册表、分轮规则、最小视图壳与首批 Lab 场景。已完成。
- [t04-visual-shell](tasks/t04-visual-shell/README.md)：切片 S2，共享视觉零件与候选方案对比。开发者已确认视觉（第十一轮，含提前做的 S5 工具详情），收尾审查已完成。
- [t05-lab-dev-tools](tasks/t05-lab-dev-tools/README.md)：Lab 截图调试工具与夹具样板精简（开发者在 t04 复盘后批准）。已完成，开发者已确认。
- [t06-message-stream](tasks/t06-message-stream/README.md)：切片 S3 剩余部分，滚动、阅读位置、历史分页、原始视图与消息状态。开发者已确认（2026-09-30），细节打磨与动画另列。
- [t07-prompt-editor](tasks/t07-prompt-editor/README.md)：切片 S6 前一半，独立的提示词编辑器 `PromptEditor`，输入框与历史消息就地编辑共用；与旧编辑器并存。需求已与开发者理清，组件文档、Spec 与数据层提案已更新，待实现。
