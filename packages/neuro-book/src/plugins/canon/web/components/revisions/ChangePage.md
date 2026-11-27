---
标签: [state:inject]
别名: ["变更详情页", "Change Page"]
---

# ChangePage

变更详情页的骨架（[`canon/author-ui.md`](../../../../../../../../docs/specs/canon/author-ui.md) 输出 21、27、28、30、32）。受控：内容由宿主折好（`change.ts` 的 `ChangeModel`，宿主是 `ChangePageHost`）；改一处的确认条由宿主放进 `bar` 插槽；“改成生效”的确认在页面里，预览与原因由宿主给（`activation`）。

## 布局与交互

- 最上面是世界横幅（`WorldBanners`）；`bar` 插槽在内容列最上面（确认条自己吸顶）。
- 页头：文字；一行“安放 · 已写或计划 · 生效状态”（不是生效时用警告色）。待定时下面一块写原因（“待定：与设定冲突。……”），右边“改成生效”（发 `activate`）；点了以后同一块里是预览（带来的变化，一句一行）或“正在预览…”、原因（`role="alert"`），与“取消”（发 `activation-cancel`）、“改成生效”（发 `activation-save`；没有预览、预览中、保存中、`locked` 时不可用）。已撤销时写撤销的原因。
- “讲到它的原句”：每句一行引号里的原句，下面一行出处（“第 2 章正文”“细纲”……）；出处是章节正文的有“打开这一章”（发 `open-chapter`），没找到文件时后面写“没找到这一章的文件”。
- “涉及的条目”：名字，一个一个是链接（发 `open-entry`）。
- “改动”：一处一行，“星瑕的存款 −300”、依据（估计的用警告色）；数的改动旁有“改”（发 `edit`，带下标；按钮带 `data-edit-patch`，宿主保存或取消后据此把焦点放回来）。没有改动时写一句。
- `blocked` 不为空时“改”与“改成生效”不可用，悬停写原因。
- 内容列封顶 760 像素；窄于 480 像素时左右留白变小，没有横向滚动。
- 状态 `loading` 只有“读取中…”（`aria-busy`）；`failed` 只有“没有读出来”（`role="alert"`）；`missing` 只有“找不到这条情节”。

## 数据

```ts
type ChangePageStatus = "loading" | "failed" | "missing" | "normal";

type ChangePageProps = {
    status: ChangePageStatus;
    model?: ChangeModel | null;
    /** 写入入口不可用的原因；默认空。 */
    blocked?: string;
    /** “改成生效”的确认开着时的预览与原因（`change-edit.ts` 的 `ChangeWriteFeedback`）；默认 null。 */
    activation?: ChangeWriteFeedback | null;
    /** 没找到文件的那一章的 id；默认 null。 */
    chapterMissing?: string | null;
    disconnected?: boolean;
    readOnly?: string;
};
type ChangePageEmits = {
    (event: "open-entry", id: string): void;
    (event: "open-chapter", chapter: string): void;
    (event: "edit", index: number): void;
    (event: "activate"): void;
    (event: "activation-save"): void;
    (event: "activation-cancel"): void;
    (event: "retry"): void;
};
```

插槽 `bar`：改一处的确认条（宿主放 `ConfirmBar`）。

## 隐藏通道理由

`state:inject`：经 `useCanonText()` 取宿主注入的翻译端口（命名空间 `nbook.canon`）。
