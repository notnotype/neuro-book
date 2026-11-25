---
标签: [state:local, state:inject, io:read]
别名: ["人物分页", "Character View"]
---

# CharacterView

内置人物（`nbook.canon.person`）的数据分页（[`canon/author-ui.md`](../../../../../../../docs/specs/canon/author-ui.md) 输出 49、51、52）：绑定层，把条目页给的 `context` 折成 `CharacterCard` 的属性、把它的事件翻成写入。

- 字段怎么排：性别、年龄、身份、所属、现在在哪、生死，再是这个条目上自己加的各项（列表除外）；现在的状态；性格、说话方式、背景。值与“第 N 章改过”照通用字段表的写法（`rows.ts`）。
- 立绘读自同一条目上的形象这一组（`context.other`，界面声明里 `uses` 列了形象）：有图或没图时点了切到形象分页（`showTab`），没加过或去掉过时点了加上那一组（`addComponent`）。
- 点值就地改（`context.edit(id, {inline: true})`，编辑器是 `context.FieldEditor`：短项锚在值上的浮层，成段的文字浮在原处）；没有 `FieldEditor` 的宿主里退回确认条。
- “第 N 章改过”在浮层里看来历（`context.FieldDetail`）；现在的状态点了在它下面展开细节（各句、记一句、改起点）。正在看哪个记在 `context.detail`。
- 添加一项资料：列类型的预设里还没加的（按 id 与显示名比）与去掉过的；预设的 id 在这个条目上已经占着时不给 id、按显示名生成。改名、去掉各一个对话框；去掉时写“数据会保留，可以恢复”。写入被拒的原因写在那一栏或对话框里。

## 数据

```ts
type CharacterViewProps = {context: ComponentViewContext};
```

## 隐藏通道理由

- `io:read`：经 `context` 读来历（`FieldDetail`）、读同一条目上的形象；写入经 `context` 的入口由条目页发出。只在真实界面里验证（`entry-page.dom.test.ts`），Lab 里看 `CharacterCard`。
- `state:local`：看来历的浮层锚在哪、添加一项与对话框的进行中与原因。
- `state:inject`：canon 的翻译端口。
