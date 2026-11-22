---
标签: [state:local, state:inject, env:portal]
---

# AddProviderDialog

“添加服务商”对话框（[`models/settings-pages.md`](../../../../../../../docs/specs/models/settings-pages.md) 输出 3）。按模板添加：顶上搜索框（按名称、id、地区名），下面按“国际、国内、聚合与网关、其他、自定义”分组，组内多列（对话框装得下两列就两列，窄屏一列）；每行是模板的图标、名称与模型数，有地区的在后面写出地区。同一个模板可以添加多份，所以已添加的不停用，行上标“已添加”并写小字“再添加一份”，可访问名称里带“已添加”；要登录、传输不走 HTTP 请求、认证方式不支持、地址带占位的停用并写原因（登录类与别的停用项在同一张表里，不收起）；本机端点标“不要密钥”。

- 点普通模板即发 `add`。空白模板（OpenAI 兼容、Anthropic 兼容、Gemini 兼容）与有地区的模板进第二步：空白模板填名称、接口地址、接口格式，有地区的单选地区；页脚“返回”“添加”，名称与地址必填、合格才发 `add`。
- 键盘：模板按钮按 DOM 顺序 Tab；搜索框里回车选第一个命中且可添加的模板；进第二步后焦点放进第一个输入，“返回”之后焦点回到被点的那个模板。
- 父组件写入成功后关掉对话框，失败时把原因交回 `error`（列表上方或页脚显示）。

## 数据

```ts
defineProps<{
    open: boolean;                                 // 受控；每次打开回到第一步、清空搜索与表单
    templates: readonly Template[] | null;         // 模板表；null 是还在读
    added?: readonly string[];                      // 已经有实例的模板 id，缺省空
    error?: string;                                // 缺省空
    busy?: boolean;                                // 写入中停用选择，缺省 false
}>();
defineEmits<{
    (e: "update:open", value: boolean): void;
    (e: "add", input: {template: string; region?: string; name?: string; baseUrl?: string; api?: ProviderApi}): void;
}>();
```

没有 slots 与 expose；attrs 落在 `Dialog` 的面板上。钩子：`data-add-provider-dialog`、`data-add-provider-search`、每行 `data-add-provider="<模板 id>"`、分组 `data-add-group`、第二步输入 `data-field="name|baseUrl"` 与地区单选 `data-region`。

## 隐藏通道理由

- `state:local`：搜索词、是否在第二步与表单草稿。
- `state:inject`：文字经宿主注入的翻译端口取。
- `env:portal`：nb-ui `Dialog` 传送到 `body`。
