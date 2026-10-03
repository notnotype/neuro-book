---
标签: []
---

# BrowserHostFailurePage

窗口启动门禁的整页状态零件。引导失败、协议不兼容和必需插件激活失败时，代替路由页面显示原因与恢复动作；不加载产品数据，也不挂载工作台。

## 布局与交互

占满窗口，内容居中且宽度不超过 28rem；标题、说明和动作纵向排列。长原因自动换行，窗口过小时整页滚动。390×844 与桌面结构一致，没有横向溢出。加载显示 Spinner 和可独立理解的说明；失败带 `role="alert"`，加载带 `role="status"` 与 `aria-busy`。连接失败发出 retry，协议不兼容及启动失败发出 reload。按钮遵循原生 Enter/Space，组件不抢焦点，重试后焦点随宿主新界面接管。

## 数据

```ts
type Props = {
    kind: "starting" | "connection-failed" | "incompatible" | "startup-failed";
    title: string;
    description: string;
    retryLabel: string;
    reloadLabel: string;
    reason?: string;
};
type Emits = {
    (event: "retry"): void;
    (event: "reload"): void;
};
```

props 都是宿主受控值，reason 默认空。没有 slots、expose；attrs 按 Vue 默认透传到根 main。连接失败稳定标记为 `data-browser-connection-failure`，所有失败为 `data-browser-host-failure`。

## 状态与边界

starting 不显示操作并播报正在启动；connection-failed 显示重试；incompatible 显示刷新动作及更新提示；startup-failed 显示原因与刷新动作。无禁用、只读、空数据态。不做鉴权跳转、i18n、网络请求、自动重试或窗口实例创建。宿主提供已翻译文案与恢复事件处理。
