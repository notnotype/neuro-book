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
};
// 事件：handle-ready(target, instanceToken, handle|null)、change(target,content)、
// save-request(target)、focus-change(target,focused)、view-actions(target,token,actions)、view-error(target,message)
```

无 slots、无 expose，attrs 透传单一根元素。handle-ready 交给唯一编排宿主登记 flush；撤销/重做与视图动作仅由该绑定执行。

## 布局与状态

占满父级高度，min-width/min-height 为零，不拥有页面滚动。错误通过 view-error 交回外壳，不清空正文。新目标成功就绪后才隐藏旧可用实例；同文档已访问视图保留实例，隐藏时不推送全文，显示前只同步当前正文。切文档、同路径重开或 generation 改变时释放旧实例，旧回调失效。

## 交互

切换意图先由编排宿主结算活动输入，再更新受控 editorId/document；目标异步初始化期间旧视图仍可用，真正隐藏旧视图前再结算一次，防止这段等待窗口丢字。handle-ready 后由宿主决定聚焦。布局在390×844仍占满给定空间；具体编辑器负责内部滚动。不承担文件读写、配置解析、保存排队或跨视图统一撤销。
