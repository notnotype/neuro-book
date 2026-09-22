---
schema: nbook.task/v2
taskId: t10-component-lab-switching-fix
---

# 修复 Lab 组件切换塌缩与选中样式

## 问题

1. 在 Lab 选择 `ViewportCanvas` 后切换到其它组件，预览内容会被压成一条横线。
2. Lab 左侧组件树的公共 `Tree` 选中行仍使用强调色左边框；元素检查器点击选中大块内容时还会绘制常驻矩形框，两处都会表现为突兀左竖线。

## 根因与决策

- t07 引入的 fixture `Transition mode="out-in"` 在旧组件退出后才挂载新组件。自由尺寸画布的高度由 slot 自然内容决定，切换空帧失去内容支撑并塌缩。
- 不给自由高度增加固定最小高度，否则会破坏 `ViewportCanvas` 的自然高度合同。删除 fixture 场景过渡，组件切换直接替换，不再插入无内容的退场阶段。
- 元素检查器的悬停探针继续使用虚线框；点击选中后只保留贴边标签。`HighlightBox` 通过默认兼容的 `showBox` prop 显式支持该模式。
- `Tree` 选中行移除透明边框占位和强调色左边框，保留 `data-selected`、整行淡强调底、强调文字、中等字重与焦点环；层级继续由缩进和展开箭头表达。

## 验收

- 从 `ViewportCanvas` 切换到其它 fixture 后，外层画布内容高度保持大于零且新组件可见。
- `Tree` 选中行没有左边框，仍保留 `aria-selected`、整行选中底色、文字与字重；元素检查器选中态不绘制常驻矩形框但保留标签，探针虚线框保持。
- reduced-motion、窄屏 resize、主题恢复和既有 Lab smoke 保持通过，或明确记录运行环境阻塞。
- typecheck、组件回归测试、全量测试、docs check 与 diff check 通过；聚焦浏览器 smoke 若被运行时门禁阻断则记录原始失败阶段，不代称通过。

## 未授权项

人工视觉验收仍需开发者单独授权；自动浏览器证据不替代人工观感确认。
