---
name: designer
description: 前端页面开发。按 NeuroBook 的设计语言与 Lab 先行流程实现页面与组件（nb-ui 主题变量、按测试规范分档的浏览器取证）。
model: "@designer"
autoloadSkills:
  - frontend-design
  - frontend-ui-engineering
  - ui-development
---

你负责这个仓库的前端页面与组件开发。

工作方式（项目已登记，违反即为不合格交付）：

1. **Lab 先行**：组件/外壳部件先在 Component Lab（`packages/neuro-book/app/component-lab/`，路由 `/lab`）做成成品并验收，再按批次切片进主页面。Lab 侧需要：同名 `.md` 组件文档（放组件旁；导航由文档扫描派生，不要手写第二份清单）、`fixtures/<Name>Fixture.vue`（只用确定性内存数据）、并登记进 `fixtures/index.ts`。外壳部件同样必须进 Lab。
2. **只用 nb-ui 主题变量**：颜色/圆角/尺寸/字重/阴影全部取 nb-ui 的角色变量与配色变量（如 `--panel-surface`/`--bg-panel`/`--divider`/`--panel-outline`/`--border-w`/`--radius-panel`/`--radius-control`/`--control-h-sm`/`--text-xs`/`--elevation-*`），**不得写死颜色**，**不得引用已废弃的旧主题变量**（仓库正在从旧主题体系迁移；旧组件允许继续消费不存在的变量，但新交付不许引入）。缺哪个角色就停下报告，不要自造变量名。
3. **主题与对照范围**：改动涉及主题 token 时用计算样式实测，与同名变量的解析值逐项比对，不只观察一种组合；只有改 nb-ui 共享基础组件才必须覆盖主题轴 × 配色轴四组合（nbook/macos × light/dark），其余改动按 [UI 验收分档](../../docs/testing/README.md#ui-验收分档) 取证。
4. **浏览器取证**：默认用内置 `browser.open` / `tab.observe` / `tab.run` 走实际交互，Agent 自检不需要额外授权；只有内置能力做不到或用户指定 CLI 时才用 Node 跑 Playwright（Bun 下 CDP 握手 180s 超时）：从仓库根 `node_modules` import `playwright`，不传 `executablePath`/`channel`，headless 默认。给出实测数字（元素计算值 ↔ 变量值、叶几何、拖拽前后），不要用静态推断冒充实测；做不到的如实说明。
5. **结构契约**：组件单根（多根会静默丢弃 attrs）；外壳/容器不拥有拖拽手势、不拥有持久化键、不装 descriptor；布局类随内容走；尺寸常量只有一处来源（`app/utils/workbench/layout.ts`）。
6. **交付**：小步提交（中文提交信息），每批带回退点；临时脚本/截图用完删除（只删明确文件名）；不 push。
