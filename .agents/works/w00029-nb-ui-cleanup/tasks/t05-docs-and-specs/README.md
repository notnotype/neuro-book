---
schema: nbook.task/v2
taskId: t05-docs-and-specs
status: done
updated: 2026-11-04
---

# nb-ui 的规范文档与 Spec 整理

## 目标与范围

整理 ui-development-spec、design-language、README、PROJECT-STATUS 与组件文档：与代码对齐、去掉评审代号、消除重复，定 nb-ui 在 docs/specs 里要不要有 Spec

合同：行为合同未变，只改文档与注释；`docs/specs/ui/forms.md` 只改“与 nb-ui 规范”一条的说法。

## 当前状态

实施计划见 [plan.md](plan.md)。2026-11-04 开发者确认计划末尾七项，都取推荐（骨架规则改写、DL 的按钮胶囊按现状改、坑号不重排、受控视图搬到 `frontend.md`、README 统一中文、`forms.md` 留作真相源、nb-ui 不单独建 Spec）。文档与注释的改动，不另做计划审查，审查放在收尾。worktree `.worktree/w00029-t05-docs`（分支 `docs/w00029-t05-nb-ui-docs`）。

2026-11-04 做完，合入 master `7fc24af03`：

- S1 `bea45d73b`：原 4.2 的单组件内容逐条比对后并进 23 份同名 `.md`（Sonnet 子代理，每条去向见 [`evidences/spec-migration.txt`](evidences/spec-migration.txt)）。
- S2 `46bd8296f`：规范从 466 行重排到约 220 行，保留跨组件合同；第 2 节序号不变；受控视图搬到 `frontend.md`。
- S3 `f1f0af5c2`：设计语言从 1334 行减到约 1100 行（Sonnet 子代理，见 [`evidences/dl-changes.txt`](evidences/dl-changes.txt)）：判据按开发者的决定与代码改，第九节删除，坑号不重排（只删了坑 27，留空号），Apple 读数移到 `docs/research/apple-macos-ui-kit-readings.md`（读数抄自原文，没有重新核对外部出处，文档里写明了）。
- S4 `a4a3cf4f5`：README 改中文，主题指南、目录、状态页、组件规范与 Skill 跟上。master 上 `307a41ce8` 改了 `forms.md`、`workbench-shell.md` 的入链与提案决策记录。
- S5 `182089ef7`：注释去掉评审代号与过时引用；分支相对 master 的 15 个非文档文件，去注释后完全相同。
- 顺带修了 `Drawer.md` 漏标的 `state:inject`：w00030 t05 给 `Drawer` 加缺省文案时漏了，master 的 `governance:check` 从那时起一直失败，这次才查到。
- 实现审查（Sonnet）16 条：重要 6、建议 10，全部成立，修正 `128e6e1da`，处理见 [`evidences/impl-review.txt`](evidences/impl-review.txt)。报告 43 条的结果见 [`evidences/spec-review-disposition.txt`](evidences/spec-review-disposition.txt)。
- 验证：合入后 `docs:check`、`governance:check` 没有失败。`test:affected --since master --typecheck` 失败 3 项：nb-story 类型检查是 `qa-service.ts:548` 的老问题；nb-story 与 neuro-book 的 `bun test` 在并行负载下失败，单独重跑分别 669、1777 条全过。没有跑 e2e 与截图：行为与样式都没变。
- 从代码看到、没有修的问题：`Button` 加载时图标从 1.15em 变 1em，宽度差 0.15em，违反零布局位移；级联的下一级面板没有入场动画；`.nb-ui-switch-*` 全仓没有消费方。

2026-10-20 先做了一次只读审查（Sonnet），作为整理的输入：报告产物 [`artifacts/spec-review/`](artifacts/spec-review/index.html)，原文 [`evidences/spec-review.txt`](evidences/spec-review.txt)。43 条（重要 26、建议 17），要点：

- `ui-development-spec.md` 的 4.2 节逐个复述组件参数，与组件同名 `.md` 重复，已有 4 处直接冲突；`Select` 的浮层配方在文内抄了 4 到 7 遍。
- 4.3、4.4 两节被已接受的提案 `docs/proposals/workbench-view-host.md` 引用，只能搬、不能删；重排前要先清点至少 21 处按章节号、锚点或标题引用这几份文档的地方。
- `design-language.md` 第八、九节（约 600 行的踩坑与检查表）有历史叙述、已删组件与和现状相反的条目。
- `authoring-themes.md` 与 nb-ui README 还残留已拆掉的主题组件替换机制，README 的示例不能编译。

另做了一次 nb-ui 作为 UI 库的合格性审查（Sonnet，2026-10-20）：原文 [`evidences/lib-review.txt`](evidences/lib-review.txt)，24 条（重要 11）。开发者同意的处理：第 1 步的小修放 [w00029 t07](../t07-lib-review-quick-fixes/README.md)；第 2 到 4 步（CSS layer、弹出列表共用零件、公开 API 对齐）另开 [w00030](../../../w00030-nb-ui-library-structure/README.md)，先写计划；布局引擎拆包以后再说。本 Task 整理文档时以这两处的结果为准。

## 下一步

无。

开工前的决定（开发者 2026-10-20、2026-11-04）写在计划的“关键设计”第 2 节与“待开发者确认”。
