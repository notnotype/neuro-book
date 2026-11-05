---
schema: nbook.task/v2
taskId: t01-research-and-design
status: active
updated: 2026-11-05
---

# 调研与设计

## 目标与范围

弄清背景图片和主题该是什么关系，交开发者确认方向，再写 Spec 与计划。

- 看 dsh 社区主题怎么处理背景、透明与文字可读性（已完成，见下一步）。
- 对照现有主题合同：[`theme/system.md`](../../../../../docs/specs/theme/system.md)、`packages/nb-ui/docs/authoring-themes.md`。
- 界面要拍板的部分走 design-review。

合同：[`theme/skins.md`](../../../../../docs/specs/theme/skins.md)。第一版的 `ui/backgrounds.md` 已删，要看从 git 历史取。

## 当前状态

已合入 master。计划：[plan.md](plan.md)；设计审查 16 条（[处理](evidences/design-review-disposition.txt)）、实现审查 15 条（[处理](evidences/impl-review-disposition.txt)）。Spec：[`theme/skins.md`](../../../../../docs/specs/theme/skins.md)（`implemented`）。

- 评审板第 2 轮 `r2-real`（真实工作台截图）发布时开发者还没答复；合入时按“可以”处理，有异议再改。
- 书房的素材是图片生成的草稿（共 2 次生成请求，原图与提示词在本地 `.local/agent/works/w00041-themes-and-backgrounds/tasks/t01-research-and-design/assets/`），正式发布前要定稿。

## 遗留

- 1440 宽且右栏开着时，编辑区放不下两侧，只有侧栏下角与配色。
- 书架页、设置窗口只跟配色，没有场景。
- 运行期热插拔还没实现，禁用与启用主题插件要重启。
- 图标集、菜单与设置窗口的画框、按状态换场景、由代码提供的场景都还没做。
