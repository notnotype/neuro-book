---
标签: [state:local, state:inject, env:portal]
---

# AddProviderDialog

“添加服务商”对话框（[`models/settings-pages.md`](../../../../../../../docs/specs/models/settings-pages.md) 输出 3）。OMP 目录约 50 家，菜单放不下，所以是可搜索的对话框：顶上搜索框（按名称与 id），下面目录服务商一行一家，最后“其它”一组是“自定义 OpenAI 兼容服务商”。已添加的停用并标“已添加”；本机端点标“不要密钥”；只能登录的停用并写“要登录，第一版不支持”。点一家即发 `add-catalog`；点自定义换成名称、接口地址、接口格式的小表单，页脚“返回”“添加”，名称与地址必填，合格才发 `add-custom`。父组件写入成功后关掉对话框，失败时把原因交回 `error`（列表上方或页脚显示）。

## 数据

```ts
defineProps<{
    open: boolean;                                 // 受控；每次打开回到列表、清空搜索与表单
    catalog: readonly CatalogProvider[] | null;    // null 是还在读
    error?: string;                                // 缺省空
    busy?: boolean;                                // 写入中停用选择，缺省 false
}>();
defineEmits<{
    (e: "update:open", value: boolean): void;
    (e: "add-catalog", id: string): void;
    (e: "add-custom", source: {name: string; baseUrl: string; api: Api}): void;
}>();
```

没有 slots 与 expose；attrs 落在 `Dialog` 的面板上。

## 隐藏通道理由

- `state:local`：搜索词、是否在自定义表单与表单草稿。
- `state:inject`：文字经宿主注入的翻译端口取。
- `env:portal`：nb-ui `Dialog` 传送到 `body`。
