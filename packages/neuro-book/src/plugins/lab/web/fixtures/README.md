# Component Lab 新 Fixture API 规范与架构哲学

本文档定义 Component Lab 中夹具（Fixture）的全新设计标准、视口契约与交互控制规范。所有为产品组件和 Lab 零件编写的 Fixture 均必须遵守本规范（旧版包裹式规范已作废）。

---

## 0. 场景放在哪里

- **插件的组件**：场景放在组件所属插件的 `src/plugins/<插件>/web/lab/`。`fixtures.ts` 导出 `fixtures: LabFixture[]`，同目录放这个插件的夹具 `.vue`、样本与场景用的文本端口。Lab 的总登记表（本目录的 `index.ts`）用 `import.meta.glob` 收集全部插件的 `fixtures.ts`，新插件不用改总表。场景多的插件可以分几个 `*.scenes.ts`，由 `fixtures.ts` 合成一张（例如 canon 按组件的六个区域分）。
- **`src/ui/` 的共用组件、nb-ui 等包的组件、Lab 自己的组件**：场景留在本目录。包不能引应用，所以 nb-ui、nb-layout、nb-agent-ui、nb-form 各一个子目录或文件，由 `index.ts` 汇入。
- **插件场景只经 `lab/web/scene-kit.ts` 用 Lab**：登记入口、`useLabSubject`、`useLabEventSink`、`LabFixtureControls`、类型都从这里取。架构测试（`src/architecture.test.ts`）拦下插件场景对 Lab 其它模块的引用，也拦下产品代码对任何 `web/lab/` 的引用（只引类型也不行）。生产样式入口（`src/web/tailwind.product.css`）排除 `plugins/*/web/lab`，只在场景里用到的类不进产品。
- **插件场景可以引别的插件的 `web/` 与 `shared/`**，包括别的插件的 `web/lab/`：场景常要挂几个插件的组件、搭局部宿主。几个插件共用的支持模块放进它模拟的那个插件，例如设置窗口的局部宿主 `settings/web/lab/settings-host.ts`，网络页、搜索页的场景从那里引。
- 登记门禁（`index.dom.test.ts`）对汇总后的登记表检查覆盖、重复与输入形状，并检查本目录、草稿区与每个插件 `web/lab/` 里的相对导入都能解析、每个 `web/lab/` 都有被收到的 `fixtures.ts`。

---

## 1. 核心架构哲学：ViewportCanvas 即视口盒子

Lab 的舞台容器（`ViewportCanvas`）直接充当被测组件的外部视口宿主盒子（具有边框、圆角、背景、手柄拖动、缩放及手机 390px / 平板 768px / 随窗口等预设尺寸）。

### 1.1 舞台直连与充满（禁止内部人造外壳）
- **根组件即主体**：Fixture 的责任是将组件纯粹挂载到 Lab 舞台上。
- **充满视口盒子**：
  - 面板类、视图类与工作台类组件，直接声明 `class="h-full w-full"`，贴满 ViewportCanvas 的舞台内容区；
  - 卡片类、部件类组件，声明 `class="w-full"`，自适应贴合视口盒子宽度；
  - 自带受控像素宽高或边缘拖拽条的面板/侧栏组件，在未传入受控尺寸时应回退为 `w-full` / `h-full` 自适应撑满外层容器且不挂载内部边缘拖拽条，确保在 Lab 中直接由外层 `ViewportCanvas` 手柄与预设控制尺寸。
- **彻底废除反模式（严格禁止）**：
  - ❌ **严禁嵌套假外壳**：严禁在 Fixture 内写 `h-[700px] max-w-[480px] rounded-xl border bg-panel shadow-lg`；
  - ❌ **严禁外层多余内边距**：严禁在根容器写 `flex items-center justify-center p-6`；
  - ❌ **严禁组件内部手写手机断点**：严禁写 `currentScene === 'phone' ? 'max-w-[390px]' : ''`；
- **材质分层**：背景消费语义材质变量（`var(--panel-surface)`、`var(--bg-panel)` 等），不在 fixture 容器硬编码页面底色 `var(--bg-main)`，否则 Lab 面板层的材质与暗色主题的对比度对不上。
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
// plugins/<插件>/web/lab/fixtures.ts：type-only import 不加载组件
import {defineLabFixture, type LabFixture} from "nbook/plugins/lab/web/scene-kit";
import type FixtureExample from "../components/FixtureExample.vue";

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
import {useLabSubject, type LabFixtureProps} from "nbook/plugins/lab/web/scene-kit";
import FixtureExample from "../components/FixtureExample.vue";

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
- 登记检查要求每个场景提供非空 `input`，或 fixture 提供非空 `noInput` 理由；场景调试值只有 `{props?, model?, slots?}` 这一种结构。
- 不在组件调试输入里的场景道具（假数据集大小、模拟延迟等）放 `<LabFixtureControls>`，不塞进 `input`。
- `LabJsonInput<T>` 只投影编译期可登记的 JSON 字段；Date、Set、函数、Vue Ref 等不能塞到场景值，fixture 用固定内存值/已有回调显式补齐，再由最终组件绑定的类型检查验证。对象内可编辑 JSON 字段仍来自 `subject.bindings.value`，不要因其旁边有回调就把整个对象藏到不可编辑常量中。

### 3.3 透传夹具：`defineSubjectFixture`（不写 fixture `.vue`）
夹具只做“绑定场景输入、记录事件、把个别事件回写成受控输入、补运行期 props”时，直接在登记文件（插件的 `web/lab/fixtures.ts`）里用 `defineSubjectFixture` 登记，不再写一个只有十行的 `XxxFixture.vue`：

```ts
defineSubjectFixture<typeof AgentChainSummary>({
    component: "AgentChainSummary",
    scenes: agentChainSummaryScenes,
    subject: () => import("nbook/ui/SkillChip.vue"),
    events: ["toggle"],
    writeBack: {toggle: {layer: "props", key: "expanded"}},   // 受控 prop 由 Lab 扮演宿主
    class: "w-full",
    // 函数、注册表等不是 JSON 输入的 props；异步准备，依赖和被测组件一样按需加载
    runtimeProps: async () => ({registry: (await import("…/agent-view-registry")).createAgentViewRegistry([])}),
});
```

类型检查与 `defineLabFixture<typeof C>` 相同，`events` 与 `writeBack` 也只能写 C 真实的事件和 prop。需要插槽预设、`<LabFixtureControls>`、挂载后才准备的服务（例如 `onMounted` 里加载 DOMPurify）或自己搭宿主状态时，仍手写 fixture。

### 3.4 截图与溢出检查：`lab:shot` 与 `window.__nbLab`
不要为 Lab 截图手写 Playwright 脚本，也不要点 Lab 外壳的按钮文字或 class：外壳改版就会失效。

- 地址栏参数直接进入指定状态：`/lab?c=<组件>&s=<场景>&vp=phone|tablet|free|<宽>x<高>&cw=light|dark|<配色 id>&theme=<主题 id>`。
- 截图、测溢出用命令行（在 `packages/neuro-book` 下，开发服务需已启动）：
  ```bash
  NB_LAB_URL=http://127.0.0.1:3000 bun run lab:shot -- -c AgentConversationView --vp phone,1400x900 --cw dark,light
  ```
  缺省截全部场景；`--click <选择器>` 可在截图前点开舞台里的元素（可重复），`--out` 指定目录，缺省写系统临时根。每个组合用新标签页打开，固定宽高的画布会自动放大窗口，舞台不会被检视栏盖住。每张图的溢出像素、越界元素（带选择器）、聚焦光晕与外扩环被裁的元素和页面错误打印在终端并写入 `report.json`，有问题时以非零退出。测量也覆盖传送到画布上的对话框、抽屉与 body 上开着的下拉类浮层；截图只按舞台裁剪，浮层落在舞台范围外的部分不在图里。
- 同一份测量在 `e2e/lab-scenes.e2e.ts` 里对全部场景跑（手机画布），和 `e2e/lab-layout-baseline.ts` 的已知问题逐项比个数，多了少了都失败。修好一个已知问题时同步改小基线；新写的组件不进基线。
- 浏览器控制台里可用 `window.__nbLab.state()`、`.scenes()`、`.measure()`；截图按 `[data-lab-stage]` 裁剪。

### 3.5 内部状态上报：`useLabDataSink`（只读）
组件或 fixture 自己持有、不经 props 暴露的状态（草稿、展开项、运行标志）用 `useLabDataSink()` 上报，数据 tab 以只读「内部状态」展示，不能从面板改回去：
```ts
const reportState = useLabDataSink();
watch(draft, (value) => reportState({draft: value}), {immediate: true});
```

---

## 4. 黄金规范范式（Golden Standards）

编写新 Fixture 时，请参照以下标杆范例：
1. **全高面板/复杂视图范例**：[`nb-agent-ui/AgentConversationViewFixture.vue`](nb-agent-ui/AgentConversationViewFixture.vue)
   - 充满视口（`h-full w-full`）；
   - 场景只改数据，随 ViewportCanvas 尺寸自适应伸缩。
2. **交互控件范例**：[`html-preview/web/lab/HtmlPreviewFixture.vue`](../../../html-preview/web/lab/HtmlPreviewFixture.vue)
   - 舞台只放被测组件；
   - “改正文”这类调试操作下放至 `<LabFixtureControls>`。
3. **分层输入与部件范例**：[`FixtureExampleFixture.vue`](FixtureExampleFixture.vue)
   - `useLabSubject` 接入 props / slots 分层输入，声明的事件进入事件 tab；
   - fixture 扮演宿主处理普通受控 prop（`toggle` → `active`）。

---

## 5. 受控零件不给独立 Fixture

`props` 全部来自宿主链（`state:inject` / `env:portal`）的零件，在文档 frontmatter 声明 `验证入口:`（宿主组件名）后由 Lab 标为**不可独立挂载**，中栏给出一条直达宿主场景的入口。

- 不要为它们登记独立场景，也不要在 fixture 里搭一层假宿主：脱离宿主链没有可验证状态，假壳验的是另一个东西；
- 它们的呈现（含失败态与空态）写在宿主的 fixture 场景里（例如工作台主体的 `workbench/web/lab/WorkbenchSurfaceFixture.vue`），由宿主所属插件的 `web/lab/fixtures.ts` 登记。
- 每个组件名在所有登记里只能出现一次：`findLabFixture` 只读第一份，重复登记会让后一份的场景永远打不开（`index.dom.test.ts` 有门禁拦截）。

---

## 6. 场景的数量：每个分支至少一个，其余合并

场景是给人逐个点开看的，也是 `e2e/lab-scenes.e2e.ts` 逐个量版面的对象：多一个只是文字不同的场景，就多一份要看、要量的东西，却没多覆盖一种样子。

- **每个分支至少一个场景走到**：组件模板里的每个分支（`v-if` / `v-else-if` / `v-else`、`variant` 一类的版式切换、禁用条件、由 props 决定的结构差异）都要有场景走到；夹具按场景 id 做的特殊处理（触发演示、模拟出错）也算一个分支。
- **只是文字或数据不同的合并**：走的分支一样、版式与交互一样的，留一个。一个场景可以同时走到几个不冲突的分支。
- **英文与长文字**：每种版式另外至多留一个英文场景、一个长文字场景。英文场景的 id 写 `english` 或以 `-english` 结尾：夹具多半按场景 id 切界面语言，写法看各插件的文本端口（例如 `canon/web/lab/canon-text.ts` 按 `scene.endsWith("-english")` 注册英文目录，有的只认 `english`），起名前先看一眼。长文字场景的 id 里带 `long`。文字放在固定尺寸里的版式（定高区域、定宽列、单行截断）要有英文场景。
- **窄屏用视口预设**：手机宽度点 Lab 顶栏的预设或改 `vp`，不另开“窄”场景。
- **覆盖分工**：版面由 `lab-scenes` 对保留的场景量，行为由组件的 dom 测试覆盖；拿掉一个场景前，先确认它走到的分支还有别的场景走到。
