---
name: ui-development
description: 指导 NeuroBook 与 nb-ui 的前端与 UI 开发、组件设计与复用、Token 消费规范。
---

# UI 开发指南

面向 NeuroBook 与 nb-ui 前端界面与组件开发。具体参数以对应真相源为准，本技能只定义路由、复用与 UI 专属检查。

## 一、核心真相源

| 关注事项 | 唯一真相源 | 说明 |
|---|---|---|
| **视觉判据与设计哲学** | [`packages/nb-ui/docs/design-language.md`](../../../packages/nb-ui/docs/design-language.md) | 材质轴 vs 层级轴、冷暖分家、同心圆角、实测避坑总结。 |
| **控件参数与工程标准** | [`packages/nb-ui/docs/ui-development-spec.md`](../../../packages/nb-ui/docs/ui-development-spec.md) | Surface Tier 1~4 分级、核心控件参数、零布局位移、滚动条与遮罩规范、自检清单。 |
| **组件连接与契约约束** | [`docs/standards/code/components.md`](../../../docs/standards/code/components.md) | 明面/隐藏通道划分、frontmatter 标签、同名 `.md` 规范、5 配方与 4 禁止规则。 |
| **前端工程与存储边界** | [`docs/standards/code/frontend.md`](../../../docs/standards/code/frontend.md) | 客户端存储分层（严禁裸写 localStorage）、Tailwind/CSS 变量、390px 窄屏适配。 |
| **基础控件组件池** | [`packages/nb-ui/README.md`](../../../packages/nb-ui/README.md) 与 `packages/nb-ui/src/components/index.ts` | 50+ 通用无业务倾向基础控件清单及导出。 |

- **样式参数**：Border 统一取 `var(--border-w)`，分割线 `var(--divider)`，外轮廓 `var(--control-outline)`；Surface 严格分材质轴（直接压底纹，整页一层）与层级轴（面板上叠纯不透明色阶，向上更亮，绝不叠玻璃）。

## 二、组件复用与伴生文档

1. **通用基础控件**（按钮、输入框、下拉、滑块、开关、弹层、滚动条等）：100% 优先复用 `@notnotype/nb-ui`，严禁在业务端手写原生元素模拟。
2. **扩展原则**：通用变体或插槽通过 props/slots 扩展，严禁将业务数据模型写死进通用组件。
3. **业务复合零件**：放在 `packages/neuro-book/app/components/<domain>/`。
4. **伴生同名 `.md` 契约**：查组件必先读同名 `.md` 获取既有契约；改组件必同步更新；新建组件必先写 `.md` 再写 `.vue`。

## 三、UI 专属检查

通用验证范围与停止条件以 [验证门禁](../../../docs/testing/README.md#验证门禁) 为准，本节只补 UI 特有的检查项。

1. 涉及布局或响应式时，确认桌面与 390px 窄屏都没有水平溢出；涉及主题 token 时，确认明暗两态对比正常。
2. 对照 [`ui-development-spec.md` §10](../../../packages/nb-ui/docs/ui-development-spec.md#10-开发后自检与易错清单checklist) 中与本次改动相关的条目。

## 反思回写

按 [task-reflection](../task-reflection/SKILL.md) 列出回写建议，经批准后写入。UI 类知识的目标位置：

- 浏览器怪异行为与判据失误：写到 [`design-language.md` §八 踩过的坑](../../../packages/nb-ui/docs/design-language.md#八踩过的坑)，按“现象 → 根因 → 判据”的格式。
- 控件参数、交互合同，以及用户提出或纠正的 UI 规范：写到 [`ui-development-spec.md`](../../../packages/nb-ui/docs/ui-development-spec.md) 对应小节；自动化工具查不出的易错项写到 §10。
- 视觉判据与设计取舍：写到 `design-language.md` 对应章节。
