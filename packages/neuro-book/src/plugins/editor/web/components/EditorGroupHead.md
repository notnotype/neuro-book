---
标签: [state:inject]
别名: ["编辑组的头", "Editor Group Head"]
验证入口: EditorGroup
---

# EditorGroupHead

一个编辑组的头（[`workbench/editor.md`](../../../../../../../docs/specs/workbench/editor.md) 输出 34、53 到 58；[`ui/workbench-layout.md`](../../../../../../../docs/specs/ui/workbench-layout.md) 输出 21）：提示条、标签条、标题动作与标签的右键菜单。它和工具面板的头一样画在工作台的外框里，内容（[`EditorGroup`](EditorGroup.md)）从它下面开始，头高了内容立刻让开。它是宿主：按组 id 读编辑器区控制器，把用户动作交回控制器。

## 数据

```ts
type Props = {
    area: EditorArea;
    groupId: string;
    /** 页面标签的标题；缺省 null。 */
    pages?: EditorPageSource | null;
    /** 标签条右侧的标题动作（输出 34）：只有活动组拿到（`group` 是这一组），别的组为 null；缺省 null。 */
    titleActions?: {group: string; model: (maxButtons: number) => TitleActionsModel; identity: string} | null;
    /** 标签的右键菜单（输出 57，`web/tab-menu.ts` 算好）；缺省 null，右键不出菜单。 */
    tabMenu?: {entries: (tabId: string) => ReadonlyArray<TabMenuEntry> | null; identity: (tabId: string) => string | null} | null;
    /** 多行标签（输出 54），交给 `EditorTabBar`；缺省 true。 */
    wrapTabs?: boolean;
};

type Emits = {
    /** 组里有焦点时按下 Ctrl+S、Ctrl+W、Ctrl+\：宿主执行保存、关闭、向右拆分的命令。 */
    (event: "intent", intent: "save" | "close" | "split-right"): void;
    /** 点了标题动作：交出它的 key，由宿主执行。 */
    (event: "title-action", key: string): void;
    /** 点了标签菜单的一项：交出被右击的标签 id 与项的 key，由宿主执行。 */
    (event: "tab-menu", tabId: string, key: string): void;
};
```

无 slots、expose；attrs 落在根上（`data-editor-group-head` 是组 id，活动组另有 `data-editor-group-head-active`）。标签条那一行写 `data-panel-strip`，是工作台的拖动量插入位的地方。

## 布局与状态

纵向：提示条（只有活动组，不收缩）、标签条一行到三行（组矮时先收它，至少一行，在自己里面纵向滚动）。标题动作落在最后一行的右侧，不随标签滚动、不收缩，宽度按这一行算放几个按钮；随鼠标显示的范围是整块面板（工作台的 `data-hover-actions-scope`）。没有标签时标签条是空的一行。

键位、焦点进出、主键按下换活动组、文件拖放落点和内容根一样接（`useEditorGroupRoot`）。

## 不支持

不处理标签的拖动（工作台的手势，见 `EditorHost`）。不执行命令。不画正文。
