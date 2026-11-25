---
标签: [state:local, state:inject, io:read]
别名: ["形象分页", "Look View"]
---

# LookView

内置形象（`nbook.canon.look`）的数据分页（[`canon/author-ui.md`](../../../../../../../docs/specs/canon/author-ui.md) 输出 50、51）：绑定层，把条目页给的 `context` 折成 `LookCard` 的属性、把它的事件翻成写入。

- 立绘、外貌、现在穿的点了就地改（立绘是图片那一档的浮层：作品图片文件夹里的候选、上传、说明）；现在穿的的建议值是衣柜里各套的名字（`FieldEditor` 的 `suggestions`）。
- 挂上时人物分页交来了“打开选图”的标记（`LOOK_PICK_KEY`，人物分页的“添加立绘”，输出 49）：放倒标记，写得了就直接打开立绘的就地改。
- “换上”打开现在穿的的就地改，锚在那个按钮上，填好这一套的名字，意图预选“剧情里变了”（所选位置是初值时只有“改设定”）。编辑结束以后锚回到值上。
- 衣柜的加一套、改一套、去掉一套经 `context.listAdd`、`listEdit`、`listRemove` 打开条目页的元素对话框与确认（输出 40）。
- “第 N 章改过”（立绘、外貌、现在穿的）在浮层里看来历（`context.FieldDetail`）。
- 这个条目上自己加的项卡片不画，在下面嵌一节通用字段表（`context.FieldTable`）。

## 数据

```ts
type LookViewProps = {context: ComponentViewContext};
```

## 隐藏通道理由

- `io:read`：经 `context` 读来历；写入经 `context` 的入口由条目页发出。只在真实界面里验证（`entry-page.dom.test.ts`），Lab 里看 `LookCard`。
- `state:local`：现在穿的的编辑器锚在哪、看来历的浮层锚在哪。
- `state:inject`：canon 的翻译端口；人物分页交来的“打开选图”一次性标记（`LOOK_PICK_KEY`，条目页宿主 provide）。
