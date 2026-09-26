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

## 3. 零件标定、分层输入与内部状态

### 3.1 核心零件标定：`data-lab-subject`
- 被测核心组件必须标记 `data-lab-subject` 属性：
  ```html
  <FixtureExample data-lab-subject v-bind="subject.bindings.value" />
  ```
- Lab 的元素检查器（Inspector）与高亮探针据此准确定位核心主体，不受外围容器干扰。

### 3.2 分层输入：场景登记 `input`，fixture 用 `useLabSubject` 接入
场景对被测组件的输入按 fixture **明确声明的调试面**分层。Lab 不读取组件实现来猜哪些字段可调；fixture 在登记入口通过 TypeScript 类型把输入键约束到组件的 Props / v-model / Slots：

| 层 | 内容 | 谁持有 |
| --- | --- | --- |
| `model` | fixture 声明的 v-model 受控值；组件发 `update:x` 时 Lab 回写 | Lab |
| `props` | fixture 声明的非受控 prop 初值；没写的走组件默认值 | Lab；fixture 可用 `subject.write` 扮演宿主 |
| `slots` | fixture 自己备好的插槽预设开关 | Lab 登记开关，fixture 填入内容 |

```ts
// fixtures/index.ts：type-only import 不加载组件
import type FixtureExample from "../FixtureExample.vue";
import {defineLabFixture} from "./index";

defineLabFixture<typeof FixtureExample>({
    component: "FixtureExample",
    slots: ["extra"],
    scenes: [{
        id: "default",
        label: "默认",
        input: {props: {title: "示例", status: "ready"}, slots: {extra: true}},
    }],
    load: () => import("./FixtureExampleFixture.vue").then((module) => module.default),
});
```

`defineLabFixture<typeof C>` 是登记入口，不加载 `C`，也不把 fixture 自动挂到组件上。它的 TypeScript 检查会拒绝不存在的 prop、错误值类型、把 model 放进 props、缺少必填 JSON prop 和未知插槽；有可登记 JSON 数据 prop 时必须登记 `props` 层，但层内可选 prop 可以省略。只有投影后没有 JSON 数据 prop 的组件可以写有非空理由的 `noInput`；函数或服务等运行期必填 prop 仍必须由 fixture 在最终 Vue 组件绑定上补齐。

```vue
<script setup lang="ts">
import FixtureExample from "../FixtureExample.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof FixtureExample>(() => props.input, ["toggle", "action"]);
</script>
<template>
    <FixtureExample
        data-lab-subject
        v-bind="subject.bindings.value"
        @toggle="subject.write('props', 'active', $event)"
    >
        <template v-if="subject.slots.value.extra" #extra>预设内容</template>
    </FixtureExample>
</template>
```

- `useLabSubject` 只自动接入 fixture 在 `events` 参数中声明的普通事件；这些事件进入事件 tab。model 层的键自动接入对应 `update:x`，记录并写回 model。未声明的普通事件不由 Lab 猜测，fixture 可以直接写模板监听或调用 `useLabEventSink`。
- 「数据」tab 只显示场景实际登记的层。TypeBox schema 只保证编辑值仍是 `{props?, model?, slots?}` 的 JSON 形状；组件字段名、必填值和 model 分层由登记入口的 TypeScript 检查负责，fixture 是否真的把输入传给组件由 fixture 自己负责并需通过行为验证。
- 登记检查要求每个场景提供非空 `input`，或 fixture 提供非空 `noInput` 理由；不会把旧 `data` 当成输入。
- 不在组件调试输入里的场景道具（假数据集大小、模拟延迟等）放 `<LabFixtureControls>`，不塞进 `input`。
- `LabJsonInput<T>` 只投影编译期可登记的 JSON 字段；Date、Set、函数、Vue Ref 等不能塞到场景值，fixture 用固定内存值/已有回调显式补齐，再由最终组件绑定的类型检查验证。对象内可编辑 JSON 字段仍来自 `subject.bindings.value`，不要因其旁边有回调就把整个对象藏到不可编辑常量中。


### 3.3 内部状态上报：`useLabDataSink`（只读）
组件或 fixture 自己持有、不经 props 暴露的状态（草稿、展开项、运行标志）用 `useLabDataSink()` 上报，数据 tab 以只读「内部状态」展示，不能从面板改回去：
```ts
const reportState = useLabDataSink();
watch(draft, (value) => reportState({draft: value}), {immediate: true});
```

### 3.4 旧协议已移除
场景的旧 `data` 字段已废止：仅登记 `input` 或有合法理由的 `noInput`，不自动改写旧数据、不加迁移白名单。缺输入时数据 tab 显示「这个场景未登记调试输入，请按 fixture 合同迁移」，索引测试同时报出组件与场景。

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
3. **分层输入与部件范例**：[`app/component-lab/fixtures/FixtureExampleFixture.vue`](FixtureExampleFixture.vue)
   - `useLabSubject` 接入 props / slots 分层输入，声明的事件进入事件 tab；
   - fixture 扮演宿主处理普通受控 prop（`toggle` → `active`）。

---

## 5. 受控零件不给独立 Fixture

`props` 全部来自宿主链（`state:inject` / `env:portal`）的零件，在文档 frontmatter 声明 `验证入口:`（宿主组件名）后由 Lab 标为**不可独立挂载**，中栏给出一条直达宿主场景的入口。

- 不要为它们在 `fixtures/index.ts` 里登记独立场景，也不要在 fixture 里搭一层假宿主：脱离宿主链没有可验证状态，假壳验的是另一个东西；
- 它们的呈现（含失败态与空态）写在宿主的 fixture 场景里。workbench 链上的零件入口是 `WorkbenchShellLayout`：新场景加在 `WorkbenchShellLayoutFixture.vue` 的 `SCENES`，并同步 `fixtures/index.ts` 的场景表；
- 每个组件名在 `fixtures/index.ts` 里只能登记一次：`findLabFixture` 只读第一份，重复登记会让后一份的场景永远打不开（`fixtures/index.test.ts` 有门禁拦截）。
