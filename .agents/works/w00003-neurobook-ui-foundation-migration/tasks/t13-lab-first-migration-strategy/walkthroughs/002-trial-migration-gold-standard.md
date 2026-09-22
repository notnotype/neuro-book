---
schema: nbook.walkthrough/v1
taskId: t13-lab-first-migration-strategy
sequence: 2
role: leader
status: completed
createdAt: 2026-09-10T00:00:00Z
---

# 试迁移沉淀：Agent Profile 设置页（t15）作为金标

## 这份记录是什么

t15 是固定路线第 3 步的「开发者与 Agent 协作试迁移」：把一个真实界面（Agent Profile 设置页）整体迁到 nb-ui，并在 NeuroBook Component Lab 里验收。开发者已把它定为后续组件迁移的**参考实现**——后续批次照抄这里的分工、顺序与判据，不要重新发明。

参考实现与验收面：

- 视图与区段：`packages/neuro-book/app/components/novel-ide/settings/sections/agent-profile/`
- 共享表单字段：`packages/neuro-book/app/components/common/low-code-form/`
- Lab 场景与数据面板：`packages/neuro-book/app/component-lab/fixtures/AgentProfileSettingsViewFixture.vue`（10 个场景 + DialogWindow 组合）
- 浏览器验收：`packages/neuro-book/scripts/smoke/agent-profile-settings-dialog.ts`

## 迁移配方（照此顺序执行）

1. **先定承载关系，再定外观。** 判据是「这块面压在什么上面」：独立页面里导航与详情自己就是材质层面板，可以有卡片；窗口里浮层已经占了材质层，分栏属于层级轴，用线。同一份内容有两种宿主时才留显式变体（`layout` / `surface`），只有一种宿主不留第二档。规则见 design-language §二。
2. **零件全部来自 nb-ui，不复制样式。** 判据：迁移目录里再出现 `rounded-md`、`border-[var(--border-color)]`、手写 `bg-[var(--bg-input)]` 面板，就是漏项。共享层组件（如 `low-code-form`）一并处理，不留一半新旧混排。
3. **冲突回到 owner 层修。** 需要的层级 / 动画 / 几何支撑不在 nb-ui 就在 nb-ui 补，不在调用点绕过：DialogWindow 的浮层层级上下文、Collapsible 的 `[data-state]` 动画、`CollapsibleSection` 都是这样产生的。禁止 `!important`、内联覆盖或局部 wrapper 绕过。
4. **形态一变就清账。** 协议改动当场删到底：prop / emit / i18n key / 测试 / 文档 / fixture / 注册表条目。t15 删除 `baseline` + `save`、删除整个诊断区段并连带 `reset-home` 事件链，是按这条执行的。
5. **每处不显然的缺陷都落成可证伪的规则 + 回归。** 几何、层级、动画进 smoke 断言（内容列 ≤ 768px、竖线两端 16px、`getAnimations()` 必须含登记 keyframes）；设计判断进 design-language 与检查表（含坑表编号）。
6. **Lab 是唯一验收面。** 每个场景在真实浏览器里跑并看截图；暗色与 `390 × 844` 各过一遍，能断言的几何/层级/显示态都写进 smoke（t15 已覆盖窄容器双档：720px 下导轨 276px + 栏间竖线、390 × 844 画布下退化为单列并靠切换条往返），不把「页面 smoke 通过」写成「功能已验证」。

## t15 真正花时间的坑

| 坑 | 判据 / 修法 |
| --- | --- |
| 窗口里再套卡片：双层边框，且内圆角大于外圆角 | 窗口内子分栏 `border-*-width` 为 `0`、只有一条分割线（design-language §二） |
| 内容列没有上限，控件被拉成整行宽 | 1400px 窗口下控件宽 ≤ 内容列宽（≈768px） |
| 横线穿过竖线成「工」字、竖线顶到列边缘 | 横线在竖线处收住；竖线两端留 16px |
| 折叠容器 `overflow: hidden` 剪掉子控件焦点光环 | 裁切盒 `padding: 6px` + 等量负 `margin`（坑 #48） |
| `data-[state=open]:animate-*` 变体不生成，动画静默失效 | 展开后 `getAnimations()` 非空且 `animationName` 是登记 keyframes（坑 #47） |
| 浮层被宿主窗口盖住 | 用注入式层级上下文（DialogWindow → `NB_POPOVER_Z_INDEX`），不抬全局 z-index |
| 组件只写了使用没写 import，被渲染成空自定义元素 | 页面实测；`vue-tsc` 不报这类漏项 |
| 同一条 `runtime.lease` 被残留 dev 进程持有导致 500 | 不删锁文件，重启服务让旧进程退出租约 |
| 大面积 hover 底色在 768px 宽的行上像输入框 | 区段标题静止态不画框；悬停底色取半量，整行宽度与列对齐 |
| 用 `setViewportSize` 做窄容器检查 | 窗口一窄 Lab 就收起左右侧栏且不再展开，后面谁也点不到组件树；画布窄过 700px 后 Lab 顶栏的点击也会被拦下。改用画布预设（「手机」= 390 × 844）拿窄容器，并且把这段排在其它 Lab 交互之前 |

## 后续批次怎么用

- 按第 3 步的产出拆分：一个批次 = 一个可独立验收的界面切片，验收面固定在 Component Lab。
- 每个批次必须自带：迁移前后对照、宿主依赖上移记录、删除清单、smoke 断言、文档更新。
- 本记录只覆盖「组件与 Lab」。产品宿主、主题 authority 与消费者接回仍按路线第 5–7 步执行，不因试迁移成功而放宽。
- 试迁移暴露的通用设计判断已经落在 `packages/nb-ui/docs/design-language.md`（§二材料与层级、§三内容列、§七动效、坑表 #47/#48）；后续批次先读规则，再照本配方动手。
