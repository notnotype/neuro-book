# 2026-06-30 Round 37 - Brief Markdown Boundaries

## Scope

本轮定义 `suggestedBriefMarkdown` 的信息边界。目标是让 brief 足够帮助 writer，但不把 Plot / World Engine 的内部结构、raw state 或未裁决信息泄露给正文 agent。

本轮不修改业务代码。

## Include

`suggestedBriefMarkdown` 第一阶段应包含：

- 章节目标占位：明确需要 leader 补充。
- Scene 顺序：title、purpose、summary、writingTip。
- Thread context：thread title、summary、main thread 标记。
- Scene World Anchor：人类可读 time、subject names/ids、location。
- World query hints：建议 writer 用 readonly `execute_world` 查询哪些 subject / 时间范围。
- Warnings：unresolved subject、缺 anchor、World Context 查询失败摘要。
- Writing constraints：
  - 不新增改变世界线的关键事实。
  - 如正文自然产生新事实，在 report summary 里列出。
  - 角色知道与读者可见需要遵守 leader brief。

## Exclude

必须排除：

- raw patch JSON。
- 完整 subject attrs dump。
- patchId / sliceId，除非后续 writer 真的需要引用；第一阶段不需要。
- Project SQLite 内部 id 之外的数据库结构细节。
- `simulator.leader` / old simulation 指令。
- ChapterOverride 未实现时的伪造 POV / tone / do-not-reveal。

## Ambiguous Items

### `sceneId`

可以包含。理由：

- director/leader 对账需要定位 Scene。
- writer 不应使用 `sceneId` 自行读取 Plot tools，因为 writer 没有 Plot tools。

### subject id

可以包含。理由：

- writer readonly `execute_world` 需要 subject id 查询。
- 同时提供 subject name，避免只给机器 id 造成可读性差。

### attrs 摘要

第一阶段不直接塞 attrs。理由：

- World Engine 是动态状态真相源，writer 可自查。
- attrs 可能过长或包含上帝视角信息。
- brief 只提供 query hints。

后续如果需要加入，应是“writer-safe state summary” Module，而不是 raw attrs。

## Warning Tone

warnings 面向 leader/director，不应直接变成正文指令。markdown 中建议写成：

```md
## Warnings For Leader

- ...
```

leader 调 writer 前可以删除或改写内部 warning。

## Information Control

第一阶段没有 ChapterOverride，所以 markdown 应显式留空：

```md
## Information Control

- 角色已知：待 leader 补充。
- 读者可见：待 leader 补充。
- 暂不揭露：待 leader 补充。
```

这比编造默认值更安全。缺信息控制不应使 brief status 自动失败，但 director/leader 应在 writer 调用前补齐。

## Result

`suggestedBriefMarkdown` 是 handoff 草案，不是最终 writer message。它应承载 Scene/World Context 的结构化摘要和查询提示，但把 canon 判断、信息控制和文风要求留给 leader 编辑。

