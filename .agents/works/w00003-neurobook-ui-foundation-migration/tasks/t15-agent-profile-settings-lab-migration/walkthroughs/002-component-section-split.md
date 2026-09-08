# 逐组件拆分与优化记录

## 背景

开发者指出 `AgentProfileSettingsView.vue` 右侧滚动区仍由两个大组件承担，无法按职责逐个优化。此次切片先拆分组件，再分别建立 Lab 入口；没有把整页视觉重做与拆分混在一起。

## 拆分结果

`AgentProfileDetailPanel.vue` 现在只做受控编排，右侧职责拆为：

- `AgentProfileIdentitySection.vue`：名称、用途、key、源路径、编译/加载状态。
- `AgentProfileModelSection.vue`：常用模型/推理强度与高级模型参数折叠。
- `AgentProfileCustomSettingsSection.vue`：LowCodeForm、继承值和 resource mutations。
- `AgentProfileRuntimeSection.vue`：运行策略覆盖折叠和基线传递。
- `AgentProfileDiagnosticsSection.vue`：恢复默认、Home 重置请求和构建原因。

`AgentProfileDefaultsPanel.vue` 现在只做默认页组合，拆为：

- `AgentProfileDefaultProfileSection.vue`
- `AgentProfileDefaultModelSection.vue`
- `AgentProfileDefaultRuntimeSection.vue`

所有新组件都有同名 Markdown 文档与 `state:local` 能力标签；没有新增 store、IO、route、持久化或 portal 隐藏通道。

## 关键行为调整

- `AgentProfileModelFields.vue` 增加 `visibleFields`，使模型/推理强度与温度/TopK/流式输出由同一字段组件按父级区段选择性呈现，消除高级字段重复渲染。
- 高级模型参数折叠由 `AgentProfileModelSection` 以 `v-model:open` 受控；默认关闭，有覆盖仅显示 Badge。
- 默认 Profile 子组件改用 nb-ui `FormSelect` 与 `FormSelectOption`，不再依赖旧 common FormSelect。
- `AgentProfileSettingsView.md` 更新为独立右侧区段描述。
- 新增 `AgentProfileSectionsFixture.vue`，分别挂载真实组件名对应的 Lab fixture，场景为身份、模型、专属设置、运行策略、诊断维护、默认 Profile、默认模型、默认运行策略。 fixture 只使用固定内存数据。

## 验证

已运行：

- `cd packages/neuro-book && bun x vue-tsc --noEmit -p tsconfig.json`：通过。
- `bun run --cwd packages/neuro-book test -- app/components/novel-ide/settings/agent-profile/AgentProfileNavList.test.ts app/components/novel-ide/settings/agent-profile/profile-runtime-settings.test.ts app/component-lab`：5 files / 23 tests passed。
- `bun run --cwd packages/neuro-book test -- app/component-lab`：3 files / 9 tests passed。
- 真实 `http://127.0.0.1:3001/lab`：通过组件树搜索进入 `AgentProfileModelSection`，确认模型与推理强度常驻，高级模型参数初始折叠，点击后显示温度、TopK、流式字段；390px 视口 `document.scrollWidth === innerWidth === 390`。
- `bun run docs:check`：5403 files，0 failures。
- `bun run governance:check`：0 failures，0 warnings。
- `git diff --check`：通过；仅 Git 的 LF→CRLF 工作树提示。

## 未闭合项与边界

完整 `smoke:component-lab` 当前仍失败于已有 smoke 的手机尺寸文案断言：

```text
手机预设应切换到 390 × 844 画布（未找到：390 × 844）
刷新后应恢复已保存的手机画布尺寸（未找到：390 × 844）
```

失败发生在通用 Lab smoke 的手机预设流程，不是独立 Profile 区段交互错误；`ViewportCanvas` 的尺寸标签只在 `showSize` 为真时渲染，而完整 smoke 选中的组件/fixture 路径不保证该标签可见。此次未修改通用 Lab smoke 或 ViewportCanvas，避免把与 Profile 拆分无关的验收契约扩大到本切片。

用户未跟踪文件 `packages/neuro-book/eval-tmp.ts` 保留未动。当前提交：`cbe9b5e0`。
