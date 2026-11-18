---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: ui.sortable-list
owners:
  - nb-layout
---

# 可拖动排序的分组列表

## 目标与非目标

给界面一份“几组竖排的项，拖动或用键盘排序、可以跨组”的共用做法：拖动是实时布局，被拖的那一行跟手，邻居让开，预览就是放下后的样子，不画落点线；手势沿用布局拖动的会话（[ui.layout-drag](layout-drag.md)），起拖门槛、取消与键盘和工作台一致。nb-layout 的 Vue 层提供 composable `useSortable`（手势、判定、预览、播报）与薄组件 `SortableList`（分组的竖排列表，每行由宿主用插槽画）。第一个使用方是状态栏设置页（[agent.conversation](../agent/conversation.md) 输出 46）。

不承诺：网格形状；横排只按轴对称实现，没有使用方验证；自动滚动（列表长到要滚时的边缘滚动）；触摸拖动没有在真机上验证。

## 术语与参与者

- **分区**：一组项，有标题；项可以在分区之间移动。
- **位置**：`{section, index}`，某个分区里按移走被拖项之后的次序数的第几位。
- **把手**：每行行首的按钮，键盘从它拿起，触摸从它起拖。
- 拿起、放下、取消、实时布局与落点的意思同 [ui.layout-drag](layout-drag.md) 与 [ui.workbench-layout](workbench-layout.md) 输出 38。

## 输入与前置条件

```ts
interface SortableSection { readonly id: string; readonly keys: readonly string[] }
interface SortableSlot { readonly section: string; readonly index: number }
interface SortableMove { readonly key: string; readonly from: SortableSlot; readonly to: SortableSlot }

// composable：调用方自己画行，按约定写 data-sortable-key、data-sortable-handle、data-sortable-head、data-sortable-placeholder。
function useSortable(options: {
    root: Readonly<Ref<HTMLElement | null>>;
    sections: () => readonly SortableSection[];
    axis?: "vertical" | "horizontal";
    disabled?: () => boolean;
    label: (key: string) => string;
    sectionLabel: (section: string) => string;
    onMove: (move: SortableMove) => void | Promise<unknown>;
}): {preview: ComputedRef<readonly SortableSection[]>; held: Readonly<Ref<string | null>>; announcement: Readonly<Ref<string>>};

// 组件：sections 带标题；move 是函数属性（`@move` 写法照常），返回 Promise 时放下后的次序留到它 settle。
type SortableListProps = {
    sections: readonly {id: string; title: string; keys: readonly string[]}[];
    label: (key: string) => string;
    disabled?: boolean;
    move?: (move: SortableMove) => void | Promise<unknown>;
};
// 插槽 item：{key, held, section}，画一行除把手以外的内容。
```

## 输出与可观察行为

1. 指针在一行上按下并移过起拖门槛就拿起，抓住的那一点一直在指针下；按在行里的按钮、输入框、链接上不起拖，那些控件照常工作。触摸只从把手起拖（按住），行的别处留给页面滚动。
2. 拿起后被拖的那一行沿列表的轴跟手，夹在第一个分区头到最后一个元素（含空分区的占位）之间；它的底不透明，盖在邻居上，有一层抬起的投影；行的悬停底色在拖动中不出现。
3. 判定同标签条（[ui.workbench-layout](workbench-layout.md) 输出 38“标签条上”）：往后拖时，被拖行的后沿过了下一个邻居的中线，那个邻居就让到它前面；往前拖时前沿过了上一个邻居的中线，同理。分区头也算一个邻居，过了它就进了那一区的开头；空分区显示一行“拖到这里”，拖进去就是那一区的第 0 位。邻居按 `--motion-move` 滑开，预览就是放下后的样子；不画落点线。
4. 拖动中不调 `onMove`。松手时按指针下的位置提交，回到原位置不提交；一场至多提交一次。放下后被拖的那一行从跟手的位置滑到它的位置。
5. `onMove` 返回 Promise 时，放下后的次序留到它 settle：宿主写成功时 `sections` 已是新次序，失败时回到原样；这段时间不能再拿起。
6. Esc、窗口失焦、指针被系统取消时整场取消：次序回原样，零提交。拖动中 `sections` 的次序或分区被别处改了，整场取消。`disabled` 中途变真时整场中止。
7. 键盘：把手是可聚焦的按钮，可访问名是“移动 某项”，描述指向所在分区的标题。在把手上按空格拿起；上下键（横排是左右键）一步一位，跨分区，空分区的第 0 位也停；Home、End 到两端；回车放下，Esc 取消，之后焦点回到这一项的把手。拖动中按 Tab 回到第一个位置（只有一个区域时会话的规则）。键盘一场不跟手，被拖的那一行就在它当前的位置上，样子同拿起。
8. 读屏：分区头仍是标题；拿起、换到某区第几位、放下、取消各播报一句（常驻的 `role="status"`，只在语义变化时更新），位置写区内的第几位。
9. 系统减少动效时，让位与回位直接到位（时长令牌为 0）。

## 状态与转换

| 状态 | 进入 | 离开 |
|---|---|---|
| 空闲 | 初始；一场结束；等写入的 Promise settle | 起拖、键盘拿起 |
| 拖动中 | 过门槛或空格 | 松手（提交或回原位）、取消 |
| 等写入 | 提交时 `onMove` 返回 Promise | 它 settle |

时序与寿命：

- 列表根挂上时建手势会话，根换掉或卸载时释放；释放后不再有任何窗口级监听。
- `preview` 在拖动中与等写入时是放下后的样子，其余时间等于 `sections()`。
- 判定在拖动中每次都按当前的布局量（相对列表根，不含正在走的位移），所以页面滚动、窗口改尺寸之后照样对；判定本身不改任何状态。

## 副作用与数据

无持久数据；排序结果由宿主经 `onMove` 写到它自己的存储。

## 失败与恢复

| 情况 | 结果 | 恢复 |
|---|---|---|
| `onMove` 的 Promise 失败或宿主没采纳 | 次序回到 `sections()` | 宿主自己说明原因（例如设置写入通知） |
| 拖动中结构变了、`disabled` 变真 | 整场取消或中止，零提交 | 重新拖 |

## 边界与兼容

公开接口是 `@notnotype/nb-layout/vue` 导出的 `useSortable`、`SortableList` 与上面的类型；位置判定的纯函数在 `@notnotype/nb-layout`。行内容由宿主的插槽画，组件不管行里的控件。

## 验收与 Smoke

1. 真实浏览器：两组，指针把右边第一项拖到左边第一位，拖动中邻居让开、被拖的行背景不透明，松手后提交一次 `{from: right 0, to: left 0}`；把一组全部拖空，再从另一组拖进空组的占位；拖到一半按 Esc，次序回原样、零提交。
2. 宿主写入要 600ms：放下后次序一直是放下的样子，不闪回；写入失败时回原样。
3. 键盘：Tab 到把手，空格拿起，下键跨过分区头，回车放下，焦点回到把手，读屏播报“已放到某区第几位”。

Smoke：Lab 的 `SortableList` 场景，`packages/neuro-book/e2e/lab-sortable-list.e2e.ts`。

## 证据

- 批准依据：[w00032 t38 的评审板与计划](../../../.agents/works/w00032-agent-integration/tasks/t38-status-line-sorting/README.md)（决定 2、4、6，开发者 2026-11-18 确认）
