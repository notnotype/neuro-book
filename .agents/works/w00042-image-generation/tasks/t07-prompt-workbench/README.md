---
schema: nbook.task/v2
taskId: t07-prompt-workbench
status: active
updated: 2026-11-09
---

# 提示词工作台

## 目标与范围

用户搭提示词加抽卡的界面：词库、片段组装、原文与标签块切换、结果与种子；先按 design-review 出静态稿，开发者看过再实现。

可借鉴的交互见[调研的法典图鉴一节](../../research/2026-11-06-tag-sources-and-novelai.md#法典图鉴)、NovelAI 的 Prompt Chunks，以及开发者 2026-11-09 推荐的 [nai-atelier](https://github.com/HelloQun54321/nai-atelier)（MIT）：原文加中文对照、同一层括号的几个词合成一个组框、生成前显示费用、片段按固定用途分类。合同：待补充（t03）。

## 已定

2026-11-09 会话里定（开发者“其他都先同意”）：

1. 注意力排序：提示词在左、结果在右，各占一半；结果默认显示最近一批的大图。
2. 词库常驻、做成窄栏；打字时的标签联想在提示词框里弹出，不依赖词库栏。
3. 参数只露一行摘要，点开才展开；负面提示词收成一行（预设名与另加的词）；历史是结果区底部的一条缩略图带，点一批恢复当时的配方。
4. 窄屏时词库变成抽屉；看大图时进灯箱。
5. 工作台是编辑区里的一个标签页，一个标签页一份配方，不做独立页面。
6. Agent 不嵌进工作台，留在对话视图里经工具读写。
7. 静态稿按 NovelAI 的形态画；SD 或 ComfyUI 缺的部分在稿上标出。

## 当前状态

评审板 [artifacts/review/index.html](artifacts/review/index.html) 有两轮、四道题，都待答：

- 第 1 轮：标签怎么显示（推荐标签块并保留切回原文）；词库放外壳侧栏还是标签页里（推荐侧栏）。开发者 11-10 说“先别急”，先做了[社区提示词结构的调研](../../research/2026-11-10-community-prompt-structure.md)。
- 第 2 轮（开发者 11-10 指出漏了预设系统）：提示词区按节组织还是一整段（推荐按节：主体、画风、质量、场景与构图、自然语言、角色、负面）；套用预设以后是引用加差异还是复制（推荐引用加差异）。画风、质量、负面、参数四种节可以套预设，角色可以来自设定。

草稿在 `.worktree/w00042-t07-drafts`（分支 `w00042-t07/drafts`，不合并、不推送），组件在 `packages/neuro-book/src/plugins/drafts/web/components/prompt-workbench/`，Lab 里是 `PromptWorkbenchDraft` 的四个场景。

搭稿时发现、记给 t03 与 t05 的：Token 计数要按模型的分词器算；片段在原文里的写法未定；角色提示词只有 NovelAI 有；NovelAI 专用写法（`girl`、`source#`）要进词库基础层。

## 下一步

等开发者答第 1 轮，按答复出第 2 轮（参数展开、片段页、窄屏），或定稿写 Spec。
