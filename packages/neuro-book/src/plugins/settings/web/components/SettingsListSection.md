---
标签: [state:inject]
别名: ["设置通用列表", "Settings List Section"]
验证入口: SettingsWindow
---

# SettingsListSection

设置窗口里 list 分区的内容（[`settings/settings-window.md`](../../../../../../../docs/specs/settings/settings-window.md) 输出 2、9–12）：按窗口模型给的分组列出配置项，每项一个 [`SettingsRow`](../../../../ui/settings/SettingsRow.md)，行里放 nb-form 的 [`SchemaField`](../../../../../../nb-form/src/vue/SchemaField.md)（`bare`，id、名字与说明来自行，配置项声明经 `setting-form.ts` 转成表单提示）；改值经窗口模型写当前标签那一层（用户编辑路径），行自己的“恢复默认”等经模型的 `editing` 服务。窗口画分区的标题与说明，这里从第一组开始。

## 布局

自上而下：没有小标题的一组（分区最前）、各小组（小标题加一条分隔线）。搜索结果里每个命中的分区与小组各是一组，小标题写“分区名 › 小组名”（分区名淡色；没有小组时只写分区名，按正常色）；传入 `highlight` 时，行的标题与说明里命中的字标底色。每组里的行竖排。控件按表单选出（`widgetLayout`）：多行、竖排单选、复选组、列表、对象与 JSON 用宽排法，其余排在标签右边，下拉 220px、数字框 120px，单行输入 200 到 320px（小组的宽度减去标签列、间距与最右一格的位置，剩不到 200px 才整行换到标题下面），分段控件、单选组与开关按内容。本作品标签下，分区末尾一行淡色字列出“仅可在用户设置中修改”、因此没有列出的项（用户标签下同理，写“仅可在本作品中设置”）。

## 交互

- 控件改值：表单按提交时机（`commit: "change"`：输入框失焦或回车，其余立即）发出新值，调 `window.write`；结算之前控件显示这次的值（`window.pending`），失败时窗口发通知、控件回到层里的实际值。
- 结构字段（字符串列表、对象、对象列表、JSON）的新值不合 schema 时（例如刚加的一项还没填）先留在行里、不写；行标题后的出错图标提示“未保存：<第一条原因>”，填好合格了再写。改回层里原来的值时不写。层里的值变了（恢复默认、别处改了）、切换标签或换分区时丢掉。
- 数字框、JSON 里写的内容解析不了时不写，同一个图标提示原因；改好或草稿丢掉后消失。
- 行的写入失败：交给 `window.rowFailed` 发通知。
- 状态原因：行标题后只有一个图标（`SettingsRow` 的 `reasons`），提示按出错、警告、状态逐条列出。出错只取“未保存”这一条（由 `describeIssues` 算）；警告与状态（选项源不可用的原因、“已不存在”）取自 `SchemaField` 的 `field-state`，行不再在控件下面写文字。原因的读屏文字经行交给控件的 `aria-describedby`。
- 动态选项（`choices: {from}`）：每个字段拿到窗口的选项源（`window.options()`，输出 20）；提供者加载中、不可用时控件停用，不可用的原因（“无法加载选项：…”）与“已不存在”收在行的状态图标里。

文字选择：小组标题不可选（见 nb-ui 开发规范的“文字能否选中”）。

## 数据

```ts
import type {SettingsSectionView, SettingsWindow} from "../settings-window";

type Props = {
    /** 窗口模型：当前标签、显示语言、书名、写入与 `editing` 服务。 */
    window: SettingsWindow;
    /** 当前 list 分区的视图（分组与没有列出的项）。 */
    view: Extract<SettingsSectionView, {kind: "list"}>;
    /** 搜索结果里要标出的词（小写）：行的标题与说明里命中的字标底色（`HighlightedText`）；缺省不标。 */
    highlight?: ReadonlyArray<string>;
};
```

没有 emits、slots、expose；attrs 落在根上。根带 `data-settings-list`（分区 id），每组带 `data-settings-group`（小组 id，分区最前的一组为空；搜索结果里是“分区 id#小组 id”），末尾的说明带 `data-settings-excluded`。

## 隐藏通道理由

- `state:inject`：经 `useText()` 取宿主注入的翻译端口，固定文字在 `nbook.settings` 的目录里（`plugins/settings/locales/`；`list.*` 键）；语言随端口切换，不重新挂载，组件没有语言属性。字段（`SchemaField`）与“未保存”的原因（`describeIssues`，经 `useFormText()`）用同一个端口取表单的文字，宿主同样登记了 nb-form 的目录。设置窗口里的页面与 SDK 交给第三方插件的设置页都在宿主窗口里，宿主总会登记这份目录。没有宿主注入时得到 nb-ui 的缺省端口，那里没有这份目录，只显示键名，所以测试与 Lab 场景要注入登记了它的宿主引擎端口。
