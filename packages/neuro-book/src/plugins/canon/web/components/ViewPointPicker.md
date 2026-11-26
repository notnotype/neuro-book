---
标签: [state:inject, env:portal]
别名: ["在看", "时间点与故事线", "View Point Picker"]
---

# ViewPointPicker

页头的“在看”（[`canon/author-ui.md`](../../../../../../../docs/specs/canon/author-ui.md) 输出 7、8、34）：这一页的值是哪条故事线、哪个时间点上的。条目页与剧情侧的页面（`PageHead`）共用。受控：选了什么发出什么；线是窗口的，位置与“按计划”是这一页的，都由宿主存。

## 布局

- 一个浅底按钮：“在看”（弱一档）加结论“第 3 章末尾 · 主线”。不止一条线时才写线（按章节自动时写这一页实际读的线，固定看一条线时写那条线）；算上计划时再加“· 含计划”。固定看一条线时按钮是强调色浅底、带分支图标。结论换了按 `nb-ui-switch` 淡入淡出。
- 按钮两边各一个图标按钮，往前、往后一处：一处是“最初”与每章的开头、末尾排成一列里的一项；到头了不可用，悬停写要去哪（“往前一处：第 3 章开头”）或“已经是最初”“已经是最后”。只有“最初”一个位置时不出。
- 按钮左边一格是标记，同时只写一样：原来选的那一章已经不在了（读屏念出），或这时还没出场。可以收窄、文字截断（整句在悬停提示里）。
- 根元素按内容定宽；宿主给它 `w-full`（窄屏的页头）时按钮撑满、下拉箭头靠右。

## 菜单

`Popover`（宽 22rem）锚在按钮上：

- “故事线”一段（不止一条线时）：“按章节自动”（右边小字“当前：线名”）、主线、子线按树缩进加折线图标；当前那一项打勾。选了发 `update:line`（按章节自动是空串）并关上。
- “剧情进度”一段：“最初”（小字“起始设定”），然后一章一行：章号、标题（截断）与“开头”“末尾”两个按钮，选中的那个是强调色实底，当前章这一行有浅底。点了发 `update:position` 并关上。多于 12 章时顶上有搜索框（章号、“第 N 章”、标题里的字），章表约 8 行高、在里面滚，打开时当前章滚到中间；搜不到写“没有对得上的章”。
- 两段的小标题旁各一个 `InfoTip`，悬停看这一段管什么。
- `canPlan` 时最下面“算上计划中的情节”开关，拨了发 `update:planned`，菜单不关。

## 交互

- 点按钮开关菜单；打开时焦点进搜索框（章多时）或当前位置的按钮；Escape 关上、焦点回到按钮。
- 位置按钮是一组单选（`role="radio"`，组名“剧情进度”）：上下键换章（保持开头或末尾那一列），左右键在开头、末尾之间换，Home、End 到头尾；只有当前位置可用 Tab 进来（tabindex 0）。搜索框里按下键进章表。
- `locked` 非空时按钮与前后两步都不可用，悬停写原因。

## 数据

```ts
type ViewPointPickerProps = {
    /** 作品的章（`positions.ts` 的 `positionChapters`，按章序）；没有章时剧情进度只有“最初”。 */
    chapters: readonly PositionChapter[];
    /** 这一页的位置（`positionValue` 的写法）；必填。 */
    position: string;
    planned?: boolean;          // 默认 false
    /** 作品里有计划中的情节：才出“算上计划中的情节”。默认 false。 */
    canPlan?: boolean;
    /** 位置、线与按计划现在都不能换的原因；默认空串（能换）。 */
    locked?: string;
    notAppeared?: boolean;      // 默认 false
    positionGone?: boolean;     // 默认 false
    /** 可选的线，主线在最前；少于两条时不提线。默认空。 */
    lineOptions?: readonly LineOption[];
    /** 窗口在看的线；空串是按章节自动。默认空串。 */
    line?: string;
    /** 这一页按自己的位置实际读的线。默认空串。 */
    resolvedLine?: string;
};
type ViewPointPickerEmits = {
    (event: "update:position", value: string): void;
    (event: "update:planned", value: boolean): void;
    (event: "update:line", value: string): void;
};
```

没有插槽与 expose；attrs 落在根元素上。

## 隐藏通道理由

`state:inject`：经 `useCanonText()` 取宿主注入的翻译端口。`env:portal`：菜单经 `Popover` 传送到 `body`。
