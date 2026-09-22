---
标签: [state:local]
---

# EditorViewHost

中央编辑器的受控实例宿主。注册表决定可渲染内容，不包含文件格式分支；每次只向当前活动视图分派输入、保存、焦点和动作。

## 数据

```ts
type Props = {
    document: EditorDocumentSnapshot | null;
    registry: EditorRegistry;
    editorId: string | null;
    commitChange: (request: EditorChangeRequest) => EditorChangeResult; // {target, token, baseRevision, content} → accepted | conflict | stale
    conflictResolution?: {token: string; choice: "adopt-current" | "keep-view"} | null; // 一次性裁决请求
};
// 事件：handle-ready(target, token, handle|null)、save-request(target,token)、focus-change(target,token,focused)、
//       view-actions(target,token,actions)、view-error(target,token,message)、conflict-resolved(token, flushResult)
// expose：flushPendingChange(): "settled" | "conflict"
```

每次实际创建一个实例都会新建唯一 UUID 作为实例 token，并作为 `EditorViewProps.viewInstanceId` 交给贡献渲染；所有出口事件都带这个 token，旧实例的迟到回调因此无法冒充当前实例。attrs 透传单一根元素。

**输入回执**：贡献的 `events.change(target, baseRevision, content)` 是有返回值的提交，由宿主的 `commitChange` 决定归属。只有 `accepted` 才把回执里的快照写进该实例的确认文档；`conflict` 时确认文档不动、内容只留在产生它的实例里（不传播给其它视图），由页面按 Store 的未解决登记发起裁决；`stale` 表示身份已撤销（实例已卸载、目标已换代或非存活实例的回调），内容不归属任何文档。宿主自己不做乐观改写。

**结算**：`flushPendingChange()` 结算本宿主登记的全部实例并聚合，任一实例报 `conflict` 即为 `conflict`。防抖计时器被清掉不等于输入已进入权威缓冲，编排宿主必须按这个结果决定能否隐藏、重挂或切工作面。

**冲突裁决**：`conflictResolution` 是显式的一次性请求，按 token 找到存活实例并调用它的 `resolveConflict(choice)`：`adopt-current` 按最新 `document` 快照重设视图内容并丢弃候选，`keep-view` 用最新修订重提该实例保留的候选（再冲突则继续保留）。执行后必发 `conflict-resolved(token, "settled" | "conflict")` 供页面清请求与登记；token 无匹配实例时不动作也不回报。这条通道不能由「document 变了」隐式触发——兄弟视图回灌是同一种形状，只有它能区分「采用当前正文」与「别人改了正文」。

## 布局与状态

占满父级高度，min-width/min-height 为零，不拥有页面滚动。错误通过 view-error 交回外壳，不清空正文。新目标成功就绪后才隐藏旧可用实例；同文档已访问视图保留实例，隐藏时不推送全文，显示前只同步当前正文。切文档、同路径重开或 generation 改变时释放旧实例，旧回调失效。

## 交互

切换意图先由编排宿主结算活动输入，再更新受控 editorId/document；目标异步初始化期间旧视图仍可用，真正隐藏旧视图前再结算一次，防止这段等待窗口丢字。handle-ready 后由宿主决定聚焦。布局在390×844仍占满给定空间；具体编辑器负责内部滚动。不承担文件读写、配置解析、保存排队或跨视图统一撤销。
