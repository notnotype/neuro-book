---
标签: [state:local, state:inject, io:read]
别名: ["人物分页", "Character View"]
---

# CharacterView

内置人物（`nbook.canon.person`）的数据分页（[`canon/author-ui.md`](../../../../../../../docs/specs/canon/author-ui.md) 输出 49、51、52）：绑定层，把条目页给的 `context` 折成 `CharacterCard` 的属性、把它的事件翻成写入。

- 字段怎么排：性别、年龄、身份、所属、现在在哪、生死，再是这个条目上自己加的各项（列表除外）；现在的状态；性格、说话方式、背景。值与“第 N 章改过”照通用字段表的写法（`rows.ts`）。自己加的列表（作者界面只加文字，Agent 能加别的种类）卡片画不了，在下面嵌一节通用字段表（`context.FieldTable`）。
- 立绘读自同一条目上的形象这一组（`context.other`，界面声明里 `uses` 列了形象）：有图时点了切到形象分页（`showTab`）；没图时切过去并打开立绘的选图；没加过或去掉过时先加上那一组（`addComponent`；在途时那一格不可用，被拒的原因写在立绘下面），成功后同样切过去、打开选图（输出 49）。“打开选图”经条目页给的一次性标记交给形象分页（`look-handoff.ts` 的 `LOOK_PICK_KEY`）；写入在途时作者切走了（这一页卸载）就不再切过去。
- 点值就地改（`context.edit(id, {inline: true})`，编辑器是 `context.FieldEditor`：短项锚在值上的浮层，成段的文字浮在原处）；没有 `FieldEditor` 的宿主里退回确认条。
- “第 N 章改过”在浮层里看来历（`context.FieldDetail`）；现在的状态点了在它下面展开细节（各句、记一句、改起点）；点“改起点”时编辑层浮在现在的状态原处，细节收起。正在看哪个记在 `context.detail`。
- 添加一项资料：列类型的预设里还没加的（按 id 与显示名比；id 在这个条目上占着的不列，所以给的 id 照用）与去掉过的。改名、去掉各一个对话框（改名的确认按钮与回车用同一个判据）；去掉时写“数据会保留，可以恢复”。写入被拒的原因写在那一栏或对话框里。

## 数据

```ts
type CharacterViewProps = {context: ComponentViewContext};
```

## 隐藏通道理由

- `io:read`：经 `context` 读来历（`FieldDetail`）、读同一条目上的形象；写入经 `context` 的入口由条目页发出。只在真实界面里验证（`entry-page.dom.test.ts`），Lab 里看 `CharacterCard`。
- `state:local`：看来历的浮层锚在哪、添加一项与对话框的进行中与原因。
- `state:inject`：canon 的翻译端口；与形象分页交接“打开选图”的一次性标记（`LOOK_PICK_KEY`，条目页宿主 provide）。
