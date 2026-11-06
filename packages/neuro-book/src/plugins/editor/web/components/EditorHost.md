---
验证入口: EditorGroup
标签: [state:local, state:inject]
别名: ["编辑器区", "Editor Area"]
---

# EditorHost

编辑器区级的东西（[`workbench/editor.md`](../../../../../../../docs/specs/workbench/editor.md)、[`ui/workbench-layout.md`](../../../../../../../docs/specs/ui/workbench-layout.md) 的“边界与兼容”）：无布局，工作台挂一次。承载关闭询问、把标签的拖动交给工作台的手势，并看焦点有没有离开编辑器区。编辑组本身（标签条、提示条、键位）在 [`EditorGroup`](EditorGroup.md)，每块编辑组面板一个。

## 数据

```ts
type Props = {
    /** 编辑器区控制器：组与标签、文档、关闭询问。 */
    area: EditorArea;
    /** 页面标签的来源（输出 33）：拖影的文字要用；缺省 null。 */
    pages?: EditorPageSource | null;
    /** 多行标签（设置 `nbook.editor/wrapTabs`，输出 54）：变了标签条的分区就变了，进行中的拖动取消；缺省 true。 */
    wrapTabs?: boolean;
    /** 挂上时交出标签的拖动（`web/tab-drag.ts`），卸载时交 null。不给时标签不起拖；缺省 null。 */
    attachTabDrag?: ((drag: EditorTabDrag | null) => void) | null;
};
```

无 emits、slots、expose。

## 交互

关闭询问是 nb-ui `Dialog`：标题带文件名，按钮依次是取消、不保存、保存（默认焦点在 Dialog 的规则上）；关闭对话框等于取消。选“保存”后保存期间还能输入，保存完有新输入时再问一次。同一文件还在别的标签里时不问，只有这个视图自己的未裁决输入要问（不保存只丢这份输入）。

焦点：`document` 的 `focusin` 落在编辑组之外（资源管理器、标题栏）时告诉控制器用户离开了（`focusLeft`），撤销还在等控件就绪的焦点交接。控件重挂时焦点暂时落到页面根，页面根不触发 `focusin`，不算离开。

## 隐藏通道理由

- `state:local`：拖动的适配对象只在挂载期间存在，经属性交给工作台，不进控制器。
- `state:inject`：经 `useText()` 取宿主注入的翻译端口，询问的文字、拖影的文字在本插件的目录（命名空间 `nbook.editor`，`../../locales/`）；语言随端口切换，不重新挂载。
