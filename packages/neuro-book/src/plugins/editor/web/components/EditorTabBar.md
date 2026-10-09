---
标签: [state:local]
别名: ["标签条", "Tab Bar"]
---

# EditorTabBar

编辑组的标签条（受控）：每个打开的标签一项，preview 标签用斜体，有未保存修改的标签在关闭按钮的位置显示圆点（悬停时换回关闭）。

## 数据

```ts
type TabItem = {id: string; label: string; title: string; preview: boolean; dirty: boolean; active: boolean};

type Props = {
    tabs: ReadonlyArray<TabItem>;
    /** tablist 的可访问名称。 */
    label: string;
    /** 关闭按钮的可访问名称（参数是标签名）。 */
    closeLabel: (label: string) => string;
    /** 未保存标记的读屏文字。 */
    unsavedLabel: string;
};

type Emits = {
    activate: [id: string];
    /** 双击：preview 转正。 */
    pin: [id: string];
    close: [id: string];
    /** Alt+←/→：同组里移动一位。 */
    move: [id: string, delta: -1 | 1];
};
```

## 交互

`role="tablist"`，标签是 `role="tab"` 的按钮，只有活动标签在 Tab 顺序里（roving tabindex）。←/→ 换到相邻标签（循环）并激活，Home/End 到首末，Delete 关闭当前标签，Alt+←/→ 移动；中键点击关闭。关闭按钮不进 Tab 顺序，键盘用 Delete。标签放不下时横向滚动。

`state:local`：标签列表元素的引用，用来在键盘切换后把焦点放到新的活动标签上。
