---
schema: nbook.task/v2
taskId: t10-frontmatter-panel
status: planned
updated: 2026-11-16
---

# frontmatter 属性面板

## 目标与范围

正文上方的属性面板，参照 Obsidian：按字段显示与编辑、可切到 YAML 源码、没有时显示“添加属性”

合同：[`workspace/markdown-dialect.md`](../../../../../docs/specs/workspace/markdown-dialect.md) 输出 22（frontmatter 的编辑另定）。来源：t06 决定 13 与 `analysis.md` 第 7 项。

## 当前状态

开发者 2026-10-16 定先搁置；2026-11-16 说“可以做 t09 t10 了”，开始设计。

### 现状与参照（2026-11-16 调研）

- 编解码器：`nb-markdown/src/language/codec/source.ts` 的 `splitFrontmatter` 拆出 frontmatter，原样放在原文对照的 `prefix` 里（不在编辑器文档中），写回时拼在正文前并校验没变。没有读写字段的接口；现在改它只能用源码编辑器改整份文本。
- 控件：`MarkdownControl.vue` 的根里依次是工具栏（传送到编辑组的工具栏位）、页边、滚动容器、版心；正文上方没有现成的位置。组件文档把 frontmatter 面板列为不支持。
- YAML：应用依赖 `yaml` 2.x（实装 2.9.0），新应用只用 `parse`；它的 `parseDocument` 能保留注释与没改的写法。`nb-markdown` 不依赖它。
- 组件：nb-ui 有文本框、数字、复选框、开关、下拉、`SearchSelect`；没有日期输入，也没有标签式的列表输入。nb-form 按 TypeBox 画表单，没有日期控件，属性的类型按值推断、不是先有 schema，不合用。
- 别处读 frontmatter：Lab 组件索引、Skill 包、字数统计（只剥掉）；工作区索引不读。Spec `workbench/editor.md` 写着富文本不含 frontmatter 面板，要改。
- 旧应用：`TipTapFrontmatterPanel.vue`，正文上方可折叠的一块，收起时显示第一行，展开是 YAML 文本框；能添加、去掉 frontmatter；角色、地点、规则三类文件另有“档案表单”按钮。
- Obsidian：属性在笔记顶部，设置“Properties in document”可选显示、隐藏、源码；类型有文字、列表、数字、勾选、日期、日期时间、标签，按属性名在整个库统一；嵌套属性不支持，要看用源码模式；用命令、`Ctrl+;`、菜单，或在文件开头打 `---` 添加。

## 下一步

位置、常驻与类型几处取舍在会话里问开发者，面板出静态稿。
