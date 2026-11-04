---
schema: nbook.task/v2
taskId: t05-docs-and-specs
status: planned
updated: 2026-10-20
---

# nb-ui 的规范文档与 Spec 整理

## 目标与范围

整理 ui-development-spec、design-language、README、PROJECT-STATUS 与组件文档：与代码对齐、去掉评审代号、消除重复，定 nb-ui 在 docs/specs 里要不要有 Spec

合同：行为合同未变，只改文档与注释；`docs/specs/ui/forms.md` 只改“与 nb-ui 规范”一条的说法。

## 当前状态

实施计划见 [plan.md](plan.md)。2026-11-04 开发者确认计划末尾七项，都取推荐（骨架规则改写、DL 的按钮胶囊按现状改、坑号不重排、受控视图搬到 `frontend.md`、README 统一中文、`forms.md` 留作真相源、nb-ui 不单独建 Spec）。文档与注释的改动，不另做计划审查，审查放在收尾。worktree `.worktree/w00029-t05-docs`（分支 `docs/w00029-t05-nb-ui-docs`）。

2026-10-20 先做了一次只读审查（Sonnet），作为整理的输入：报告产物 [`artifacts/spec-review/`](artifacts/spec-review/index.html)，原文 [`evidences/spec-review.txt`](evidences/spec-review.txt)。43 条（重要 26、建议 17），要点：

- `ui-development-spec.md` 的 4.2 节逐个复述组件参数，与组件同名 `.md` 重复，已有 4 处直接冲突；`Select` 的浮层配方在文内抄了 4 到 7 遍。
- 4.3、4.4 两节被已接受的提案 `docs/proposals/workbench-view-host.md` 引用，只能搬、不能删；重排前要先清点至少 21 处按章节号、锚点或标题引用这几份文档的地方。
- `design-language.md` 第八、九节（约 600 行的踩坑与检查表）有历史叙述、已删组件与和现状相反的条目。
- `authoring-themes.md` 与 nb-ui README 还残留已拆掉的主题组件替换机制，README 的示例不能编译。

另做了一次 nb-ui 作为 UI 库的合格性审查（Sonnet，2026-10-20）：原文 [`evidences/lib-review.txt`](evidences/lib-review.txt)，24 条（重要 11）。开发者同意的处理：第 1 步的小修放 [w00029 t07](../t07-lib-review-quick-fixes/README.md)；第 2 到 4 步（CSS layer、弹出列表共用零件、公开 API 对齐）另开 [w00030](../../../w00030-nb-ui-library-structure/README.md)，先写计划；布局引擎拆包以后再说。本 Task 整理文档时以这两处的结果为准。

## 下一步

先后（开发者 2026-10-20 在 w00027 定）：本 Task 排在 [w00027 t07](../../../w00027-plugin-platform/tasks/t07-low-code-forms/README.md)（低代码表单）的 S3 之后。t07 改 nb-ui 的表单控件（`Field` 的组形态与上下文导出、`RadioGroup` 横排、`SearchSelect`、`SecretInput`、统一的只读与出错合同），合同先写在 `docs/specs/ui/forms.md`；本 Task 重排 nb-ui 规范时把“表单控件合同”并进第 5 节。


开工前先请开发者定三处文档与代码的分歧（报告 F04、F05、F10/F43；2026-10-20 发在评审板 `artifacts/decisions/` v1，带截图）。开发者 2026-10-20 答复，都取推荐：F04 保留现在的多层投影，文档照实改、数值只留在 token 与主题变量；F05 暗色玻璃保持 `brightness(1.0)`，坑 7 的判据改为“暗色档要有自己的配方”；F10/F43 浮层外观只认 CSS 类，`usePopoverLayer.ts` 里的内联材质常量删掉（代码改动在 w00030 t03，t05 先按这个写规范）：浮层投影几层；暗色玻璃要不要压暗；浮层外观的唯一来源是 CSS 类还是 `useDropdownSurfaceStyle` 里的常量。t04 定下的列表项样式也要写进规范，t05 排在 t04 之后。
