---
标签: [state:local, env:portal]
别名: ["视图实例层", "View Instances"]
验证入口: WorkbenchShellLayout
---

# WorkbenchViewInstances

外壳的两层实例（[`ui/workbench-shell.md`](../../../../../../../docs/specs/ui/workbench-shell.md) 外壳二输出 16–18，[`workbench/views.md`](../../../../../../../docs/specs/workbench/views.md) 输出 3–6）：

- **容器层**：呈现模型里每个常驻容器一个稳定的 [`WorkbenchViewContainerHost`](WorkbenchViewContainerHost.md)，Teleport 到所在 Part 的落点；不是所在 Part 的选中容器、或 Part 没有落点时，退回本组件的停放区。
- **视图层**：每个视图第一次有效可见时建一个实例（[`WorkbenchViewFrame`](WorkbenchViewFrame.md)），Teleport 到容器分节里的落点；没有落点时停放。

移动、换轴、切模式、Part 隐藏与显示都只是换落点，不重建实例；三层 Teleport 共用一份滚动与焦点记忆（`shell/teleport-memory.ts`），每次落点变化前记下焦点、搬完还原，原焦点被停放时交给 `root`。

视图的加载与代际在这里：第一次有效可见才 `load()`；每次加载、每次渲染重试代际加一，工作台存活期内按视图 id 单调；结果回来时代际已变或来源报告作废就丢掉。交付撤回时卸掉组件，再次交付且可见时用新代际加载。

## 布局

自己不占位置：根是 `display: contents`，两块停放区 `display: none` 且 `inert`，停放的内容不进 Tab 顺序与读屏。宿主把它放在外壳根里，与 Part 内容同在 `root` 之下。

## 交互

- 容器网格的尺寸手势与分节的收起开关折成意图经 `intent` 报出（`set-view-sizes`、`set-view-collapsed`）。
- 视图框的“重试”调 `source.retry`、“重新加载”重新加载、渲染出错的“重试”换代重建。

## 数据

```ts
import type {ViewIntent} from "../views/intents";
import type {ContainerPresentation, Presentation} from "../views/presentation";
import type {ViewSource} from "../views/registry";
import type {TeleportMemory} from "../shell/teleport-memory";
import type {DisplayLocale} from "nbook/shared/localized-text";

type Props = {
    /** 呈现模型；受控。 */
    presentation: Presentation;
    /** 交付状态、加载与重试（产品里是视图注册表）。 */
    source: ViewSource;
    /** 每个工具区域选中容器的落点（`WorkbenchToolPartHost` 报上来的）；没有为缺省。 */
    partTargets: Partial<Record<"sidebar" | "auxiliarybar" | "panel", HTMLElement>>;
    /** 此刻看得见的工具区域（未隐藏、未拖到零、面板未收起）。 */
    shownParts: ReadonlyArray<"sidebar" | "auxiliarybar" | "panel">;
    memory: TeleportMemory;
    /** 外壳根：记忆的范围，也是焦点被停放时的去处（应可编程聚焦）。 */
    root: HTMLElement | null;
    locale: DisplayLocale;
    /** 布局未就绪时禁用容器网格的手势；默认 false。 */
    disabled?: boolean;
};

type Emits = {
    (event: "intent", intent: ViewIntent): void;
    /** 各视图实例当前的代际，变化时整表报一次；宿主用它拼“移动到”菜单的目标身份，实例换代时旧菜单随之关闭。 */
    (event: "generations", generations: ReadonlyMap<string, number>): void;
};

type Slots = {
    /** multiple 时每个视图标题行的动作区。 */
    "view-actions"?(props: {viewId: string; container: ContainerPresentation}): unknown;
    /** 容器没有可见视图时的内容。 */
    empty?(props: {container: ContainerPresentation}): unknown;
};
```

没有 expose；attrs 落在根上（`display: contents`，不影响布局）。

## 状态

内部持有容器与视图的落点表、视图实例表（状态、代际、组件定义、上下文）与代际计数，组件销毁即丢。

## 隐藏通道理由

- `env:portal`：容器宿主与视图实例必须跨 Part 与容器搬动而不重建，只能 Teleport 到别的组件树里的落点；落点不存在时内容退回本组件的停放区（`display: none`、`inert`），不留在已脱离的旧落点。

## 不支持

不写记录（意图交宿主），不处理拖放（外壳三）。
