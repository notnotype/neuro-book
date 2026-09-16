---
标签: [state:local]
---

# WorkbenchViewHost

视图宿主：把**容器的声明**渲染成界面。容器里有哪些视图、哪个看得见、看见的那个由哪个组件画，全部由注册表求值得到——页面上不为视图写 `v-if`，descriptor 里也不放组件。它是 L1 内置注册路径的渲染端，输入只有三样：容器 descriptor、已解析的容器标题、环境事实（`WorkbenchContext`）。

它和「一个画视图的容器」的区别是**视图不是它的**：声明、可见性求值、factoryKey 到组件的映射分别在 `product-catalog.ts` 与 `view-factories.ts` 里，宿主只是那条链的末端。给它一条声明和一份环境事实就能渲染，不需要 store 桩，也不需要真实 Project——这也是它能被 Lab 完整摆出来的原因。

## 分工：谁声明、谁求值、谁解析

- **声明**在 `product-catalog.ts`（容器在 `containers.ts`）：进程里唯一的容器 / 视图清单，注册表按它构建一次。本组件不组装清单，它拿到的 `container` 就是声明里的那一条，`context` 由页面填。
- **求值**也在 `product-catalog.ts`：`resolveContainerViews(registry, container.id, context)` 把容器内视图分成三类——可见的（`views`）、求值失败的（`problems`）、不可见的（`hidden`，各带 `when` 的原因）；`layoutContractOfViews(views)` 给出内容区合同。宿主负责把这三类都画出来，不吞任何一类。
- **解析**在 `view-factories.ts`：`factoryKey` → 组件的第一方白名单。descriptor 里没有组件、没有模块路径、没有 HTML/CSS，「哪个视图用哪个组件」只有那一处映射；宿主只在视图**可见**时才去解析。
- `requiredAuthority`（动作可用性）与 `stateScope`（memento 归属）不在本组件的求值范围内：可见性不是权限，动作能不能点由拥有该动作的宿主判断。

## `when` 求值语义

- `when.requires` 是**封闭枚举**（`project` / `selection` / `user-assets` / `desktop`），不是表达式；全部满足才可见，缺哪条就记下哪条的原因，因此一个视图可能带多条原因。
- 可见性**只决定看不看得见**，不是权限：不可见不等于不可用，可见也不代表动作可执行。
- 原因文案来自 `descriptors.ts` 的取值域（例如「需要打开 Project」），视图自己不带文案；宿主把它们去重后以「；」连接，作为空态说明。
- 未登记的 `when` 取值、未登记的容器 id 都是**失败**而不是「不可见」：它们走 `problems`，与不可见分开显示。

## 数据

```ts
type Props = {
    /** 容器的 descriptor：`id` 用于按容器求值视图；`icon` / `titleKey` 之外的字段归容器部件。 */
    container: ContainerDescriptor;
    /** **已解析**的容器标题；注册表只存 `titleKey`，解析（i18n）归页面。 */
    containerTitle: string;
    /** 环境事实：`when` 求值的唯一输入。本组件不 import store、不读 window。 */
    context: WorkbenchContext;
    /** 测试注入的注册表；缺省用产品注册表（`productWorkbenchRegistry()`）。 */
    registry?: WorkbenchRegistry;
    /** 测试注入的 factory 解析器；缺省用产品白名单（`resolveWorkbenchViewFactory`）。 */
    viewFactoryResolver?: (factoryKey: string) => DescriptorResult<Component>;
};
```

**扩展面**：没有 emits、没有 slots、没有 `expose`；`attrs` 透传到根上——根就是容器部件 `WorkbenchContainerSurface` 的单根 `<section class="workbench-container">`，`data-lab-subject` 这类属性落在它上面。

可核对的事实属性：根带 `data-container` / `data-container-location` / `data-container-part` / `data-container-layout`（都来自容器部件）；内容区一层带 `data-view-host`；每个视图一个 `data-view="<视图 id>"` 锚点，锚点里要么是该视图的组件，要么是它失败的诊断。

## 布局

卡片（头部 + 内容区）归容器部件，本组件只填内容区：一列纵向排布，高度吃满，`min-height: 0` 一路传下去。

- 每个视图锚点 `flex: 1 1 auto`——视图自己占满内容区（`layout: fill` 的合同：容器不给留白、不代管滚动，视图自己接内部滚动）；`scroll` 档的留白与滚动归容器部件。
- 内容区合同取**第一个可见视图**的 `layout`；一个可见视图都没有时用默认合同（`scroll`）。多个可见视图共用这一份合同——内容区只有一块。
- 提示行的顺序固定：先是注册表级问题（容器求值失败一类），再按视图顺序排视图级诊断，最后才是空态说明。提示与空态都用 `role="status"`，颜色取 `--status-warning` / `--text-muted`。
- 宿主不给视图加任何装饰（不套卡片、不加 margin）；视图之间也不插分隔线——本版内容区一次只承载一件东西。

## 交互

宿主自己不接受任何用户输入：没有按钮、没有键盘处理、没有浮层，交互全在被渲染的视图里。

`context` 变化不是「刷新」而是重算：已经解析过的视图按 id 复用同一份组件引用（不会因为重算被换身份重建），判为不可见或从容器里消失的视图直接出 DOM（`hidden` 只留原因，不留实例），再次可见时重新解析——白名单是静态映射，拿回同一个组件，但挂载状态不保留。

## 状态

- 有可见视图：渲染它们，内容区按第一个的合同呈现。
- 没有可见视图：显示空态说明，文案来自各不可见视图的 `when` 原因（去重、以「；」连接）。一条原因都没有（容器里本来就没有视图）时它是空的——组件不做 i18n，不自己编文案。
- 容器 id 不在注册表里：容器照画（标题还在位），问题作为提示行显示，不静默变成空白。
- `factoryKey` 不在白名单里：视图锚点保留，锚点里显示诊断（例如「未登记的内置 factoryKey：…」）——失败可见是这条链的硬要求，宁可显示诊断也不显示空白。
- 产品注册表构造失败（清单非法）：显示那一条原因，视图一个都不渲染。
- 注入的注册表（`registry`）优先于产品注册表；注入后产品单例不再被读取。

## 不支持

- 不读 store、不读 Storage（`localStorage` / `sessionStorage` / IndexedDB）、不发请求、不注册全局监听：环境事实只从 `context` 进来；展开项一类 memento 归视图自己的会话层（例如 `files-view-session.ts`）。
- 不做 i18n：容器标题与视图标题的解析归页面，`when` 原因与诊断文案来自声明层。
- 不做拖动、移动与隐藏落账：`canToggleVisibility` / `canMoveView` 在本版没有消费者，宿主只渲染声明说可见的那些视图。
- 不判权限、不求值 `requiredAuthority`。
- 不认插件声明：L1 只有内置白名单；安装账本、权限与沙箱属 L3。
- 不做几何：卡片落在哪个叶、多宽、四周留白多少，全归外壳。

## 注意事项

- **必须待在确定高度里**：根卡片是 `height: 100%`，放进自动高度的父级里，`fill` 与 `scroll` 都无从判断。
- `containerTitle` 要传**已解析**的标题（`t(container.titleKey)`），不是 key。
- 两处注入是测试缝隙：注入 `registry` 后产品单例不再被读取；注入 `viewFactoryResolver` 后产品白名单不再是唯一解析路径（Lab fixture 用它替掉需要 store 的叶）。产品页面两个都不传。
- 诊断文案是给开发者的（中文、来自声明层），不是终端用户文案；要面向用户就得在页面另做一层。
- `fill` 档的视图要**自己**给内容留白并接内部滚动，否则内容会贴卡片边缘、溢出部分被裁掉。
