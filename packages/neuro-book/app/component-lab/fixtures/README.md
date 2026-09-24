# Component Lab 新 Fixture API 规范与架构哲学

本文档定义 Component Lab 中夹具（Fixture）的全新设计标准、视口契约与交互控制规范。所有为产品组件和 Lab 零件编写的 Fixture 均必须遵守本规范（旧版包裹式规范已作废）。

---

## 1. 核心架构哲学：ViewportCanvas 即视口盒子

Lab 的舞台容器（`ViewportCanvas`）直接充当被测组件的外部视口宿主盒子（具有边框、圆角、背景、手柄拖动、缩放及手机 390px / 平板 768px / 随窗口等预设尺寸）。

### 1.1 舞台直连与充满（禁止内部人造外壳）
- **根组件即主体**：Fixture 的责任是将组件纯粹挂载到 Lab 舞台上。
- **充满视口盒子**：
  - 面板类、视图类与工作台类组件，直接声明 `class="h-full w-full"`，贴满 ViewportCanvas 的舞台内容区；
  - 卡片类、部件类组件，声明 `class="w-full"`，自适应贴合视口盒子宽度。
- **彻底废除反模式（严格禁止）**：
  - ❌ **严禁嵌套假外壳**：严禁在 Fixture 内写 `h-[700px] max-w-[480px] rounded-xl border bg-panel shadow-lg`；
  - ❌ **严禁外层多余内边距**：严禁在根容器写 `flex items-center justify-center p-6`；
  - ❌ **严禁组件内部手写手机断点**：严禁写 `currentScene === 'phone' ? 'max-w-[390px]' : ''`；
- **自适应测试方法**：
  - 观察极窄屏幕：点击顶栏「手机 (390×844)」预设；
  - 观察平板屏幕：点击顶栏「平板 (768×1024)」预设；
  - 观察任意宽度：直接拖拽 ViewportCanvas 右侧/底部手柄，观察组件在 300px ~ 1200px 下的平滑布局重排、换行与滚动条行为。

### 1.2 一个 Tab 一个组件（拒绝副本平铺与信息侵占）
- **单一主体原则**：每个场景（Tab）只展示一个组件实例。
- **杜绝副本平铺**：严禁在一个 Tab 内垂直或水平平铺同一个组件的多个状态副本。
- **杜绝舞台噪音**：严禁在舞台上直接展示操作按钮、说明文字或 JSON 数据，舞台只留给组件。

---

## 2. 控件分离协议：`LabFixtureControls`

交互调试控件与被测组件必须彻底解耦：
- 所有用于该场景测试的操作按钮（如“追加消息”、“触发流式”、“切换只读”、“模拟异常”）必须包裹在 `<LabFixtureControls>` 内部。
- `<LabFixtureControls>` 内部通过 Teleport 将控件传送至 Lab 画布下方的「场景交互控制」抽屉栏。
- 在 Fixture 没有声明 `<LabFixtureControls>` 时，Lab 底部抽屉栏自动隐藏，保持界面极简。

```vue
<!-- 示例：标准控件下放方式 -->
<LabFixtureControls v-if="props.scene === 'interactive'">
    <div class="flex items-center gap-2 text-xs">
        <span class="text-[var(--text-secondary)]">调试操作</span>
        <button type="button" class="..." @click="doSomething">执行操作</button>
    </div>
</LabFixtureControls>
```

---

## 3. 零件标定、事件与数据 Sink

### 3.1 核心零件标定：`data-lab-subject`
- 被测核心组件必须标记 `data-lab-subject` 属性：
  ```html
  <AgentSidebarView data-lab-subject class="h-full w-full" ... />
  ```
- Lab 的元素检查器（Inspector）与高亮探针据此准确定位核心主体，不受外围容器干扰。

### 3.2 交互事件上报：`useLabEventSink`
- 组件触发的业务事件（如 `@composer-send`、`@select`、`@action`）通过 `useLabEventSink()` 派发：
  ```ts
  const emitLabEvent = useLabEventSink();
  // 在事件处理函数中
  emitLabEvent("composer-send", payload);
  ```
- 所有事件实时推送到 Lab 右侧「事件」面板，供审查人员验证交互时序与负载。

### 3.3 场景输入：宿主 `data`、组件 `input` 与 `useLabDataSink`
- **复合宿主 fixture**：在 `fixtures/index.ts` 为可编辑场景登记可 JSON 化的 `data` 初值。fixture 声明 `data?: unknown`，将 `props.data` 响应式投影到宿主装配的被检组件上；右栏修改后舞台实时响应。
- **组件签名 fixture**：原子或直连组件以 `input` 登记 `props`、`model`、`slots` 三层初值。使用 `useLabSubject(Component, () => props.input)` 绑定被检组件，Lab 校验组件运行时签名并接管 `update:<model>`。
- 两种通道语义不同：`data` 描述 fixture 自己装配的宿主假数据；`input` 描述被检组件的真实 props/model/slots。一个场景可按需同时登记两者，数据面板分别呈现和还原，不把宿主字段伪装成组件 props。
- **状态与草稿输出上报**：本地受控状态、草稿输入（如 `draft`、选中的选项索引、运行标志）通过 `useLabDataSink()` 上报；它是只读的 fixture 状态快照，不替代可编辑的 `data` 或 `input`。

---

## 4. 黄金规范范式（Golden Standards）

编写新 Fixture 时，请参照以下标杆范例：
1. **全高面板/复杂视图范例**：[`app/component-lab/fixtures/AgentSidebarViewFixture.vue`](AgentSidebarViewFixture.vue)
   - 充满视口（`h-full w-full`）；
   - 纯正数据驱动 12 种场景；
   - 随 ViewportCanvas 尺寸自适应伸缩。
2. **流式与交互控件范例**：[`app/component-lab/fixtures/AgentChatFlowFixture.vue`](AgentChatFlowFixture.vue)
   - 舞台 100% 留给会话流；
   - 流式仿真控制器优雅下放至 `<LabFixtureControls>`。
3. **部件与卡片范例**：[`app/component-lab/fixtures/FixtureExampleFixture.vue`](FixtureExampleFixture.vue)
   - 示范标准卡片零件的自适应宽度与调试控件分离。

---

## 5. 受控零件不给独立 Fixture

`props` 全部来自宿主链（`state:inject` / `env:portal`）的零件，在文档 frontmatter 声明 `验证入口:`（宿主组件名）后由 Lab 标为**不可独立挂载**，中栏给出一条直达宿主场景的入口。

- 不要为它们在 `fixtures/index.ts` 里登记独立场景，也不要在 fixture 里搭一层假宿主：脱离宿主链没有可验证状态，假壳验的是另一个东西；
- 它们的呈现（含失败态与空态）写在宿主的 fixture 场景里。workbench 链上的零件入口是 `WorkbenchShellLayout`：新场景加在 `WorkbenchShellLayoutFixture.vue` 的 `SCENES`，并同步 `fixtures/index.ts` 的场景表；
- 每个组件名在 `fixtures/index.ts` 里只能登记一次：`findLabFixture` 只读第一份，重复登记会让后一份的场景永远打不开（`fixtures/index.test.ts` 有门禁拦截）。
