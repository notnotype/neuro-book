---
标签: [state:inject]
别名: ["条目页", "Entry Page"]
---

# EntryPage

条目页的骨架（[`canon/author-ui.md`](../../../../../../../docs/specs/canon/author-ui.md) 输出 6 到 9、27）：页头、状态说明、分页条；分页的内容是默认插槽。受控：位置、“按计划”、当前分页都由宿主给（`EntryPageHost`），交互时发出新值。

## 布局与交互

- 最上面是世界横幅（`WorldBanners`）：断开时“世界已断开”与“重试”，世界只读时写原因（输出 28）；内容留着。
- 页头：名字（马甲条目后面是“是谁：某某”，某某是链接）、一句话简介；右边是位置选择与“按计划”开关；下面是分页条（左右方向键切换，每个分页项有 id，内容区 `role="tabpanel"` 用 `aria-labelledby` 指向当前分页）。页头与内容列都封顶 760 像素；宽度不够时位置选择换到下一行。视口宽于 480 像素时页头吸顶；更窄时页头换成几行，吸顶会占掉大半个视口，不吸顶。
- 内容区上方按需有两行说明：“原来选的那一章已经不在了”（`role="status"`）、“在某位置还没出场”。
- 状态 `loading` 只有一行“读取中…”（`aria-busy`）；`failed`（第一次读取就失败了，例如连不上项目）只有“没有读出来”（`role="alert"`）；`missing` 只有“找不到这个条目”；`deleted` 只有原来的名字与“这个条目已删除”。这四种都没有页头控件与分页。

- 位置与开关后面是“更多”（只有图标的按钮，可读名“更多”），里面有“删除条目”（危险色；`deletable` 为 false 时不可用）。

事件：选位置发 `update:position`，拨开关发 `update:planned`，切分页发 `update:tab`，点“是谁”的链接发 `open-entry`，点“重试”发 `retry`，选“删除条目”发 `delete`（确认对话框在宿主里）。

## 数据

```ts
type EntryPageStatus = "loading" | "failed" | "missing" | "deleted" | "normal";

type EntryPageProps = {
    status: EntryPageStatus;
    name?: string;
    summary?: string;
    sameAs?: {readonly id: string; readonly name: string} | null;
    /** nb-ui `Select` 的选项。 */
    positions?: readonly SelectOption[];
    position?: string;
    planned?: boolean;
    /** 在所选位置上还没出场时，所选位置的文字；默认空（已出场）。 */
    notAppeared?: string;
    positionGone?: boolean;
    disconnected?: boolean;
    /** 世界只读的原因；默认空（可以写）。 */
    readOnly?: string;
    /** nb-ui `Tabs` 的项。 */
    tabs?: readonly TabsItem[];
    tab?: string;
    /** “删除条目”可用；默认 false。 */
    deletable?: boolean;
};
```

默认插槽是当前分页的内容，放在 `role="tabpanel"` 里。

## 状态

见上面四种 `status`、断开与只读。禁用、只读：写入入口不在这里。

## 隐藏通道理由

`state:inject`：经 `useCanonText()` 取宿主注入的翻译端口（命名空间 `nbook.canon`）。
