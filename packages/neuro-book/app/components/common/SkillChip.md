---
标签: []
---

# SkillChip

在编辑器内容中将 Agent Skill 名称呈现为不可编辑的行内徽标，配有技能图标与固定“技能”徽标。它把技能引用与普通文字区分开，同时保持为紧凑的行内文本形态。

## 数据

```ts
interface SkillChipProps {
    /** 技能名称；必填，并作为 data-agent-skill-name 输出。 */
    name: string;
}

type SkillChipEmits = {};
type SkillChipSlots = {};
```

名称过长时在容器内截断，组件最大宽度为容器宽度与 24rem 中较小者。根元素设置 `contenteditable="false"`，图标为装饰性内容。组件没有交互事件、插槽或 expose API；未声明的 attribute、`class` 与 `style` 按 Vue 单根 `<span>` 默认 fallthrough。组件不校验技能是否存在，也不执行或加载技能。
