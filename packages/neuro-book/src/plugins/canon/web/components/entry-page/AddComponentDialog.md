---
标签: [state:local, state:inject, env:portal]
别名: ["添加模块", "添加模块", "Add Component Dialog"]
---

# AddComponentDialog

条目页“添加模块”的对话框（[`canon/author-ui.md`](../../../../../../../../docs/specs/canon/author-ui.md) 输出 38）：模块多到几十个时也好选，能一次勾几个模块，顶上点一个模板就勾上它的几个模块。受控：开不开、列哪些、写入在途与失败的原因都由宿主（`EntryPageHost`）给，它只把作者的选择翻成事件。打开它的按钮（分页条后面的“＋”、竖排的“添加模块”）归 `EntryPage`。

## 布局与交互

- nb-ui `Dialog`（中号，390 宽时左右各留 16 像素），标题“添加模块”；正文是 `ComponentChecklist`（列表封顶约 22rem，超出在里面滚）；页脚左边是状态行，右边“取消”与主按钮。
- 主按钮：勾了 N 组时写“添加 N 组”，没勾时写“添加”且不可用；按钮上写快捷键（Ctrl 或 ⌘ 加回车，读屏名不含它）。点它或在列表里按 Ctrl（⌘）加回车发 `add(勾着的类型)`。
- 在已添加的那一行上按回车或点它：发 `show(类型)`（宿主切到那一页）并关上。
- 每次打开时勾选清空。写入在途（`busy`）时按钮不可用、对话框不关；失败的原因（`error`）写在状态行，勾选留着。
- 关上时焦点回到打开它的那个按钮（`Dialog` 还焦点给打开前的元素）；关完发 `closed`，加完最后几个模块、按钮跟着没了时宿主在这里另放焦点。

## 数据

```ts
type AddComponentDialogProps = {
    open: boolean;
    items: readonly ChecklistItem[];
    /** 条目的种类：列表里“适用于”那个模块。默认空串。 */
    kind?: string;
    /** 这个种类的模板（`kindPresets`）。默认空。 */
    presets?: readonly ChecklistPreset[];
    /** 写入在途。默认 false。 */
    busy?: boolean;
    /** 写入失败的原因，写在状态行。默认空串。 */
    error?: string;
};

type AddComponentDialogEmits = {
    (event: "update:open", value: boolean): void;
    /** 加上这几个模块（类型 id，次序同勾的先后）。 */
    (event: "add", types: readonly string[]): void;
    /** 切到条目上已经有的这个模块。 */
    (event: "show", type: string): void;
    /** 关上、内容卸载并把焦点还回去以后。 */
    (event: "closed"): void;
};
```

没有插槽与 expose；attrs 不透传（根是对话框的传送）。

## 隐藏通道理由

- `state:local`：勾着的几个模块（每次打开清空）。
- `state:inject`：经 `useCanonText()` 取宿主注入的翻译端口。
- `env:portal`：对话框传送到 `body`（nb-ui `Dialog`）。
