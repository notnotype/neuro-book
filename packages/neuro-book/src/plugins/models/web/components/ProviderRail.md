---
标签: [state:inject]
---

# ProviderRail

“服务商与模型”页的左栏（[`models/settings-pages.md`](../../../../../../../docs/specs/models/settings-pages.md) 输出 1、12）：顶上“全部模型”（行尾写可用模型数），一条分隔线，下面是添加过的服务商，最后“添加服务商”。每个服务商一行，高度同设置窗口左栏：名称，行尾定宽的一格。这一格先说密钥的问题（没有密钥是钥匙图标、环境变量没有值是警示图标），再说有没有模型检测失败（警示图标），都没有时淡色写启用了几个模型；图标悬停写原因，原因也是条目的读屏描述。选择照设置窗口左栏：当前项 `aria-current="page"` 与半透明选中底色，上下键与 Home、End 移动并选中，只有当前项在 Tab 序列里。

删除：悬停、聚焦或右键菜单开着的那一行，行尾一格换成删除图标，点了发 `remove`；右键条目弹菜单“删除服务商…”；键盘在条目上按 Delete 发 `remove`，Shift+F10 或菜单键开同一个菜单（菜单用 Escape、Tab 关掉时焦点回到条目）。删除图标与条目是并列的兄弟、叠在行尾，不在 Tab 序列里。“全部模型”与只读时都没有删除。

## 数据

```ts
defineProps<{
    providers: readonly SnapshotProvider[];
    current: string;                              // 服务商 id 或 "all"（受控）
    checks?: ReadonlyMap<string, CheckState>;     // 检测结果，键 `<服务商>/<模型>`，缺省空
    disabled?: boolean;                           // 只读时停用“添加服务商”，缺省 false
}>();
defineEmits<{
    (e: "select", id: string): void;
    (e: "add"): void;
    (e: "remove", id: string): void;              // 只发请求；确认框与删除由页面做
}>();
```

没有 slots 与 expose，attrs 落在根元素上。

## 隐藏通道理由

- `state:inject`：文字经宿主注入的翻译端口取。
