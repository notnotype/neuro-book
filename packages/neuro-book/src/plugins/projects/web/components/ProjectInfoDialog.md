---
标签: [state:local, env:portal]
别名: ["作品信息对话框", "新建作品"]
---

# ProjectInfoDialog

新建作品与编辑作品信息共用的模态对话框（[书架页](../../../../../../../docs/specs/workbench/bookshelf.md) 输出 11、13）。只收集与校验输入：书名必填、至多 80 个字符；简介至多 500 个字符；主题色（只在编辑时）是 `#rrggbb` 或不指定。提交交给宿主，服务端拒绝的原因由宿主经 `error` 显示在表单下方，对话框保留输入。

## 布局

`Dialog` 的 `md` 尺寸；正文是一列表单：书名、简介（三行）、主题色（编辑时）。页脚是取消与确认（新建时写“新建”，编辑时写“保存”）。主题色一行是取色器、当前色值与“不指定”。

## 交互

- 打开时按 `initial` 重置输入与校验结果，书名自动聚焦；回车提交。
- 确认先在本地校验，不过的字段在 `FormField` 上显示原因，不发 `submit`。
- `busy` 时禁止提交与关闭，输入控件禁用。
- 取消、Escape 与遮罩都发 `cancel`，由宿主关闭。

## 数据

```ts
type Props = {
    locale: DisplayLocale;
    open: boolean;
    mode: "create" | "edit";
    initial?: {title: string; description: string; color: string | null};
    busy?: boolean;
    /** 服务端拒绝的原因，已按当前语言写好。 */
    error?: string;
};
type Emits = {
    submit: [values: {title: string; description: string; color: string | null}];
    cancel: [];
};
```

`submit` 的 `title`、`description` 已去掉首尾空白；`color` 是小写的 `#rrggbb` 或 null。

## 不支持

不自己调远程服务，不记住上次的输入；封面图不在本期。
