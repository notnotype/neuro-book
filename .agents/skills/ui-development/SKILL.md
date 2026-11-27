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
6. 动效与细节打磨：出现与消失、展开与收起、换内容、进行中与完成都有过渡（[`ui-development-spec.md`](../../../packages/nb-ui/docs/ui-development-spec.md#8-开发后自检与易错清单)的“状态变化有动效”）；在 Lab 里逐个状态点一遍，不只看静态截图。交付前在开发服务的真实页面上把主路径点一遍（`nbdev dev start`，浏览器不减弱动效）：e2e 跑的是生产构建并且减弱动效，dom 测试把 `Transition` 换成替身，开发构建里过渡卡住这类问题只有这一步看得到（[UI 验收分档](../../../docs/testing/README.md#ui-验收分档)）。前端实现审查的说明里把第 5、6、8 条列进“重点”，并贴第 9 条的固定检查。
7. 文字放在固定尺寸里的组件（固定高度的区域、定宽列、单行截断），Lab 至少登记一个英文场景，并按 390 宽截图：英文文案常比中文长一倍，只看中文场景时截断与裁切看不出来。
8. 按设计语言的八条交互原则（[`design-language.md`](../../../packages/nb-ui/docs/design-language.md) 的“交互：复杂留给系统”）与“按状态变化找该动的地方”过一遍。出静态稿前、界面大改前，请 omp 的 `@designer`（Gemini）当方案、文案与交互顾问，只出意见、由主会话取舍，最后不另请 GPT 审查（开发者 2026-11-25 定；本机要写成 `prox omp -p --model @designer …`，不加 `prox` 连不上）。一份说明最多给 4 张截图并写明每张只读一次：它只看得到最近读的约 5 张，给 8 张时反复重读到时限被截停、没有输出（w00039 t43）；图多就按问题拆成几份并行。
9. 前端实现审查的说明里，“重点”先写本次特有的风险，再贴下面这段固定检查（条目的正文在 [`design-language.md`](../../../packages/nb-ui/docs/design-language.md) 与 [`ui-development-spec.md`](../../../packages/nb-ui/docs/ui-development-spec.md)，依据见设计语言开头的“依据的设计理论与规范”）：

   ```markdown
   固定检查（每条给“过 / 不过 / 不适用”，不过的写位置与改法；要在 Lab 里看的写“需在 Lab 复核”）：
   1. 说明文字：改动里每句不是标签、不是状态的文字（含说明图标里的）按设计语言“四、排版”的三类表归类；约束进了说明图标、内部处理上了界面，都不过。
   2. 文案：按钮写动作，确认不可逆操作的按钮不写“确定”；错误写清对象与下一步；新名词与已有文案目录的叫法一致（开发规范“4.8 界面文案”）。
   3. 动效清单：新建或改动的组件，同名 `.md` 的“状态”写了状态之间怎么过渡（属性、时长与缓动令牌）或不过渡的理由；实现与它一致，没有写死时长、没有 `transition-all`。
   4. 动效行为：来回切换用 `transition`、可折返；过渡期间不停用控件；高频操作没有位移动效；首次挂载不播入场；进出方向与来处一致（设计语言“动效的行为”“进出方向与来处一致”）。
   5. 反馈：按下后下一帧有回应；超过 1 秒有进行中，超过 10 秒有进度与取消；结果进 `role="status"` 或 `role="alert"` 且不移焦点；停用的控件说得出原因（设计语言“反馈与等待”，开发规范第 5 节第 8、9 条）。
   6. 确认与通知：每个新确认框写得出它防的是哪种找不回的损失；常规成功不发通知。
   7. 分组：组内最大间距的 2 倍不超过组间最小间距，组标题贴着本组；一块区域至多一个 `primary` 按钮（设计语言“分组与层次”）。
   8. 可点区域：可点目标不小于 24×24 或满足 24 像素圆的间距例外，复选、单选、开关的标签可点，危险动作不紧挨常用动作（开发规范第 5 节第 10 到 12 条；`lab:shot` 的“目标小于 24×24”报告）。
   9. 可达性：新增颜色组合的文字 4.5:1、选中态与焦点 3:1（用令牌算出数字）；状态不只靠颜色；Tab 到的元素不被吸顶区挡住；减弱动效下状态切换仍看得出（设计语言“对比度”“六、无障碍”）。
   10. 四态：自己显示加载、空、失败的组件，Lab 登记了四态场景；空态有能产生内容的按钮；会变的数字用 `tabular-nums`（开发规范“4.1 状态下限”，设计语言“四、排版”）。
   ```

## 反思回写

按用户级 Skill `task-reflection` 列出回写建议，经批准后写入。UI 类知识的目标位置：

- 浏览器怪异行为与判据失误：写到 [`design-language.md` 的“踩过的坑”](../../../packages/nb-ui/docs/design-language.md#八踩过的坑)，按“现象 → 根因 → 判据”的格式。
- 控件参数、交互合同，以及用户提出或纠正的 UI 规范：写到 [`ui-development-spec.md`](../../../packages/nb-ui/docs/ui-development-spec.md) 对应小节；自动化工具查不出的易错项写到其中的开发后自检与易错清单。
- 视觉判据与设计取舍：写到 `design-language.md` 对应章节。
