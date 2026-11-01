---
标签: [state:local, state:inject, env:portal]
---

# ProviderDetail

一家服务商的详情（[`models/settings-pages.md`](../../../../../../../docs/specs/models/settings-pages.md) 输出 4 到 8）：上面“连接”一节是标签在上的紧凑表单（API 密钥、接口地址、自定义服务商的接口格式、默认收起的“高级”：认证方式与服务商级请求头），说明收进标题旁的提示；下面“模型”一节是按系列分组、可折叠的模型列表（每行见 [`ModelRow`](ModelRow.md)），列表头有“管理模型”“手动添加”（自定义服务商）与“检测全部”（检测进行中换成“取消检测”）。

组件是受控的：改了什么就发对应的事件，写入与失败的通知由页面做。密钥框与地址框在失焦或回车时才发，与当前值相同时不发；原文密钥发出后框里清空（密钥不留在浏览器里），`env:` 引用照原样显示，引用的变量没有值时框标红并写原因。目录服务商改过地址时出现“恢复目录地址”，地址改回目录地址也算恢复。不要认证（`auth: "none"`）的服务商不显示密钥框。写失败时快照不变，输入框看不出要回到实际值，所以由页面递增 `resetToken` 通知。别处改了密钥或地址时，正在编辑的框不被打断，失焦后再换成实际值；回车之后紧接着失焦不重复发。地址要以 http:// 或 https:// 开头、能解析，否则原位写原因、不发。

## 数据

```ts
type ProviderPatch = {name?: string; baseUrl?: string | null; api?: Api; auth?: "default" | "bearer" | "none"; headers?: Record<string, string>};
defineProps<{
    provider: SnapshotProvider;
    checks?: ReadonlyMap<string, CheckState>;               // 键 `<服务商>/<模型>`，缺省空
    roleUsage?: ReadonlyMap<string, readonly string[]>;     // 模型 id → 绑着它的角色名，缺省空
    disabled?: boolean;                                     // 只读，缺省 false
    resetToken?: number;                                    // 变了就把密钥、地址的草稿换回实际值、请求头编辑器重建（页面在写失败后加一），缺省 0
    checkError?: string;                                    // 这家最近一次“没检成”的原因，写在模型列表头上，缺省空
}>();
defineEmits<{
    (e: "set-key", value: string): void;                    // 原文或 `env:<变量名>`
    (e: "clear-key"): void;
    (e: "update", patch: ProviderPatch): void;              // `baseUrl: null` 是恢复目录地址
    (e: "toggle-model", id: string, enabled: boolean): void;
    (e: "check", id: string): void;
    (e: "check-all"): void;
    (e: "cancel-checks"): void;
    (e: "cancel-check", id: string): void;                  // 取消一个模型的检测
    (e: "edit-model", id: string): void;
    (e: "add-model"): void;
    (e: "manage"): void;
}>();
```

没有 slots 与 expose，attrs 落在根元素上。

## 隐藏通道理由

- `state:local`：密钥与地址的输入草稿（失焦才交）、系列的折叠。
- `state:inject`：文字经宿主注入的翻译端口取。
- `env:portal`：下拉、提示与失败详情的浮层传送到 `body`。
