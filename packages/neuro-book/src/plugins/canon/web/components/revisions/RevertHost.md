---
标签: [state:inject, state:shared-write, io:read, io:mutate]
别名: ["还原对话框宿主", "Revert Host"]
---

# RevertHost

窗口里那一个还原对话框的宿主（[`canon/author-ui.md`](../../../../../../../../docs/specs/canon/author-ui.md) 输出 22）：canon 交给工作台的页面浮层（`workbench.overlays`，id `nbook.canon.revert`）挂着它，第一次有人要还原时才挂上。要还原哪一次由窗口里的 `RevertRequests` 给（回执页、保存后的提示、改动记录都往那里放）；预览、写入与成功后的提示在 `revert.ts`（`useRevert`）。本组件另外把带来的变化里的地址写成“星瑕的存款”（读条目的名字与字段显示名），交给 `RevertDialog` 画。

## 状态

- 关着：`RevertRequests.target` 为 null。
- 开着：按 `useRevert` 的阶段，见 `RevertDialog`。成功后关掉并给保存后的提示；被拒收时开着、写原因。

## 数据

```ts
type RevertHostProps = {
    world: CanonWorld;
    /** 世界客户端的读取（预览、读修订）。 */
    client: Pick<CanonClient, "call">;
    requests: RevertRequests;
    notices: CanonNotices;
};
```

## 隐藏通道理由

- `io:read`、`io:mutate`：还原的预览、依赖它的修订的标题与名字随要还原哪一次而定，还原本身是一次写入；发起还原的地方（回执页、提示、改动记录）各不相同，对话框在窗口里一份，只能由它自己读写。只在真实界面里验证（`receipt-page.dom.test.ts`），Lab 里看 `RevertDialog`。
- `state:shared-write`：成功后往窗口里那一份保存后的提示放一条，关掉时清掉 `RevertRequests.target`。
- `state:inject`：经 `useCanonText()`、`useText()` 取翻译端口。
