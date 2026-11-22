---
标签: ["state:inject", "io:read", "io:mutate", "state:local"]
---

# 人物卡

右侧详情里的人物卡（docs/specs/story/viewer.md 输出 10）：名字、称呼、读者此时知道的同一身份；概况、关系、记录、情节四个页签，带条数。宽屏画在详情外壳（`DetailShell`）里，平板与手机画在浮层里。

## 数据

```ts
defineProps<{
    /** 对象 id。必填。 */
    entity: string;
    /** 停在哪个页签。必填。 */
    tab: "summary" | "relations" | "records" | "episodes";
}>();
```

没有 emits、slots、expose。

## 行为

- 切页签写回会话（`openCard(entity, tab)`）：在详情外壳里拿到的是外壳的会话代理，原位换这一张的页签、不换 `key`，外壳不重挂；地址与保存跟着变。
- 名字那一行是拖动换边的把手（`data-detail-handle`，输出 68）：两张并排时按住它拖；行里的按钮上按下不起拖。
- 头部右边是“⋯”菜单（修订，输出 60）与关闭按钮。两张并排时菜单第一项是“与另一张对调”。关闭按钮调会话的 `closeDrawer`：在外壳里关这一张，在浮层里整块收起。

## 隐藏通道理由

- `state:inject`：经 `useBook()` 取书的会话（切页签、关闭、跳页、阅读位置）；经可选的 `DETAIL_SCOPE` 取外壳给的“并排着两张”与“对调”，浮层里没有外壳，就没有那一项。人物卡里的入口很多，逐层传成属性与事件会让外壳与浮层各写一遍。
- `io:read`：自己按对象查卡片、说法、情节（`useStoryQuery`、`usePagedQuery`），按页签按需取。卡片会在详情外壳、浮层两处出现，查询跟着对象与页签走。
- `io:mutate`：“同一身份”一栏的“断开”与“撤销”（输出 64）经 `useRevise()` 直接发 `revisions.reject`、`revisions.undo`。按钮与结果都只在这张卡里，没有别的地方要知道这次改动；改完由书的数据版本让各处重读。这是 t45 之前就有的做法，t45 补文档时如实登记。

## 注意事项

- 抽屉正在滑进来时先不渲染页签里的长列表，滑完再渲染（`LAYOUT_MOTION`）。
- 关掉时网格冻住外壳的插槽调用（`leave: "retain"`）。卡片自己的查询按 `entity` 读书库数据，关掉时数据不删，照常可读。
