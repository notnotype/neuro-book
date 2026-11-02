---
name: design-review
description: 新界面或界面大改需要开发者拍板外观与交互时使用：注意力排序、在草稿 worktree 的 Lab 里出静态稿、作为 Task 产物入库的 HTML 评审板与逐轮记录决定。只改样式细节的小改动不触发。
---

# 界面设计评审

界面的版式、入口、信息层级这类要开发者拍板的事，先出静态稿、逐轮评审，定了再写 Spec 与计划。编码规范、组件复用与 UI 检查见 [ui-development](../ui-development/SKILL.md)，本技能只管从“要设计”到“设计定了”这一段。

## 流程

1. **现状与参照**：先用 `nbdev find <词>` 查已有产物（含其它 Work 的评审板），再用 `nbdev shot` 截现状；有旧应用或旧稿时先调研。现状截图与参照清单写进本 Task 评审板的“现状与参照”一节，用 nbdev 发布。沿用旧设计的机制时说明它防什么、现在还要不要，交开发者决定。
2. **注意力排序**：先和开发者确认首先看什么、默认收起什么、什么时候整块收起，再出视觉候选；版式未定时的视觉迭代会被反复推翻。
3. **静态稿**：在 Lab 里用真实 nb-ui 组件与主题 token 搭一次性的草稿场景，不改产品源码。背景可以用真实页面的截图。一轮只问一两个问题，同一个问题的候选并排。
4. **评审板**：每轮的图与说明放进评审板（见下文），待定的问题写成提问，主 Agent 逐张看过、写好推荐，用 `nbdev artifact publish` 发布，再请开发者看。
5. **记录决定**：用 `nbdev answers` 读开发者的答复，把决定按编号写进 Task README（文字），再用 `nbdev answers ack … --through <cursor> --include <Task README>` 与 README 一起提交；计划写进 `plan.md`。评审板只是讨论材料。
6. **定稿之后**：把行为写进 Spec，再按计划实施。

## 草稿放在哪里

- **草稿代码**：单独的草稿 worktree（例如 `.worktree/<Work 短名>-<Task>-drafts`，分支 `<Task>/drafts`，不合并、不推送）。草稿和编码不在同一个 worktree：开发服务热重载会把编码中途的错误带进草稿截图，草稿的类型错误也会让编码的 typecheck 失败。
- **草稿目录**：草稿组件、它们的同名 `.md` 和样本数据都放在 `packages/neuro-book/src/plugins/drafts/web/components/<草稿名>/`，不另建目录。`drafts` 不是插件：不写 `plugin.ts`，也不在宿主登记，只是借 Lab 按 `src/plugins/*/web/components/` 扫描组件的约定，所以草稿在 Lab 里显示为 `drafts/<草稿名>/…`，与产品组件分开。场景的包装组件放在 Lab 的 `fixtures/drafts/`，并在 `fixtures/index.ts` 里登记（场景可以引用其它插件的 `web/`，`drafts` 也一样）。这些文件与登记改动都留在草稿 worktree，不提交。
- **评审板**：Task 的产物，放主工作区的 `.agents/works/<workId>/tasks/<taskId>/artifacts/review/`，入库，任何会话都能读到。`index.html` 是唯一入口，每轮的图放 `r1/`、`r2/`…；`versions/`（发布记录）与 `answers/`（开发者的答复与确认）只由 nbdev 写。图片按 [本地与入库](../../works/README.md#本地与入库) 的体积上限转成 WebP，原图与完整截图集留在本地 `.local/agent/works/<workId>/tasks/<taskId>/shots/`。
- **不入库**：草稿代码（留在草稿 worktree，不提交）与完整截图集。

## 评审板怎么写

- 按问题分节，待定的放最上面，已定的依次往下，每节开头标“待定”或“已定”。
- 每节写：要开发者定什么、各候选（图或 HTML）、主 Agent 的推荐与理由、开发者的决定。
- 结构、贡献关系、对照表、流程这类能用 HTML 直接表达的，写成 HTML，不截图；“长什么样”用真实组件的截图。
- 标注稿（例如“哪里能贡献”）用界面里不会出现的固定标注色画虚线框加编号，旁边一栏逐条解释；能贡献与不能贡献用两种颜色区分。

## 提问、发布与答复

- **先分清问在哪里**：要看图、要把几个候选并排比较的问题，写进评审板；几乎是纯文字、几句话就讲得清的问题（例如确认提纲、确认写正文时自定的几条、二选一的范围），直接在会话里问，不发评审板。会话里得到的决定照样按编号写进 Task README（开发者 2026-10-15 定）。

- **待定的问题写成提问**：在包住这一节的元素上加 `data-nbdev-question="<题号>"` 与 `data-nbdev-type`，候选上加 `data-nbdev-option="<值>"`，推荐写 `data-nbdev-recommend`；写法见 [提问标记](../../../packages/dev-panel/docs/file-formats.md#提问标记) 与 [例子页](../../../packages/dev-panel/docs/examples/questions.html)。标题里的“待定”“已定”徽标、候选里的“打开”按钮加 `data-nbdev-skip`，不进题目与选项名。标题后直接跟兄弟元素的扁平板，先给每道题包一层 `section`。题目缺省必答：开发者不答也能往下做的（有推荐、照推荐做也行的细节）加 `data-nbdev-optional` 标成选答；只有不定就做不下去的才必答，必答题进首页收件箱、Task 改成完成时也会提醒（开发者 2026-11-02：有的题本该是选答）。
- **发布**：每轮写好后运行 `nbdev artifact publish <workId> <taskId> review --kind design`（第一次要 `--kind`），它解析提问、检查图片体积、写发布记录并与页面文件一起提交。输出逐题列出解析到的题，核对一遍。题意变了就换题号；被后一轮取代的问题换题号或从页面删掉，输出会列出被取代的题（已答的题删掉不算取代）。
- **读答复**：`nbdev answers <workId> <taskId> review --json`，记下输出里的 `cursor`；要挂着等，加 `--wait`，用会话自己的后台机制运行（Claude Code 用 `run_in_background`）；`artifact publish` 与 `ask` 的输出末尾就给出这条命令（`--json` 时在 `data.waitCommand`），发完就挂上。退出码 4（超时、被打断，或被宿主结束）时按原参数重挂；退出码 0 是有了答复，先处理答复并 `answers ack --through <cursor>`，或带 `--since <cursor>` 重挂，否则按原参数重挂会立刻返回。开发者在会话里口头定的，用 `nbdev answers record … --set <题号>=<值>` 代录。
- **确认**：决定写进 Task README 之后运行 `nbdev answers ack <workId> <taskId> review --through <cursor> --include <Task README 的路径>`，确认与 README 同一个提交。`cursor` 取读答复时输出里的那个：只确认读过的答复；读完之后开发者又交的会给 `newer_answers_unacked`，读了它们再确认一次。
- 页面上的“待定”“已定”徽标只给人看，哪道题待答、已答、被取代以发布记录与答复为准。
- **过渡条款**：nbdev 不可用、或还没获授权在真实仓库使用时，按旧做法：直接写产物目录，路径限定提交（`git commit -- <路径>`），答复与决定照旧写进 Task README。

## 谁来搭草稿

- 草稿由主会话自己写：搭稿要用到对问题、已定决定和评审板的了解，交给空白上下文的子代理要整段重讲，还要等它重读代码。
- 开发者要求派子代理时才派。每轮派一个新的，说明里给上一轮的草稿文件路径、评审板与已定的决定，不续用已交回的子代理。
- 任务说明写明：worktree 与输出目录、已定与待定的事、每个场景的内容与取值、文件名、不提交、开发服务记 PID 并在结束时停掉。
- 要它报告：每张图的路径、Lab 地址与场景 id、和要求不一致的地方、搭稿时发现的会影响真实实现的问题（缺字段、组件做不到、合同说不通）。这些问题由主 Agent 核实后进计划或另建 Task。
