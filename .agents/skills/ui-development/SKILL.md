---
name: ui-development
description: 指导 NeuroBook 与 nb-ui 的前端与 UI 开发、组件设计与复用、Token 消费规范。
---

# UI 开发指南

面向 NeuroBook 与 nb-ui 前端界面与组件开发。具体参数以对应真相源为准，本技能只定义路由、复用与 UI 专属检查。

## 一、核心真相源

| 关注事项 | 唯一真相源 | 说明 |
|---|---|---|
| **视觉判据与设计哲学** | [`packages/nb-ui/docs/design-language.md`](../../../packages/nb-ui/docs/design-language.md) | 视觉判据、设计取舍与踩过的坑。 |
| **工程标准** | [`packages/nb-ui/docs/ui-development-spec.md`](../../../packages/nb-ui/docs/ui-development-spec.md) | 跨组件的工程合同：取值消费、浮层外框、弹出列表、滚动条、自检清单。单个组件的参数在同名 `.md`。 |
| **组件连接与契约约束** | [`docs/standards/code/components.md`](../../../docs/standards/code/components.md) | 明面/隐藏通道划分、frontmatter 标签、同名 `.md` 规范、5 配方与 4 禁止规则。 |
| **前端工程与存储边界** | [`docs/standards/code/frontend.md`](../../../docs/standards/code/frontend.md) | 客户端存储分层（严禁裸写 localStorage）、Tailwind/CSS 变量、390px 窄屏适配。 |
| **基础控件组件池** | [`packages/nb-ui/README.md`](../../../packages/nb-ui/README.md) 与 `packages/nb-ui/src/components/index.ts` | 基础控件清单及导出。 |


## 二、组件复用与伴生文档

1. **通用基础控件**（按钮、输入框、下拉、滑块、开关、弹层、滚动条等）：100% 优先复用 `@notnotype/nb-ui`，严禁在业务端手写原生元素模拟。
2. **扩展原则**：通用变体或插槽通过 props/slots 扩展，严禁将业务数据模型写死进通用组件。
3. **业务复合零件**：放在拥有该能力的插件的前端目录（新应用目录约定见 [`packages/neuro-book/AGENTS.md`](../../../packages/neuro-book/AGENTS.md)；旧应用的划分 `packages/neuro-book-legacy/app/components/<domain>/` 只作参照）。
4. **伴生同名 `.md` 契约**：查组件必先读同名 `.md` 获取既有契约；改组件必同步更新；新建组件必先写 `.md` 再写 `.vue`。

## 三、UI 专属检查

通用验证范围与停止条件以 [验证门禁](../../../docs/testing/README.md#验证门禁) 为准，本节只补 UI 特有的检查项。

1. 涉及布局或响应式时，确认桌面与 390px 窄屏都没有水平溢出，并在宽窗口（≥1400px）下确认内容列封顶、宽度随内容的元素不拉满整行（见 [`design-language.md`](../../../packages/nb-ui/docs/design-language.md) 的“内容列有上限宽度”）。组件自己是滚动容器时，Lab 的场景检查量不到它内部的溢出，390 宽要看截图；涉及主题 token 时，确认明暗两态对比正常。
2. 对照 [`ui-development-spec.md` 的开发后自检与易错清单](../../../packages/nb-ui/docs/ui-development-spec.md#8-开发后自检与易错清单)中与本次改动相关的条目。
3. 对话框组件名不以 Dialog 结尾时，在 `component-index-model.ts` 的撑满列表里登记，否则组件库画布没有高度。
4. 设计信息流或信息密度高的界面前，先和开发者确认信息的注意力排序（首先看什么、默认折叠什么、什么时候整块收起），写进 Spec 后再出视觉候选；否则视觉迭代会反复推翻版式。
5. 界面上只留能操作的东西与状态：逐句过一遍新写的文案（标题下的说明、行下提示、说明图标里的话），解释系统内部怎么处理的（“改了以后按通用协议发送”“仍按模板的目录”）删掉、写进组件注释与 Spec（[`design-language.md`](../../../packages/nb-ui/docs/design-language.md) 的“界面不靠说明文字解释自己”）。
6. 动效与细节打磨：出现与消失、展开与收起、换内容、进行中与完成都有过渡（[`ui-development-spec.md`](../../../packages/nb-ui/docs/ui-development-spec.md#8-开发后自检与易错清单)的“状态变化有动效”）；在 Lab 里逐个状态点一遍，不只看静态截图。交付前在开发服务的真实页面上把主路径点一遍（`nbdev dev start`，浏览器不减弱动效）：e2e 跑的是生产构建并且减弱动效，dom 测试把 `Transition` 换成替身，开发构建里过渡卡住这类问题只有这一步看得到（[UI 验收分档](../../../docs/testing/README.md#ui-验收分档)）。前端实现审查的说明里把第 5、6、8 条列进“重点”。
7. 文字放在固定尺寸里的组件（固定高度的区域、定宽列、单行截断），Lab 至少登记一个英文场景，并按 390 宽截图：英文文案常比中文长一倍，只看中文场景时截断与裁切看不出来。
8. 按设计语言的八条交互原则（[`design-language.md`](../../../packages/nb-ui/docs/design-language.md) 的“交互：复杂留给系统”）与“按状态变化找该动的地方”过一遍。出静态稿前、界面大改前，请 omp 的 `@designer`（Gemini）当方案、文案与交互顾问，只出意见、由主会话取舍，最后不另请 GPT 审查（开发者 2026-11-25 定；本机要写成 `prox omp -p --model @designer …`，不加 `prox` 连不上）。一份说明最多给 4 张截图并写明每张只读一次：它只看得到最近读的约 5 张，给 8 张时反复重读到时限被截停、没有输出（w00039 t43）；图多就按问题拆成几份并行。

## 反思回写

按用户级 Skill `task-reflection` 列出回写建议，经批准后写入。UI 类知识的目标位置：

- 浏览器怪异行为与判据失误：写到 [`design-language.md` 的“踩过的坑”](../../../packages/nb-ui/docs/design-language.md#八踩过的坑)，按“现象 → 根因 → 判据”的格式。
- 控件参数、交互合同，以及用户提出或纠正的 UI 规范：写到 [`ui-development-spec.md`](../../../packages/nb-ui/docs/ui-development-spec.md) 对应小节；自动化工具查不出的易错项写到其中的开发后自检与易错清单。
- 视觉判据与设计取舍：写到 `design-language.md` 对应章节。
