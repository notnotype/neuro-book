---
schema: nbook.task/v2
taskId: t39-entry-text-editor
status: planned
updated: 2026-11-24
---

# 条目主文字的整篇编辑器

## 目标与范围

条目的主文字用一个完整的富文本编辑器整篇编辑，让作者像写一份文件一样写条目的 index、引用设定组的数据并看到值（开发者 2026-11-24：“编辑还是直接给用户一个完整的编辑器更加好”“第一版没必要分节”“我们继续先推这个编辑器”）。

范围：

- 第一版主文字不分节：每个条目的主文字只用一块，提交是整篇替换，别处也改了时按整篇问一次。
- 写法（`{字段}`、`<Ref>`、`<Image>`）与内核都不动，内核仍用它现在的解析器把关。
- 阅读与编辑是同一个界面，排版与章节一致。
- t28 的暂存、提交、多窗口留用；拆、并、加块、删块与它们的冲突处理从界面这一层拿掉。

不做：主文字的“这段在剧情里变了”；换解析器、换写法、标签登记表、沙箱块（[t38](../t38-kernel-shared-parser/README.md)，等用过之后再定）；人物设定组与加字段的入口（另建 Task）。

合同：[`canon/author-ui.md`](../../../../../docs/specs/canon/author-ui.md) 的文字分页（输出 39、44 到 47）要改，写计划时定具体条目；内核的 Spec（[`canon/rendering.md`](../../../../../docs/specs/canon/rendering.md)、[`canon/revisions.md`](../../../../../docs/specs/canon/revisions.md)）不变。来由与讨论见[调研记录](../../research/2026-11-24-entry-text-direction.md)。

## 当前状态

2026-11-24 新建，正在写实施计划；计划给开发者看过再实施。

## 下一步

写 `plan.md`（先读 t28 的实现、spike 与 nb-markdown 的编辑器接口），把要点与要定的事交开发者确认。
