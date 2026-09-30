---
标签: [state:local, env:global]
---

# LowCodeComboboxField

低代码表单里的可搜索单选字段：在一行输入框中显示当前选项标签，聚焦后打开候选列表，输入文字可按标签、值或说明过滤。它兼有 `LowCodeSelectField` 的受控单选值和搜索能力，但不会请求远端候选，也不接受选项之外的新值。

## 布局与交互

触发器占满父容器宽度，包含文本输入和右侧展开按钮。候选面板与触发器同宽，最多 224px 高，空间不足时可向上展开；列表本身滚动，不撑高外层。390px 窄屏下仍为输入框加箭头的一行布局，候选内容在面板内滚动。

聚焦输入框会清空搜索词并打开面板；输入文字会过滤候选项，匹配规则为对 `label`、`value` 字符串表示和 `description` 做不区分大小写的包含匹配。点击箭头切换开合，点击可用候选后发出对应原始 value 并关闭面板、清空搜索词；点击组件外部关闭。候选是原生按钮，可用标准 Tab / Enter 操作；组件没有上下方向键选择实现。

## 数据

```ts
import type {LowCodeFieldDto, LowCodeJsonValue} from "nbook/shared/dto/low-code-form.dto";

interface LowCodeComboboxFieldProps {
    /** 字段 DTO；必填。本组件读取 options 的 value、label、description、disabled 和 placeholder。 */
    field: LowCodeFieldDto;
    /** 当前 JSON 值；受控，默认 null。 */
    modelValue?: LowCodeJsonValue;
    /** 禁用输入与展开；默认 false。 */
    disabled?: boolean;
}

interface LowCodeComboboxFieldEmits {
    /** 选中可用候选项时发出该项 DTO 中的原始 value。 */
    (event: "update:modelValue", value: LowCodeJsonValue): void;
}
```

无 slots、无 `expose`。未声明 attrs 按 Vue 默认落到根 `div`，不会转到内部输入框或箭头按钮。

## 状态与边界

- 默认：若 `modelValue` 精确匹配一个选项，输入显示其 label；否则显示 JSON 值格式化文本，缺省 null 显示 `null`。
- 未匹配搜索：过滤后无候选时不渲染候选面板，没有自定义空结果提示。
- 当前值不在选项中：保留显示格式化的原值，不自动清空或选择首项。
- 禁用：输入框只读、箭头禁用，面板不显示；现有值仍可见。
- 单项禁用：候选仍显示但按钮不可选择。
- 出错或加载：没有独立错误、加载和校验状态；字段 issues 由 `LowCodeFieldShell` 显示。

## 不支持

- 不支持远端搜索、异步加载、自由文本提交、选项分组或键盘方向键漫游。
- 不支持把选项值转换为字符串；选择事件保留 DTO 中字符串、数字或布尔的值类型。
- 不读写 store / 浏览器存储，不发起请求，不 Teleport 浮层。

## 隐藏通道理由

- `state:local`：搜索词、开合状态和定位方向属于本次交互的临时状态，组件销毁即丢失；选中值仍由受控 `modelValue` 提供。
- `env:global`：VueUse `onClickOutside` 在组件挂载期间监听外部点击以关闭面板；浮层布局 composable 在面板打开期间响应窗口 resize / scroll，并观察锚点和面板尺寸。监听随组件作用域清理，组件不保留常驻全局监听。
