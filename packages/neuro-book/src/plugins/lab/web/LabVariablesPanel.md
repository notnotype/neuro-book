---
标签: [state:local]
---

# LabVariablesPanel

检视面板的「变量」页签：按分组列出设计变量与它们此刻在文档根上的取值，可以逐项覆盖、全部清除、导出与导入覆盖集。用来当场试一个 token 改了之后整页长什么样，不用改主题文件。

覆盖由 LabShell 的 `useLabOverrides` 持有并写进一个独立的 `<style>`（`:root[data-nb-lab-active]`，`!important`），只作用于 Lab 页面；不写偏好、不写浏览器存储，刷新后消失，要留下就导出成文件。本零件只呈现与转发，校验失败时显示原因。

## 布局

顶部一行：覆盖项数，「全部清除」「导入」「导出」。下面是筛选框，再下面按分组列变量：配色（表面、文字、描边、强调、状态、其他）、设计 token（排版、间距、圆角、层级、动效）、主题度量、装饰与角色，以及已装主题自己声明的变量。分组与变量名来自 nb-ui 的公开入口（`lab-tokens.ts`）。

每行：色块（覆盖值或当前值）、变量名、覆盖输入框（占位是当前值）、有覆盖时的撤销按钮。

## 交互

- 输入框改完回车或失焦生效；清空等于撤掉这一项。值为空、超过 512 个字符或带分号与花括号时拒绝，原因显示在顶部，已有覆盖不变。
- 导入是原子的：文件里任何一项不合法或不是登记的变量，整份拒绝，已有覆盖不变。快照格式与 nb-ui playground 的 Lab 相同。
- 导出下载 `nb-lab-variable-overrides.json`。

## 数据

```ts
props: {
    groups: readonly LabTokenGroup[];
    resolved: Readonly<Record<string, string>>;   // 每个变量此刻的计算值
    overrides: Readonly<Record<string, string>>;
    count: number;
    // 函数 prop：单项校验与原子导入要拿到同步的返回值与异常
    onSet: (name: string, value: string) => void;
    onReset: (name: string) => void;
    onResetAll: () => void;
    onImport: (raw: string) => number;
    onExport: () => string;
}
```

## 隐藏通道理由

`state:local` 是筛选词、上一次操作的结果提示与文件选择框的元素引用。导入读使用者选的文件，导出生成一个下载，都是使用者点按钮触发的一次动作。
