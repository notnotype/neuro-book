# 前端领域规范

适用：`app/**` 以及 VitePress 主题中的 Vue、HTML、CSS 和客户端交互。通用与语言规则由 [`README.md`](README.md) 路由；只有 `app/**` 追加最近的 `app/AGENTS.md`。

## Vue 与交互

- 使用 Composition API 和仓库现有函数式风格；props、emits、slot 与 template ref 保持类型完整。派生状态用 `computed`，`watch` 只承载副作用并负责停止订阅、计时器和请求。
- 通用能力优先复用现有组件、错误映射、通知和面板工具；具体入口由最近的作用域 `AGENTS.md` 登记。
- 交互控件使用语义 HTML、键盘可达名称、正确的 disabled/focus 状态；图标按钮提供可访问名称或 Tooltip。用户文字面向第一次使用 NeuroBook 的普通作者。
- 列表 key 来自稳定实体身份。昂贵派生不在 template 重复调用；布局尺寸使用稳定约束，避免加载、hover 或长文本造成跳动和遮挡。
- `.vue` 单文件组件达到或超过 800 行是硬审查线。新增职责前按稳定边界拆出组件、composable、store 或领域模块。

## CSS 与主题

- 普通界面颜色只消费 `app/utils/theme/README.md` 登记的语义变量；新增变量同步主题文档与全部内置主题。
- 决定某块区域用玻璃、实心还是不给面时，判据在 [`packages/nb-ui/docs/ui-development-spec.md`](../../../packages/nb-ui/docs/ui-development-spec.md) 第 2 节，取舍理由在 [`packages/nb-ui/docs/design-language.md`](../../../packages/nb-ui/docs/design-language.md)。这两份规范此前只从 nb-ui 内部路由得到，主应用侧改样式的人找不到，材料语言因此被逐页重新发明过。
- 样式由组件或语义 class 拥有，保持低特异性；动画尊重 reduced motion，文本、焦点环和状态色保持可辨识。
- 固定格式控件、面板或网格使用 `min/max`、grid track、`aspect-ratio` 等稳定约束；长文本必须换行或动态收敛，不遮挡相邻内容。

## 验证

前端改动说明桌面和窄屏影响。逻辑测试、类型检查和浏览器验收分别报告；用户可见交互或布局变化必须运行真实页面并留下可观察证据。

完成标准：目标桌面与窄屏视口均可完成受影响流程，键盘与焦点路径可用，主题和长文本不会产生溢出或布局跳动。