---
标签: [state:local, state:inject, env:portal]
---

# ModelRow

服务商详情模型列表里的一行（[`models/settings-pages.md`](../../../../../../../docs/specs/models/settings-pages.md) 输出 6 到 8）：启用开关、名称（与 id 不同时 id 淡色跟在后面）、绑着它的角色小标、能力图标、淡色的上下文窗口与单价（未知写“单价未知”，输入输出都是 0 写“免费”）、检测状态、检测与编辑两个按钮。缺上下文窗口的自定义模型开关停用（悬停说明）；目录里没有了的写“目录里没有了”。停用被角色用着的模型时，行下出现一条确认（列出这些角色），确认后才发 `toggle(false)`。检测中是一个转圈按钮，点它取消这个模型的检测；通过的图标悬停写检测时间；检测失败的红色图标点开看归类后的原因、服务商原文与“重新检测”，重新检测后焦点到转圈按钮上。页面窄于约 480px 时窗口与单价两格让位给名称。

## 数据

```ts
defineProps<{
    model: SnapshotModel;
    check?: CheckState;           // 检测状态，缺省没有检测过
    roles?: readonly string[];    // 绑着它的角色名，缺省 []
    disabled?: boolean;           // 只读时停用全部控件，缺省 false
}>();
defineEmits<{
    (e: "toggle", enabled: boolean): void;   // 停用被角色用着的模型时，行内确认之后才发
    (e: "check"): void;                      // 检测或“重新检测”
    (e: "cancel"): void;                     // 取消这个模型进行中的检测（点转圈）
    (e: "edit"): void;
}>();
```

根元素是 `<li>`，放在 `<ul>` 里；没有 slots 与 expose，attrs 落在根元素上。

## 隐藏通道理由

- `state:local`：行内确认是否展开、失败详情是否打开。
- `state:inject`：文字经宿主注入的翻译端口取。
- `env:portal`：失败详情的 `Popover` 与提示传送到 `body`。
