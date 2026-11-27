---
标签: [state:inject, io:read]
别名: ["面板的界面", "Panel Data View"]
---

# PanelDataView

canon 给面板（`nbook.canon.panel`）交的数据分页界面（[`canon/author-ui.md`](../../../../../../../../docs/specs/canon/author-ui.md) 输出 14）：经条目页给的 `context` 读字段，选中的值卡记在 `context.state.selected`（打开分页时选第一张），它的流水经 `context.origins` 按页读，交给 `PanelView` 画。

## 布局与交互

同 `PanelView`。选中的值卡记在 `context.state.selected`，那张卡不在了（字段被删）就选第一张；流水在世界版本、所选位置或模式变了以后按已读的步数重读。

## 状态

同 `PanelView`；流水读取中与失败同 `OriginList`。

## 数据

```ts
type PanelDataViewProps = {context: ComponentViewContext};
```

## 隐藏通道理由

- `io:read`：流水经 `context.origins` 按页读，选中哪张就读哪张的；宿主不知道选中了哪张。只在真实界面里验证，Lab 里看 `PanelView`。
- `state:inject`：经 `useCanonText()` 取翻译端口。
