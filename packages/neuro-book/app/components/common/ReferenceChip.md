---
标签: []
---

# ReferenceChip

把工作区引用渲染成紧凑的行内标记，显示引用名称、类型图标与类型徽标，并将目标保留在 DOM 属性和原生 title 中。与普通文本标签不同，它能区分章节、分卷、线程等目标类型，也能明确标出断链引用。

## 数据

```ts
interface ReferenceChipProps {
    /** 行内显示名称；必填。 */
    label: string;
    /** 引用目标；可选。优先于 targetId；缺省时尝试用 targetId。 */
    target?: string;
    /** 旧式目标 ID；可选，仅在 target 未提供时使用。 */
    targetId?: string;
    /** 引用类型；可选，优先于 kind。 */
    entryType?: string | null;
    /** 兼容字段；当前实现未读取，不影响外观。 */
    status?: string | null;
    /** 自定义图标类；可选，只用于目录、文件与未识别类型的回退元数据。 */
    icon?: string | null;
    /** 是否断链；默认 false，断链样式优先于类型样式。 */
    broken?: boolean;
    /** 兼容的引用类型字段；可选，仅在 entryType 为 null/undefined 时使用。 */
    kind?: string;
}

type ReferenceChipEmits = {};
type ReferenceChipSlots = {};
```

`status` 虽然是已声明的兼容 prop，当前实现没有读取它，不影响外观；类型回退使用的是 `kind`。
目标类型先取 `entryType`，再取 `kind`，两者都缺失时可从 target 的协议或工作区路径推断。目标字符串先取 `target`，再取 `targetId`；未提供时输出空目标和空类型 attribute。元数据映射包含章节、分卷、线程、场景、情节、待定项、选区、角色、地点、物品、规则、笔记、计划、目录和文件；未知类型回退为文件徽标。最长宽度为容器宽度与 24rem 中较小者，名称超出时截断。

组件无交互事件、插槽或 expose API；未声明的 attribute、`class` 与 `style` 按 Vue 单根 `<span>` 默认 fallthrough。它只渲染标签，不解析目标、不跳转，也不验证资源是否存在。
