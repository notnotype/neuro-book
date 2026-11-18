---
标签: [state:local, state:inject]
---

# StickerPackNameDialog

表情包页的“新建表情包”与“改包名”对话框（[`agent/stickers.md`](../../../../../../../docs/specs/agent/stickers.md) 输出 31、33）：一个骨架两种用法，包名输入、校验、`Dialog` 的 `status` 行、忙碌、提交后焦点回到输入框都一样，差别是新建多一个显示名，改名多一条警示（旧包名写下的表情会认不出来）与用到这个包的 Profile 名单。

## 布局

`sm` 尺寸的对话框。新建：显示名输入、包名输入、一行小字“写法里用包名：`:cat/名字:`”。改名：新包名输入（预填现在的包名）、一条警示条（标题“用旧包名写的表情会认不出来”，正文举 `:旧包名/…:` 的例子），警示条下一行写用到这个包的 Profile：查找中写“正在查找用到它的 Profile…”，查到了列出名字，查不到（Agent 没起来、出错）写通用的提醒，没有 Profile 用它时不写。页脚是取消与确认（新建写“新建”，改名写“改成 xxx”）。

## 交互

- 包名按文件夹名规则核对（小写字母、数字与连字符，1 到 64 个，不以连字符开头或结尾）；打字途中不报错，提交过一次之后才标红。提交之后才知道的错（已被用）写在页脚状态行并让包名输入得到焦点。
- 回车提交（输入法组字中的回车是选词，不提交）。忙碌时再提交不重复发出。新建的显示名可空。
- 用到这个包的 Profile 名单不挡确认：它没回来时也能提交。

## 数据

```ts
type StickerPackNameDialogProps = {
    open: boolean;
    mode: "create" | "rename";
    /** 改名时现在的包名；新建不用 */
    current?: string;
    busy?: boolean;
    /** 提交之后才知道的错 */
    status?: string;
    /** 改名时用到这个包的 Profile：undefined 在查，null 查不到，数组是名字 */
    usage?: readonly string[] | null;
};

type StickerPackNameDialogEmits = {
    (e: "update:open", value: boolean): void;
    (e: "submit", value: {folder: string; title: string}): void;
    (e: "edit"): void;
};
```

没有插槽与 `expose`，属性不透传。

## 隐藏通道理由

- `state:local`：输入的草稿、是否提交过。
- `state:inject`：文字经表情包插件的翻译端口取（`useStickersPageText`）。
