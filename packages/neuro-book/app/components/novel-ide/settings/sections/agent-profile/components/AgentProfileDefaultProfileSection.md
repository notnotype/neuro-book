---
标签: [state:local]
---

# AgentProfileDefaultProfileSection

默认设置页的默认 Profile 选择区。它同时显示当前作用域实际生效的 Profile，帮助用户区分“本层跟随上层”和最终使用值。

## 布局与交互

选择控件与只读实际值并排；窄容器下自动变为单列。继承值使用父级提供的非空哨兵，不把空字符串传给选择器。禁用时保留实际值但不接受选择。

## 数据

```ts
interface AgentProfileDefaultProfileSectionProps {
    scope: "global" | "project";
    defaultProfileKey: string;
    defaultProfileOptions: FormSelectOption[];
    effectiveDefaultProfileKey: string;
    disabled: boolean;
}
```

```ts
interface AgentProfileDefaultProfileSectionEmits {
    (event: "update:defaultProfileKey", value: string): void;
}
```
`FormSelectOption` 为 nb-ui 选择项类型。无 slots、expose；attrs 不透传。

无 slots、expose；attrs 不透传。

## 不支持

不创建、删除或改名 Profile，不自行解析配置或保存数据。
