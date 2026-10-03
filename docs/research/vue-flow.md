# Vue Flow 用法整理

## 1. 目的

本文档用于整理 `Vue Flow` 在当前项目里的实际用法，重点服务剧情树图视图。

目标不是翻译整站文档，而是回答下面这些问题：

- `Vue Flow` 的最小接入方式是什么
- 节点、边、分组、嵌套分别怎么表达
- 哪些交互配置适合剧情树图
- 在当前项目里，`Story / StoryPhase / Thread / Scene` 应该怎么映射到图模型

本文主要基于本地文档目录：

- `.agent/workspace/vue-flow/docs/src/guide/**`
- `.agent/workspace/vue-flow/docs/examples/**`

---

## 2. 组件与包结构

`Vue Flow` 不是一个单包全家桶，而是按能力拆分的：

- `@vue-flow/core`
  - 核心画布、节点、边、状态、事件、`useVueFlow`
- `@vue-flow/background`
  - 背景网格/点阵
- `@vue-flow/controls`
  - 缩放、`fitView`、交互锁定按钮
- `@vue-flow/minimap`
  - 右下角小地图

如果后续要接入当前项目，建议安装：

```bash
bun add @vue-flow/core @vue-flow/background @vue-flow/controls @vue-flow/minimap
```

---

## 3. 最小可用接入

### 3.1 必要条件

根据官方 `Getting Started` 和 `Troubleshooting`：

- 每个 `node` 必须有唯一 `id`
- 每个 `node` 必须有 `position`
- 每个 `edge` 必须有唯一 `id`、`source`、`target`
- `VueFlow` 的父容器必须有明确宽高，否则会报 `MISSING_VIEWPORT_DIMENSIONS`
- 必须引入核心样式，否则画布显示不正确

### 3.2 最小示例

```vue
<script setup lang="ts">
import {ref} from "vue";
import type {Edge, Node} from "@vue-flow/core";
import {VueFlow} from "@vue-flow/core";

const nodes = ref<Node[]>([
    {
        id: "scene-1",
        position: {x: 120, y: 80},
        data: {label: "Scene 1"},
    },
    {
        id: "scene-2",
        position: {x: 360, y: 80},
        data: {label: "Scene 2"},
    },
]);

const edges = ref<Edge[]>([
    {
        id: "scene-1->scene-2",
        source: "scene-1",
        target: "scene-2",
    },
]);
</script>

<template>
    <!-- 必须给父容器宽高 -->
    <div class="h-[640px] w-full">
        <VueFlow :nodes="nodes" :edges="edges" fit-view-on-init />
    </div>
</template>
```

### 3.3 样式引入

官方要求至少引入：

```ts
// nuxt.config.ts
export default defineNuxtConfig({
    css: [
        "the-new-css-reset/css/reset.css",
        "@vue-flow/core/dist/style.css",
        "@vue-flow/core/dist/theme-default.css",
        "@vue-flow/controls/dist/style.css",
        "@vue-flow/minimap/dist/style.css",
    ],
});
```

说明：

- `core/style.css` 是必须的
- `theme-default.css` 是默认主题，通常建议保留
- `controls` 和 `minimap` 的样式需要单独引入，不包含在默认主题里

---

## 4. 核心概念

### 4.1 Node

`Node` 是图里的基本可视对象。

对我们最重要的字段：

```ts
type PlotGraphNode = {
    id: string;
    type?: string;
    position: {x: number; y: number};
    data?: Record<string, unknown>;
    class?: string | string[];
    hidden?: boolean;
    draggable?: boolean;
    selectable?: boolean;
    parentNode?: string;
    extent?: "parent" | [[number, number], [number, number]];
    expandParent?: boolean;
    style?: Record<string, string | number>;
};
```

要点：

- `type` 用来决定节点组件
- `data` 放业务数据
- `parentNode` 用来做父子嵌套
- `extent: "parent"` 表示子节点拖拽范围限制在父节点内
- `expandParent: true` 表示拖动子节点贴边时可以扩大父节点区域
- `hidden: true` 可以直接隐藏节点

### 4.2 Edge

`Edge` 是节点之间的关系线。

对剧情树图最有用的字段：

```ts
type PlotGraphEdge = {
    id: string;
    source: string;
    target: string;
    type?: "default" | "straight" | "step" | "smoothstep" | string;
    animated?: boolean;
    hidden?: boolean;
    selectable?: boolean;
    data?: Record<string, unknown>;
};
```

在剧情树图里，边更适合表达：

- 同一 `Thread` 内 `Scene` 的顺序关系
- 特殊引用关系的辅助连线

不适合把所有层级都画成边，否则噪音太大。

### 4.3 `useVueFlow`

`useVueFlow` 是最关键的 composable。

它同时提供三类能力：

- 事件钩子
  - 例如 `onInit`、`onNodeDragStop`、`onConnect`
- 状态
  - 例如 `nodesDraggable`、`elementsSelectable`、`viewport`
- 方法
  - 例如 `fitView`、`addNodes`、`addEdges`、`updateNode`、`removeNodes`、`toObject`

最重要的官方说明：

- `useVueFlow` 第一次调用时会创建并注入一个状态实例
- 这个“第一次调用”决定了当前组件树使用哪个 flow store
- 如果页面里存在多个 flow，应该显式传 `id`

示例：

```ts
import {useVueFlow} from "@vue-flow/core";

const {fitView, updateNode, onNodeDragStop} = useVueFlow({id: "plot-tree"});
```

---

## 5. 自定义节点与边

`Vue Flow` 真正适合复杂编辑器的原因，不是默认节点，而是自定义节点/边。

### 5.1 自定义节点

有两种常见写法：

- `node-types` prop
- `#node-xxx` slot

示例：

```vue
<script setup lang="ts">
import {ref} from "vue";
import type {Node} from "@vue-flow/core";
import {VueFlow} from "@vue-flow/core";
import SceneNode from "nbook/app/components/novel-ide/plot/tree/SceneNode.vue";

const nodeTypes = {
    scene: SceneNode,
};

const nodes = ref<Node[]>([
    {
        id: "scene-1",
        type: "scene",
        position: {x: 80, y: 120},
        data: {title: "买到奴隶少女"},
    },
]);
</script>

<template>
    <div class="h-[640px] w-full">
        <VueFlow :nodes="nodes" :node-types="nodeTypes" />
    </div>
</template>
```

### 5.2 自定义边

如果后续剧情树图需要：

- 顺序箭头
- 伏笔/回收辅助线
- 带标签的剧情关系线

可以使用自定义边组件，不需要自己重做整套画布。

---

## 6. 分组、嵌套与隐藏

这部分是剧情树图最关键的能力。

### 6.1 父子节点

官方 `nested` 示例的核心字段是：

```ts
{
    id: "thread-main",
    position: {x: 120, y: 80},
    style: {width: "420px", height: "320px"},
}

{
    id: "scene-1",
    parentNode: "thread-main",
    extent: "parent",
    position: {x: 24, y: 72},
}
```

含义：

---

## 7. 当前项目的树图原型决策

当前项目的 `PlotTreeView` 已经不再采用“拖拽后整图重建”的布局器模式，而是切到 `Vue Flow` 原地编辑模式。

### 7.1 Draft Graph 作为前端真相源

树图原型层使用一份前端 `draft graph`：

- `Thread.position`
- `Scene.position`
- `Scene.sourceId`
- `Scene.threadId`

其中：

- 当 `Scene.threadId !== null` 时，`Scene.position` 是组内局部坐标
- 当 `Scene.threadId === null` 时，`Scene.position` 是画布绝对坐标
- `Scene.sourceId = null` 表示当前节点没有连线来源
- `Scene.sourceId = "plot-root-start"` 表示当前节点直接从根节点起步

这意味着：

- 拖拽后只更新被拖节点
- 连线、新增、删除时才做结构性同步
- 不再依赖一个“基础布局 + offset”的二次重建器

### 7.2 允许游离 Scene

在树图原型阶段，允许 `Scene.threadId = null`。

语义是：

- 这是一个尚未归组的剧情灵感节点
- 它可以先被摆在画布上，再拖入某个 `Thread`

注意：

- 这是树图原型层行为
- 当前正式剧情 schema 仍然是 `Scene -> Thread`
- 不应把“游离 Scene”误认为后端正式模型已经支持

### 7.3 连线限制

当前原型只允许两类连线：

- `root -> scene`
- `scene -> scene`

不允许：

- `thread -> scene`
- `scene -> root`
- 任何会造成循环的连接

补充规则：

- 游离 `Scene` 允许完全无连线
- `Thread` 内 `Scene` 必须保持单链
- 跨 `Thread` 连线只能接到目标 `Thread` 的入口 `Scene`

### 7.4 主线分支规则

树图使用一个特殊根节点作为统一起点。

后续 fork 规则是：

- 同一父节点下，最多只有一个 `Scene.isMainBranch = true`
- 如果用户把某个子节点改成主线分支，则其兄弟节点会自动降为支线

因此：

- 主线展示依赖 `isMainThread + isMainBranch`
- 不再通过自动布局推断主线

### 7.5 当前首批编辑操作

当前使用全局 toolbar 统一承载高频结构操作：

- `新建 Thread`
- `新建游离 Scene`
- `自动布局`
- `Fit View`

节点上只保留少量快捷操作：

- `Thread`：新增 Scene、删除空 Thread
- `Scene`：新增子 Scene、主支切换、脱离 Thread、删除

这样做的目的不是“按钮越少越好”，而是把全局图操作和节点级局部操作分开，避免 `PlotTreeCanvas` 再退化成一个把所有编辑入口都硬塞进去的巨型组件。

当前原型建议先支持：

- 新建 `Thread`
- 新建游离 `Scene`
- 给 `Thread` 新增 `Scene`
- 给 `Scene` 新增子 `Scene`
- 切换 `Scene` 为主线 / 支线
- 把 `Scene` 脱离 `Thread`
- 删除空 `Thread`
- 删除无子节点的 `Scene`

删除限制：

- `Thread` 只有在为空时才能删除
- `Scene` 只有在没有子节点时才能删除

这样可以避免原型阶段为了“智能重接子树”引入新的复杂度。

### 7.6 Toolbar 与布局

当前原型的 toolbar 负责：

- 新建 `Thread`
- 新建游离 `Scene`
- 手动触发自动布局
- `Fit View`

当前自动布局规则：

- 只在点击 toolbar 的“自动布局”时触发
- 不在新增、连线、删除后自动重排
- `Thread` 按 lane 纵向排布
- `Thread` 内 `Scene` 按单链从左向右排布
- 游离 `Scene` 进入单独 orphan lane

- `thread-main` 是父节点
- `scene-1` 是子节点
- 子节点坐标相对父节点计算
- `extent: "parent"` 表示拖拽不能离开父节点边界

### 6.2 嵌套父节点

官方示例支持“父节点里再套父节点”。

这意味着未来理论上可以做：

- `StoryPhase` 外层 Group
- `Thread` 内层 Group
- `Scene` 子节点

但当前项目不建议首版就做双层 group 真相源。  
更稳妥的做法是：

- 首版先把 `Thread` 作为唯一正式 group
- `StoryPhase` 先作为 lane / 列分组
- 后续如果需要折叠，再考虑把 `StoryPhase` 升级成更上层 group

### 6.3 自动扩展父节点

如果子节点设置：

```ts
expandParent: true
```

那么当子节点拖到父容器边缘时，父节点会扩张。

这对通用编辑器很有用，但对当前剧情树图不是首选：

- 我们更希望 `Thread` group 的尺寸由自动布局或显式计算决定
- 不希望作者随便拖一个 `Scene` 就把整个 `Thread` 组撑坏

因此当前项目建议：

- 首版默认不用 `expandParent`

### 6.4 隐藏

官方 `hidden` 示例表明：

- 节点可直接设置 `hidden: true`
- 边也可直接设置 `hidden: true`
- 与隐藏节点关联的边也会一起被隐藏

这非常适合做：

- `StoryPhase` 折叠
- 仅显示 `Thread`
- 展开到 `Scene`
- 主线过滤 / 支线过滤

也就是说，后续分组折叠不需要另找机制，直接基于 `hidden` 即可。

---

## 7. 交互配置

官方 `config.md` 和 `interaction` 示例里，和当前项目最相关的配置如下。

### 7.1 首屏与视口

- `fit-view-on-init`
  - 视口初始化后自动 `fitView`
- `default-viewport`
  - 设置初始缩放和偏移
- `min-zoom` / `max-zoom`
  - 控制缩放范围

### 7.2 拖拽与选择

- `nodes-draggable`
  - 全局是否允许节点拖动
- `elements-selectable`
  - 是否允许选中元素
- `selection-key-code`
  - 选框激活键，默认 `Shift`
- `multi-selection-key-code`
  - 多选键，默认 `Meta`

### 7.3 视口操作

- `zoom-on-scroll`
  - 是否允许滚轮缩放
- `pan-on-drag`
  - 是否允许拖动画布
- `pan-on-scroll`
  - 是否允许滚轮平移

### 7.4 性能

- `only-render-visible-elements`
  - 只渲染当前视口内元素

对于大型剧情树图，这是值得预留的配置。

### 7.5 受控模式

- `apply-default`
  - 默认是 `true`
  - 如果设为 `false`，则需要自己接管 `nodes-change / edges-change`

对当前项目的建议：

- 树图首版先保持 `apply-default = true`
- 不要一开始就进入全受控模式
- 等真正需要把拖拽结果映射为业务命令时，再切到受控模式

---

## 8. 节点内部交互的两个关键类名

这是实现复杂节点时最容易漏掉的点。

### 8.1 `nodrag`

官方 `node.md` 明确说明：

- 默认 `noDragClassName = "nodrag"`
- 给节点内部元素加上 `nodrag`，点击它时不会触发节点拖拽

适用场景：

- 节点内部按钮
- 输入框
- 下拉框
- 右上角菜单

### 8.2 `nowheel`

官方 `node.md` 也明确说明：

- 默认 `noWheelClassName = "nowheel"`
- 给节点内部滚动区域加上 `nowheel`，滚轮不会触发画布缩放或平移

适用场景：

- 长摘要滚动区域
- `refs` 列表
- Scene 细节面板

对剧情树图来说，这两个类名后续基本一定会频繁使用。

---

## 9. 对当前项目的映射建议

这一部分不是官方文档，而是基于当前项目 `plot-system` 的接入建议。

### 9.1 对象映射

建议映射如下：

- `Story`
  - 不作为普通 node
  - 作为树图顶部静态头部信息
- `StoryPhase`
  - 首版作为 lane / 列分组
  - 不立即落成正式 group node
- `Thread`
  - 作为 group node
- `Scene`
  - 作为最小业务节点
- `Plot`
  - 不进入树图主画布
  - 仍在章节视图和右侧检查器里编辑

### 9.2 推荐图模型

```ts
type PlotTreeGraphNodeData =
    | {
        kind: "thread";
        threadId: string;
        title: string;
        isMainThread: boolean;
        tone: "amber" | "sky" | "emerald" | "rose";
        phaseId: string | null;
    }
    | {
        kind: "scene";
        sceneId: string;
        title: string;
        summary: string;
        status: string;
        chapterId: string | null;
        threadId: string;
    };
```

### 9.3 推荐交互范围

首版建议只做这些：

- 选中 `Thread`
- 选中 `Scene`
- 缩放、平移、`fitView`
- 多选
- 在 `Thread` group 内拖动 `Scene`
- 局部隐藏 / 折叠
- `MiniMap` 总览
- `Controls` 视口控制

首版不建议直接做：

- 持久化自由坐标
- 跨 `Thread` 拖动 `Scene`
- 在树图里直接改 `chapterSortOrder`
- 用边表达所有业务关系

### 9.4 对当前 reference 的适配

当前正式 reference 里有两个硬约束：

- `Scene` 必须属于一个 `Thread`
- `StoryPhase` 主要用于分组、检索、浏览，不是剧情主结构

因此树图首版最稳的方案是：

- `Thread` 作为唯一正式 group
- `Scene` 作为 group 内 child node，且同 Thread 内保持单链
- `StoryPhase` 作为上层列分区
- 树图原型层允许游离 `Scene`，但它仍然只是前端 draft 态，不代表后端 schema 已经放开

---

## 10. 推荐的项目接入骨架

如果后续在当前项目里接树图，建议结构如下：

```text
app/components/novel-ide/plot/tree/
  PlotTreeFlow.vue
  PlotTreeCanvas.vue
  PlotThreadGroupNode.vue
  PlotSceneNode.vue
  plot-tree.types.ts
  plot-tree.graph.ts
```

职责建议：

- `PlotTreeFlow.vue`
  - 外层壳、工具条、画布容器
- `PlotTreeCanvas.vue`
  - 真正挂 `<VueFlow>`
- `PlotThreadGroupNode.vue`
  - `Thread` 组节点
- `PlotSceneNode.vue`
  - `Scene` 节点
- `plot-tree.graph.ts`
  - 把 `story / phases / threads / scenes` 转成 `nodes / edges`

不要把这些逻辑全部堆回一个 `PlotTreeView.vue`。

---

## 11. 当前结论

`Vue Flow` 适合当前剧情树图，原因不是“它能画图”，而是它同时满足了这几个关键点：

- 有成熟的节点/边/画布基础设施
- 支持父子嵌套，能表达 `Thread -> Scene`
- 支持 `hidden`，适合做折叠与过滤
- 支持 `Controls` 和 `MiniMap`
- 支持自定义节点，适合做高信息密度的剧情节点
- `useVueFlow` 能提供足够的状态、事件和方法，不需要自己重造一套图编辑器底座

对当前项目来说，最重要的不是把它当成“流程图组件”，而是把它当成：

> 剧情树图视图的画布底座。

---

## 12. 本地参考来源

本整理主要参考以下本地文档与示例：

- `.agent/workspace/vue-flow/docs/src/guide/getting-started.md`
- `.agent/workspace/vue-flow/docs/src/guide/node.md`
- `.agent/workspace/vue-flow/docs/src/guide/edge.md`
- `.agent/workspace/vue-flow/docs/src/guide/composables.md`
- `.agent/workspace/vue-flow/docs/src/guide/vue-flow/config.md`
- `.agent/workspace/vue-flow/docs/src/guide/components/background.md`
- `.agent/workspace/vue-flow/docs/src/guide/components/controls.md`
- `.agent/workspace/vue-flow/docs/src/guide/components/minimap.md`
- `.agent/workspace/vue-flow/docs/src/guide/troubleshooting.md`
- `.agent/workspace/vue-flow/docs/examples/nested/App.vue`
- `.agent/workspace/vue-flow/docs/examples/hidden/App.vue`
- `.agent/workspace/vue-flow/docs/examples/layout/App.vue`
- `.agent/workspace/vue-flow/docs/examples/interaction/InteractionControls.vue`
