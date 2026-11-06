---
标签: [state:local, env:timer]
别名: ["草稿输入", "Draft Input"]
验证入口: ThemeEditor
---

# DraftInput

主题编辑器里带本地草稿的单行输入（[`theme/editor.md`](../../../../../../../../docs/specs/theme/editor.md) 输出 7）：输入先留在本地，停手 250ms 后发 `change`，不会每个按键写一次记录。

## 交互

- 外面的值变了（别处改、换了主题、导入后自动选中）：本地待交出的作废，输入跟着变；不会把旧输入写进新的对象。
- 焦点离开或组件卸载：立刻交出还在等的值，输入完马上点别的按钮，那个按钮读到的是刚输入的值。
- 空串默认不交出：标题、取景的大小与位置这类字段不允许空值，写出空串会让整套主题不合格；清空用调用方自己的按钮。`allowEmpty` 打开时空串照常交出。
- 防抖用定时器（`env:timer`）：只有输入所在的组件知道输入什么时候停。

## 数据

```ts
type Props = {value: string; placeholder?: string; ariaLabel?: string; size?: "sm" | "md"; allowEmpty?: boolean};
type Emits = {change: [value: string]};
```
