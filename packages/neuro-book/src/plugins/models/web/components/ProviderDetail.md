---
标签: [state:local, state:inject, env:portal]
---

# ProviderDetail

一家服务商的详情（[`models/settings-pages.md`](../../../../../../../docs/specs/models/settings-pages.md) 输出 4 到 8）：上面“连接”一节是标签在上的紧凑表单（API 密钥、接口地址、有地区的模板的地区、接口格式、默认收起的“高级”：认证方式与服务商级请求头），说明收进标题旁的提示；下面“模型”一节是按系列分组、可折叠的模型列表（每行见 [`ModelRow`](ModelRow.md)），列表头有“管理模型”“手动添加”与“检测全部”（检测进行中换成“取消检测”）；下面一行是模型列表的来源与“重新拉取”，再下面是“服务商新出的模型自动加入”开关（空白模板也有）。标题区（图标、名称、复制一份）在 [`ProviderHeader`](ProviderHeader.md)，由页面放在它上面。

组件是受控的：改了什么就发对应的事件，写入与失败的通知由页面做。密钥框与地址框在失焦或回车时才发，与当前值相同时不发；原文密钥发出后框里清空（密钥不留在浏览器里），`env:` 引用照原样显示，引用的变量没有值时框标红并写原因。改过模板的地址时出现“恢复模板地址”，地址改回模板地址也算恢复；接口格式改得与模板不同时旁边写“已改，模板是 …”与按通用协议发送的说明，选回模板的协议发 `api: null`。不要认证（`auth: "none"`）的服务商不显示密钥框。写失败时快照不变，输入框看不出要回到实际值，所以由页面递增 `resetToken` 通知。别处改了密钥或地址时，正在编辑的框不被打断，失焦后再换成实际值；回车之后紧接着失焦不重复发。地址要以 http:// 或 https:// 开头、能解析，否则原位写原因、不发。

来源一行按快照的 `source` 写（[`models/service.md`](../../../../../../../docs/specs/models/service.md)“模型来源”），`aria-live="polite"`：

| 状态 | 文字 | “重新拉取” |
|---|---|---|
| `refreshing` | 正在拉取服务商的模型列表 | 停用 |
| 有 `error`、有可用的旧列表 | 拉取失败：原因；沿用某时的列表（红字） | 可点 |
| 有 `error`、没有旧列表 | 拉取失败：原因（红字） | 可点 |
| `changed` | 地址、协议或凭据改过，重新拉取后更新 | 可点 |
| `ok` | 服务商的模型列表，更新于某时 | 可点 |
| `none` | 目录模板：用内置的模型目录；空白模板：还没有拉到服务商的模型列表 | 可点 |

没有可用的密钥（`none`、引用的变量没有值）时按钮停用，悬停写“先填密钥才能拉取”；只读时停用。点了发 `refresh-source`，结果随快照回来。

模型行由页面读完交进来（`rows`，来自选用数据）。超过 8 个模型时有搜索框（名称与 id，组件里过滤）。不搜索时：模型不多于 30 个系列默认展开，更多时默认收起，收起的组不渲染，用户点过的组按相反的来；搜索时命中的组全部展开、组头停用，至多画 200 行，多出的写“还有 N 条，缩小搜索词”。读行失败时写原因与“重试”（发 `reload-rows`）。

文字选择：字段下的提示与检查失败的原文可选（见 nb-ui 开发规范的“文字能否选中”）。

## 数据

```ts
type ProviderPatch = {name?: string; region?: string | null; baseUrl?: string | null; api?: Api | null; auth?: "default" | "bearer" | "none"; headers?: Record<string, string>; followSource?: boolean};
defineProps<{
    provider: SnapshotProvider;
    rows?: readonly ModelRow[];                             // 这家的模型行，缺省空
    rowsLoading?: boolean;                                  // 还在读，缺省 false
    rowsFailure?: string;                                   // 读行失败的原因，缺省空
    template?: Template | null;                             // 这家的模板（地区）；模板表还没读到时 null，缺省 null
    checks?: ReadonlyMap<string, CheckState>;               // 键 `<服务商>/<模型>`，缺省空
    roleUsage?: ReadonlyMap<string, readonly string[]>;     // 模型 id → 绑着它的角色名，缺省空
    disabled?: boolean;                                     // 只读，缺省 false
    resetToken?: number;                                    // 变了就把密钥、地址的草稿换回实际值、请求头编辑器重建（页面在写失败后加一），缺省 0
    checkError?: string;                                    // 这家最近一次“没检成”的原因，写在模型列表头上，缺省空
}>();
defineEmits<{
    (e: "set-key", value: string): void;                    // 原文或 `env:<变量名>`
    (e: "clear-key"): void;
    (e: "update", patch: ProviderPatch): void;              // `baseUrl: null` 是恢复模板地址，`api: null` 是回到模板的协议
    (e: "toggle-model", id: string, enabled: boolean): void;
    (e: "check", id: string): void;
    (e: "check-all"): void;
    (e: "cancel-checks"): void;
    (e: "cancel-check", id: string): void;                  // 取消一个模型的检测
    (e: "edit-model", id: string): void;
    (e: "add-model"): void;
    (e: "manage"): void;
    (e: "reload-rows"): void;                               // 读行失败后点“重试”
    (e: "refresh-source"): void;                            // 重新拉取这家的模型列表
}>();
```

钩子：`data-region-select`、`data-api-select`、`data-api-note`、`data-source-status`、`data-source-refresh`、`data-follow-source`、`data-models-search`、`data-models-more`、`data-rows-failure`、`data-models-add`。

没有 slots 与 expose，attrs 落在根元素上。

## 隐藏通道理由

- `state:local`：密钥与地址的输入草稿（失焦才交）、搜索词、系列的折叠。
- `state:inject`：文字经宿主注入的翻译端口取。
- `env:portal`：下拉、提示与失败详情的浮层传送到 `body`。
