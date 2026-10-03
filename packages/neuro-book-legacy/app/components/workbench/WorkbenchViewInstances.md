---
标签: [state:local, env:portal]
别名: ["视图实例层", "View Instances"]
---

# WorkbenchViewInstances

工具视图的**实例层**：每个视图恰好一个组件实例，用 Teleport 在左栏 / 右栏 / 底部之间搬那段 DOM。

它解决的是「叶子会重排，视图状态不许跟着重排清零」：左右叶显隐、面板尺寸变化都可能让**容器宿主**重挂，视图若挂在宿主里就会跟着销毁——文件树的搜索词、展开节点、局部滚动都会丢。Teleport 只改 DOM 层级、不改逻辑组件树，所以实例的响应式状态、provide 链与主题通道都留在原处，只有那段 DOM 被搬走。这件事只能由「宿主之外的一层」做，所以它是一个独立零件，而不是宿主内部的一段逻辑。

## 布局

- 根模板有三样东西：每个可见视图一个 `<Teleport>`、一块**常驻 parking**（`[data-view-parking]`，`hidden inert aria-hidden`，不占尺寸、不进键盘与可访问树，里面每个 viewId 一个稳定的 `[data-view-parking-target]` 元素），以及一个**默认插槽**（宿主与外壳都渲染在它里面，落点登记走这条通道）。
- 被搬进落点的内容包一层 `.workbench-view-instances__content`：`flex: 1 1 auto` 占满落点——这对应 `layout: "fill"` 的合同，实例层不给留白、不代管滚动。
- 可见但动作受限（`actionable: false` 且有权原因）时，在视图内容上方多一行 `role="status"` 的说明（`data-view-authority-note`）：**权限不足不释放实例**，只说明为什么动作不可用。
- `visible: false` 的条目**不渲染任何东西**：不占位、不留空盒、不卸载宿主（实例被释放，见下）。
- 视图自己决定内部滚动；`390×844` 下与桌面同构，只是宿主给的落点更窄。

## 实例与代际

- 代际（generation）按**视图 id** 分配：视图进入可见集合时拿到一个号，跨位置搬 DOM 不变；真正释放（`visible` 变假、或视图从求值结果里消失）后再可见才换新号。
- 动作回调携带 `{viewId, generation}`：宿主按它认实例，**迟到的回调不会作用到新实例上**。
- 视图重复求值不换身份：`viewFactoryResolver` 只在第一次需要时调用，之后复用同一个组件引用，已挂载的实例不会因为一次重排被换掉。

## 落点发布

- 宿主（`WorkbenchViewHost`）把落点元素登记进 `VIEW_TARGET_REGISTRY`；登记**只更新登记表**，真正的 Teleport 目标在 `nextTick` 之后统一发布——同一次渲染里「旧容器已卸载、新容器还没登记」的那个窗口不能把 Teleport 指向不存在的节点。
- 目标还没登记时**保留旧目标**：实例不销毁，等重新登记后再搬。这是框架拓扑重排（隐藏、最大化、换位置）期间实例存活的关键。
- 反登记按**元素身份**比对：宿主卸载时（Vue 的模板 ref 给 `null`）只撤掉自己登记过的那个元素，旧宿主清理不会删掉新宿主刚登记的同 id 目标。
- 暂失目标（宿主卸载、容器被搬到别处）但视图仍可见时，实例搬到本层的 parking 目标：既不销毁，也不留在已经断开的旧元素里；新目标登记后自动搬回。
- 一次都没有拿到过落点的视图照旧**不实例化**（懒实例化不变）：parking 只接「曾经有落点、现在暂失」的实例。
- 上下文真的不可见或视图从求值结果里消失时，才释放实例并清掉目标。

## 数据

```ts
type Props = {
    /** 统一求值后的视图模型（全量条目；只有 visible 的会渲染成实例） */
    views: readonly WorkbenchViewEntry[];
    /**
     * factory 解析器（**必填**）：产品页面传 `resolveWorkbenchViewFactory`，
     * Lab 与测试传本地白名单。没有内建回退——实例层不静态 import 任何产品叶。
     */
    viewFactoryResolver: (factoryKey: string) => DescriptorResult<Component>;
};

type Emits = {
    /** 某个实例此刻每个动作能不能跑（View 自报，宿主按 target 收下） */
    (e: "view-actions", target: ViewActionTarget, states: readonly ViewTitleActionState[]): void;
    /** 实例交出（或收回）执行句柄；null 表示这个实例不再能执行动作 */
    (e: "view-handle-ready", target: ViewActionTarget, handle: WorkbenchViewActionHandle | null): void;
};

type Slots = {
    /** 宿主与外壳：落点登记靠它 provide 的通道 */
    default?(): unknown;
};
```

- 视图自己的通道是明面的：实例层只认 `actions-change(states)` 与 `action-handle-ready(handle | null)` 两个事件，把它们加代际后转发出去。View 不读命令注册表、也不执行 `commandId`。
- **没有 expose**；根是模板片段（多个根节点），`attrs` **不会被自动继承**——要加属性（`class`、`data-*`）请加在宿主自己的容器元素上，不要指望落在实例内容外面。
- 实例解析失败（未知 `factoryKey`）时在落点里渲染一条 `role="status"` 说明，不静默空白。

## 隐藏通道与理由

- `env:portal`：把每个视图的 DOM 渲染到**登记进来的落点元素**里（左栏 / 右栏 / 底部的容器宿主给的锚点）。目标不存在时：没有发布过的目标就**不渲染该 Teleport**（不报错、不吞内容），已经发布过旧目标就继续用旧目标——实例停在原处等落点回来。理由：实例必须活在「可能重排的叶子」外面，这是整个零件的存在意义；没有它，视图状态会随叶子重排清零。
- `state:local`：代际表、组件表、已发布目标表与落点登记表。它们都是这次挂载期的运行事实，**不写存储**、不跨会话保留。

## 不支持

- 不解析位置与可见性：`views` 是已经求值好的结果（求值归页面/宿主），实例层不做第二套 `when` 判定。
- 不解析 factoryKey：白名单由调用方给，未知键给结构化失败。
- 不画容器装饰（标题、动作、落点样式都归 `WorkbenchViewHost` 与其容器）。
- 不持久化、不读 store、不发请求；`layout` 的留白与滚动合同也不由它折算（它只按 `fill` 包装内容）。

## 注意事项

- 必须作为宿主的**祖先**渲染（产品页面把实例层放在外壳之上），宿主才能把落点登记进来；宿主拿不到这条通道时会在自己那一层给出诊断，而不是静默空白。
- 别给实例层或其中的视图加会变的 `key`：换 key 等于换身份，实例状态会重建——换场景要按「先卸载再挂载」来做，而不是靠 key 抖动。
- 隐藏、最大化的**停放**是外壳的事（外壳把整棵子树搬进停放区并保持 DOM），不要在实例层里做第二套隐藏逻辑，否则焦点与滚动位置会丢。
- 需要「视图跨位置不动」时，同时检查两件事：`views` 里条目的 `visible` 没有变成 false，以及宿主的落点在重排后重新登记过。
