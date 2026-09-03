---
schema: nbook.task/v2
taskId: t14-agent-profile-nav-lab-migration
role: tasker
---

# 协作试迁移 Agent Profile 导航

## 目标

由开发者与 Agent 一起把真实设置界面的 `AgentProfileNavList` 迁成新主题体系下可在 Component Lab 确定性验证的组件，并完整记录从旧主应用组件到 Lab-ready replacement 的步骤、失败、取舍和可复用经验。这个样本用于决定后续自主迁移如何拆批，不代表设置界面整体迁移，也不立即接回主页。

## 选择依据

`AgentProfileNavList.vue` 当前约 127 行，真实消费者为 `NovelIdeAgentProfileModelSettingsPanel.vue`。它的数据与交互通过 props/emits 明示，覆盖搜索、当前项、默认项、dirty、编译状态、覆盖计数、空列表和无匹配状态，没有直接 API、store、数据库或持久化。相较 World Engine，它能走完整迁移流程而不同时引入工作台、草稿、保存与领域状态。

## 协作方式

每个阶段先由 Agent 提供当前事实、可观察 Lab 结果和需要决定的视觉/交互差异，开发者只决定产品取舍和实际观感。代码、调用方、依赖、现有组件能力和测试事实由 Agent 自行查明。

1. **基线**：记录当前组件合同、真实调用方、旧基础组件依赖、键盘/ARIA、桌面/窄屏布局和已知缺口。
2. **文档先行**：新增同名组件文档，固定 props、emits、slots、状态、布局、不支持项和 Lab 场景；开发者确认样本是否代表期望方向。
3. **replacement**：决定组件留在 NeuroBook 领域层还是抽入 nb-ui；使用 nb-ui 公共零件与语义 token 实现，不读取旧产品主题，不判断宿主是 Lab 还是主页。
4. **fixture**：覆盖默认项、选中 Profile、dirty、默认 Profile、loaded/compiling/error、长列表、空列表和搜索无匹配；不访问真实配置或 Profile。
5. **Lab 验收**：在桌面和 `390 × 844` 验证搜索、选择、滚动、状态表达、长文本、键盘、焦点、ARIA、事件和无页面级横向溢出；开发者做阶段性观感判断。
6. **记录**：把踩坑、隐含依赖、被否决方案、失败命令和对后续批次的规则候选写入 walkthrough；不确定项区分产品决定、实现事实和未验证风险。

## 允许改动

- `AgentProfileNavList.vue` 及其同名组件文档；若 replacement 移入 nb-ui，则修改对应 nb-ui 组件、export、文档、测试与 CSS canonical source/产物。
- NeuroBook Component Lab 的 fixture、必要索引消费和聚焦 smoke。
- 与本组件合同直接相关的聚焦测试。
- 本 Task walkthrough/evidence。

默认不修改 `NovelIdeAgentProfileModelSettingsPanel.vue` 的主页接线；开发者已接受 w00003 分支主页暂不可用，但本 Task 不主动删除旧消费者或扩大设置界面迁移。需要改变共享 DTO、Profile 数据语义、C 产品主题合同或其它设置面板时停止并记录，由 Leader 决定下一 Task。

## Lab-ready 验收

- 同名组件文档与实现一致，能力标签如实反映隐藏通道；props/emits/slots 可机械核对。
- fixture 覆盖上述状态，重复打开和重置结果确定；不依赖 API、store、浏览器存储或真实 Profile。
- 组件只消费 nb-ui 语义 token，不读取旧 `theme.system` authority，不含 Lab/主页条件分支。
- 搜索与选择事件保持受控；禁用或不可选状态如有定义则键盘与指针一致；选中、dirty、默认和编译状态不只依赖颜色表达。
- 桌面与 `390 × 844` Lab 中无关键遮挡或页面级横向溢出，长名称和长 key 不撑破布局。
- 聚焦测试、组件 Lab smoke、受影响 nb-ui 测试/typecheck 和文档检查有实际结果；全局红色基线逐条记录但不冒充通过。

## 开发者参与点

- 文档和首版 fixture 出来后，开发者确认信息层级、状态表达和窄屏取舍。
- 真实 Lab 首版出来后，开发者确认观感；自动 smoke 不代替这次协作样本的人工判断。
- 出现两个以上合理的公开组件边界、交互结果或状态视觉时，由开发者选择；Agent 必须先给证据、选项、影响和建议。

## 完成后的 Leader 动作

读取本 Task walkthrough，判断哪些步骤能成为批量迁移合同、哪些只适用于 Agent Profile 导航，再按实际依赖创建第一批 Agent 自主迁移 Task。不得仅凭本 Task 成功就预建剩余全部组件任务。
