---
标签: []
---

# FormField

给一个控件加一行小号标签，并统一标签与控件之间的纵向间距。解决的是「各处表单自己调标签的字号、大小写、颜色和间距」这类重复——标签样式只在这里定义一次。它不接管校验、不产生错误文案、不收集值，也不为标签与控件建立 `for` / `aria` 关联：标签只是视觉上的标签，可访问名称仍由控件自己负责（例如控件上的 `aria-label`）。与 nb-ui 的 `FormField` 不同，本组件只有「标签 + 间距」这最小一层，没有错误位、描述位与字段上下文。

## 数据

```ts
interface FormFieldProps {
    /** 标签文字；留空时整行标签不渲染（控件上移，不留空位） */
    label?: string;    // 默认 ""
    /** 标签与插槽之间是否加纵向间距（space-y-1.5）；false 时不留间距，由调用方自己排 */
    stacked?: boolean; // 默认 true
}

interface FormFieldSlots {
    /** 控件；唯一的插槽，放什么都可以 */
    default: void;
}
```

没有 emits，没有 expose。attrs（含 `class`、`style`）按 Vue 默认透传到根 `div` 上，用它可以控制这一块的宽度与外边距。

不支持：不做错误态、必填标记、说明文字或帮助提示，也不把标签与控件关联起来（无 `for` / `aria-labelledby`）。需要这些能力请用 nb-ui 的 `FormField` + 对应控件。
