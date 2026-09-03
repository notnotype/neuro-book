---
schema: nbook.task/v2
taskId: t07-component-lab-uiux-polish
role: tasker
---

# 精修 Component Lab 响应与动效

## 目标

补齐 Component Lab 已暴露的运行中窄屏响应与基础转场，使 Lab 在不改变组件选择、fixture、数据和受控侧栏 API 的前提下，在桌面与窄屏之间切换仍可用，场景切换与侧栏收起有稳定且可取消的视觉反馈。

## 范围

- `LabShell` 在运行中从宽屏进入 `<=700px` 时自动收起左右侧栏。
- 从窄屏回到宽屏不自动展开，保留用户最后一次展开/收起决定。
- 侧栏宽度切换和场景动态组件切换提供主题变量驱动的转场。
- `prefers-reduced-motion: reduce` 下关闭新增转场，不改变交互结果。
- 更新 Component Lab Spec、smoke 与 walkthrough，记录实际验证和未授权人工验收。

## 不做

不新增第三方依赖，不改变 `CollapsibleSidePanel` 的 props/emits，不修改 fixture 数据、组件索引、正式产品页面或产品状态，不把 Component Lab 变成正式功能。

## 验收

1. 运行中的 Lab 从宽屏缩到 `<=700px` 后，两侧栏均收起，画布仍可用；恢复宽屏不自动展开。
2. 侧栏宽度和场景切换有转场；`prefers-reduced-motion: reduce` 下转场时长为零或不产生动画。
3. `390×844` 页面无页面级横向滚动，侧栏展开按钮、场景选择和画布核心操作可继续使用。
4. 相关 typecheck、聚焦 smoke 与差异检查通过；walkthrough 区分自动浏览器证据与未获授权的人工视觉验收。

## 开发者参与

浏览器人工视觉验收仍需开发者单独授权；未授权时不得将自动 smoke 或静态检查写成完整人工验收结论。

## 验证命令

- `bun run --cwd=packages/neuro-book typecheck`
- `bun run --cwd=packages/neuro-book smoke:component-lab -- --url <dev-url> --browser-executable <chromium>`
- `bun run docs:check`
- `git diff HEAD --check`

## 固定依据

- [`docs/specs/ui/component-lab.md`](../../../../../../docs/specs/ui/component-lab.md)
- [`docs/standards/code/frontend.md`](../../../../../../docs/standards/code/frontend.md)
- [`docs/standards/code/components.md`](../../../../../../docs/standards/code/components.md)
