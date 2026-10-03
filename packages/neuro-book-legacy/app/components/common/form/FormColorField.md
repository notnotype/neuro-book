---
标签: [state:local, state:inject, env:portal, env:global]
---

# FormColorField

颜色文本字段与取色器组合控件：可直接输入颜色字符串，也可打开调色盘或（浏览器支持时）系统吸管，并且只把有效颜色回写给父组件；无效草稿会保留在输入框并明确标错，不污染受控值。

## 布局

标签与可选 CSS 变量名在上，色块按钮、颜色文本框和可用时的吸管按钮在同一行。非空的无效草稿在控件下方显示错误提示。调色盘以 fixed 浮层放置，接近视口边缘时会翻转或横向收敛；视口滚动、尺寸改变时关闭。窄屏下变量名不收缩，文本框可压缩；外层应提供合理宽度。`label` 只渲染可见文字，不与输入框建立程序化关联。

## 交互

编辑文本会更新本地草稿并发 `valid-change`；只有 colord 识别为合法的值才发 `update:modelValue`，回写字符串先去首尾空白。点击色块开关调色盘，`allowAlpha` 开启且选色有透明度时发 rgb 字符串，否则发 hex；可用吸管按钮时点击会请求系统取色，用户取消时静默忽略。Esc 只关闭本控件调色盘并阻止继续冒泡。禁用时关闭调色盘，输入、色块和吸管均不可用。

## 数据

```ts
interface FormColorFieldProps {
    /** 当前有效颜色；必填、受控。组件不以无效草稿改写它。 */
    modelValue: string;
    /** 上方字段标签；默认空字符串、不显示。 */
    label?: string;
    /** 上方显示的 CSS 变量名；默认空字符串、不显示。 */
    variableName?: string;
    /** 输入提示；默认 "#000000"。 */
    placeholder?: string;
    /** 是否允许 alpha；默认 true。 */
    allowAlpha?: boolean;
    /** 是否禁用；默认 false。 */
    disabled?: boolean;
    /** 第三方调色盘明暗主题；默认 "white"。 */
    pickerTheme?: "white" | "black";
}

interface FormColorFieldEmits {
    /** 每次草稿输入或取色时都报告有效性。 */
    (event: "valid-change", value: boolean): void;
    /** 仅有效颜色变化时发出，值已 trim。 */
    (event: "update:modelValue", value: string): void;
}
```

没有 slots、没有 expose；未声明 `inheritAttrs: false`，attrs 落在根 `<div>` 上，不能通过 attrs 给内部输入框增加原生属性。

## 状态

初始有效值显示对应色块；初始或编辑后的无效值显示警示色块边框与错误提示，等待新输入但不会把无效文本传给父级。`disabled` 时视觉变淡且不能输入或打开取色器。吸管按钮只在浏览器挂载时检测到原生 EyeDropper API 才出现。组件不展示加载态。

## 不支持

不提供颜色变量格式以外的业务校验、不写主题配置、不持久化、不从图片或文件导入颜色；不支持原生 EyeDropper 的浏览器没有屏幕取色入口。

## 上游边界

`vue3-colorpicker` 提供调色盘交互与控件外观，`colord` 判断并格式化颜色。本组件承诺 alpha 开关、受控值、有效性事件、无效草稿保留和弹层定位；第三方调色盘内部布局、可用颜色控件和未来版本细节不作承诺。

## 隐藏通道理由

- `state:local`：编辑草稿、调色盘开合、弹层坐标和 EyeDropper 能力检测结果仅在组件实例内有效；props 变化时同步草稿。
- `state:inject`：通过应用 `useI18n()` 取得取色、吸管与错误提示文案；语言随宿主切换，不适合逐条由父组件传入。
- `env:portal`：调色盘需脱离滚动容器裁切并保持层叠顺序，Teleport 到最近的 `.novel-ide-theme`；未找到时回退 `body`。
- `env:global`：组件注册文档 scroll、window resize 与 document keydown 监听，使弹层坐标稳定并让 Esc 关闭只作用于此弹层；VueUse 点击外部监听也负责关闭。监听由 VueUse 随组件卸载清理。
