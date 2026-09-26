---
标签: [state:local]
---

# PinInput

`PinInput` 将短验证码或 PIN 拆成固定数量的独立输入格，并在输入完成时发出完成事件。它提供数字/文本输入模式、占位符和遮罩选项；焦点在格子间的移动与输入分配由 Reka UI 负责。

## 布局与交互

输入格横向排列，格数由 `length` 决定，单格尺寸固定。窄屏保持一行，不会自动折成多行；使用方需为目标长度预留宽度。键盘输入、方向移动、粘贴分配、掩码显示及完成时机依赖上游 PIN 控件。

## 数据

```ts
interface PinInputProps {
    modelValue?: string[]; // 每个格子的值；默认 undefined。提供时受控，变化后由父组件回写。
    defaultValue?: string[]; // 非受控初值；默认 []。
    length?: number; // 输入格数；默认 6。
    type?: "text" | "number"; // 输入语义；默认 "number"。
    placeholder?: string; // 每格占位内容；默认 "○"。
    disabled?: boolean; // 禁止输入；默认 false。
    mask?: boolean; // 是否遮蔽输入；默认 false。
}

interface PinInputEmits {
    (event: "update:modelValue", value: string[]): void; // 值变化时发出。
    (event: "complete", value: string[]): void; // 上游判定所有输入完成时发出。
}

interface PinInputSlots {} // 不提供插槽。
```

`modelValue` 存在时值由父组件控制；省略时由上游按 `defaultValue` 管理。组件不 expose 方法或属性，未声明 attributes 按 Vue 根组件默认 fallthrough。`type="number"` 下底层输入仍可使用文本元素并提供数字输入语义，不应依赖具体原生 input type。

## 状态

- 默认：渲染 `length` 个空格，提示符为 `placeholder`。
- 已输入：格子显示对应字符；`mask` 为真时由上游遮蔽显示。
- 禁用：所有输入格不可编辑。
- 只读、加载、出错、空数据：没有单独状态或 props。

## 上游边界

格子间的自动焦点、数字过滤、粘贴行为、掩码实现、无障碍输入语义及 `complete` 的判定和触发时机来自 Reka UI PinInput。本组件只承诺格数与外观、props/emits 转发；上述输入细节可能随 Reka UI 升级变化。
