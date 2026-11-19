---
标签: [state:inject]
别名: ["搜索与网页", "网页工具设置", "Search and Web"]
---

# SearchSettingsPage

设置窗口 AI 分组下的“搜索与网页”页（[`web/settings-page.md`](../../../../../../../docs/specs/web/settings-page.md)）：`nbook.web-tools` 贡献的 column 页面，只在“用户”标签下可用，填网页工具（`web_search`、`web_fetch`）用的搜索服务密钥并检测。它是页面，不是宿主：数据与写入全在数据模块（`web/search-store.ts`），组件只读它的状态、调它的方法，写失败交给窗口通知（`reportWriteFailure`）。设置窗口给的页面上下文由 `web/pages.ts` 拆成 `writable` 与 `reportWriteFailure`。改了就写，没有“未保存”状态。

## 布局

单列，内容列由设置窗口封顶。每家服务一节（第一版只有 DeepSeek）：节标题、[`ApiKeyField`](ApiKeyField.md)、“检测”按钮与它旁边的计费说明、检测结果、一段说明。顶上可能有一句只读或密钥文件读不了的提示。以后加服务是多一节，版式不变。390 宽时检测按钮与说明换行。

## 交互

- 第一次挂载时让数据模块取状态（`start()`）；拿到之前密钥框是“读取中”。
- 密钥框交出新值时经数据模块写入；“清除”直接写。写失败经 `reportWriteFailure(“DeepSeek 的 API 密钥”, {reason, uncertain})` 交给窗口通知，原因后面写“请重新输入”，`unknown-outcome` 时 `uncertain` 为真（数据模块随后重取状态）。
- “检测”：没有密钥时停用；进行中显示“检测中”并停用；点了之后数据模块等这一家在途的写入结束再发，所以填完直接点也用到刚填的密钥。结果写在按钮下面（`role="status"`）：通过带检测时间，失败按码写原因（可以再点），没检成写远程调用失败的原因。写入、清除成功后结果清掉。离开页面再回来，结果与进行中的检测还在（在数据模块里）。
- 按钮的可访问名称带服务名（“检测 DeepSeek 的密钥”）；节里的说明经 `aria-describedby` 关联到密钥框。

## 数据

```ts
defineProps<{
    store: SearchStore;                                             // 浏览器入口建的数据模块
    writable: boolean;                                              // 当前标签那一层能不能写（页面上下文的 writable）
    reportWriteFailure: SettingsPageContext["reportWriteFailure"];  // 写失败交给窗口通知
}>();
```

没有 emits、slots 与 expose；attrs 落在根元素上。

## 状态

- 读取中：第一次取到状态之前，密钥框写“读取中”、停用。
- 只读：远程合同不可用时顶上写一句说明，控件全部停用；`writable` 为假时控件停用。
- 密钥文件读不了（`credentials-unavailable`）：顶上写一句，提示在下面重新填写会覆盖它；密钥框照常可写。
- 检测：空闲、检测中、通过、失败、没检成。

## 不支持

- 本作品标签下编辑（只有用户层）。
- 显示已存的密钥；环境变量引用；改 DeepSeek 的地址（只能改设置文件）。
- 从别处按 `focus` 定位到某家的密钥框。

## 隐藏通道理由

- `state:inject`：文字经宿主注入的翻译端口取。

数据模块、`writable` 与 `reportWriteFailure` 都经属性传入，读写走的是这条明面通道，所以页面没有 `io:*` 与 `state:shared-*` 标签，能在 Lab 里用内存里的远程合同替身摆出来（场景见 `SearchSettingsPageFixture.vue`）。
