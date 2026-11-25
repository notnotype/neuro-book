---
schema: nbook.task/v2
taskId: t24-lab-drafts-shelf
status: done
updated: 2026-11-25
---

# Lab 里的草稿区：静态稿入库、评审附 Lab 链接

## 目标与范围

静态稿提交到 master、在 Lab 里自成一组并按 Task 分目录，不参加 Lab 场景的版面门禁；改 design-review 技能：草稿每轮入库、评审板与回复附 Lab 链接；先把 w00039 t41、t42 的草稿搬进去

合同：[`ui/component-lab`](../../../../../docs/specs/ui/component-lab.md) 加“草稿区”一条，调试接口多 `drafts()`，验收 27 的版面门禁不量草稿区。

起因：开发者 2026-11-25 在 w00039 t42 问“Lab 的静态稿是每一轮都删掉了吗”，提出在 Lab 里单独安排一处放静态稿，以后评审时同时发 Lab 链接；主会话提了做法（入库、自成一组、照查类型与挂载、不进版面门禁、组件改了就修或删），开发者答“可以单开一个小 Task 来改 Lab 和 design-review 技能”。之前的做法是草稿只留在草稿 worktree、不提交（design-review 的旧写法），worktree 一清理就没了，也只在那个 worktree 开着开发服务时看得到。

## 当前状态

2026-11-25 完成并合入 master（合并提交 `ac56e5edf`，分支 `feat/w00022-t24-lab-drafts-shelf`）：

- 草稿放 `packages/neuro-book/src/plugins/lab/web/drafts/<Work>-<Task>/`，每个目录导出自己的 `fixtures.ts`，`drafts/index.ts` 用 glob 汇入总登记表；组件索引把它们归到 `drafts/…`。放在 Lab 插件里，是因为原来约定的 `src/plugins/drafts/` 会被架构测试当成一个插件、拦下它对 canon 界面组件的引用；Lab 本来就只在开发版里有。架构测试让草稿区与场景一样可以引别的插件的 `web/`、`shared/`。
- 登记入口 `defineLabFixture` 挪到 `fixtures/define.ts`：草稿区与原有的分组登记（nb-ui、nb-layout、nb-agent-ui）都和总登记表互相导入，原来靠函数声明提升碰巧成立，挪走以后在 vitest 里先求值的分组拿不到它；改成都从 `define.ts` 取，循环没了。
- 调试接口多 `drafts()`；`lab-scenes.e2e.ts` 照样打开草稿的场景，只是不量版面。
- 搬入 w00039 t41（人物、形象两页，第 2 轮）与 t42（条目页，第 1 轮）的草稿。t41 的草稿原来借 bots、stickers 插件的图片，换成 Lab 的样本图；nb-ui 后来去掉了 `IconButton` 的 `ghost` 变体与 `label`，照现在的写法改了。t42 的场景登记原来在草稿 worktree 里有类型错误（`input` 没给 `props`），当时只按 `drafts/` 过滤类型检查的输出、漏看了登记表里的这条，这次改成场景给 props。
- 验证：`bun run typecheck` 通过；`fixtures/index.dom.test.ts` 10 条通过（新加“草稿区每个目录的登记都汇进来、落在 drafts 一组”，把归组改成 `lab/…` 的变异被拦下）；`architecture.test.ts` 与 `component-index-model.test.ts` 13 条通过。lab-scenes e2e：全部场景（含草稿）都挂上；按惯例临时滤掉 ThemeEditor 的 4 条原有 404 再跑一次，版面比对的差异全在已知名单里（AgentDock、SubagentCard、ProfileSettingsPage、贴纸几组等），没有草稿组件（t42 草稿在手机画布上有 2 像素溢出，没出现说明确实没量）。

design-review 技能的“草稿放在哪里”改成草稿区、每轮入库、草稿的寿命，Lab 链接那条改成任何开着的开发服务都能打开。

## 下一步

无。草稿 worktree `.worktree/w00039-t42-drafts` 的草稿已搬进来，那个 worktree 删掉；`.worktree/w00039-t41-drafts` 另有一处没搬（`NewEntryDialog` 的一个草稿场景改在总登记表里，t41 已实现，不再需要），一并删掉。
