---
标签: [state:local, state:inject, env:portal]
别名: ["服务商与模型", "模型服务设置", "Providers and Models"]
---

# ProvidersPage

设置窗口 AI 分组下的“服务商与模型”页（[`models/settings-pages.md`](../../../../../../../docs/specs/models/settings-pages.md) 输出 1 到 12、15 到 19）：`nbook.models` 贡献的 fill 页面，只在“用户”标签下可用。添加服务商、填密钥与地址、管理并检测模型、删除服务商都在这里。它是页面，不是宿主：数据与写入全在数据模块（`web/models-store.ts`，两页共用一份），组件只读它的快照、调它的方法，写失败交给窗口通知（`reportWriteFailure`）。设置窗口给的页面上下文由 `web/pages.ts` 拆成 `writable`、`reportWriteFailure`、`focus` 与 `takeFocus` 几个属性，页面组件只吃普通的属性。改了就写，没有“未保存”状态。

## 布局

- 左栏 [`ProviderRail`](ProviderRail.md)（164px，不随详情滚动），右边是所选服务商的标题区 [`ProviderHeader`](ProviderHeader.md) 与 [`ProviderDetail`](ProviderDetail.md)，或“全部模型”时的 [`AllModelsView`](AllModelsView.md)；右边自己纵向滚动。
- 删除从左栏发起（条目上的删除图标、右键菜单、Delete 键）；窄布局里左栏收起，删除是下拉旁的图标按钮，删当前选中的那家。标题区不放按钮。
- 页面声明 `container-type: inline-size`；宽不到 600px 时左栏收起，右边顶上换成服务商下拉加“添加”。窗口最小 600×400 时详情可滚动。
- 还没有服务商时没有左栏，右边是引导（`EmptyState`）与“添加服务商”。

## 交互

- 第一次挂载时让数据模块订阅快照（`start()`）；拿到第一份快照之前写“读取中”。
- 第一次拿到快照时选第一家服务商；当前这家被删（包括别处删的）时回到“全部模型”。
- 模型行经数据模块的选用数据读（`loadRows`、`rowsOf`）：选中一家时读它的行，这家的 `modelsRevision` 变了才重读。
- “添加服务商”打开 [`AddProviderDialog`](AddProviderDialog.md)，先读模板表（`templates`）；添加成功后关掉对话框、新服务商成为当前项，要密钥的焦点放在密钥框上，失败的原因留在对话框里。
- 标题区：换图标（`setIcon`，失败原因回到图标面板）、改名（`updateProvider` 的 `name`，重名由标题区先挡）、复制一份（`duplicateProvider`：成功后选中副本、焦点到名称；`partially-applied` 时同样选中副本，并经窗口通知说密钥没复制成功）。
- 模型的齿轮与“手动添加”打开 [`ModelEditDialog`](ModelEditDialog.md)，保存成功才关；“管理模型”打开 [`ManageModelsDialog`](ManageModelsDialog.md)：读这家在列表里与不在列表里的行（`providerModels` 的 `listed` 与 `available`，空白模板也一样），对话框关掉或再打开后迟到的结果丢掉；“完成”一次写加入与移出（`setModels`），缺上下文窗口的加入后停用。
- 模型区的“重新拉取”调 `refreshSource`：受理即回，拉取的进度与结果随快照的 `source` 写在模型区；没受理（没有可用的密钥、服务商不在了）经窗口通知。
- 检测与“检测全部”进行中可取消（详情头取消这家全部，转圈取消一个）；中止句柄与结果都在数据模块里，离开页面不取消，回来还能取消、结果还在。“检测全部”在数据模块里逐个调 `check`、同时至多 4 个；要检测的超过 20 个时先用确认对话框写个数与“会产生真实调用”，确认的是那一份名单，检测的也是它；对话框关上后焦点回到模型区头的按钮。取消后已发出的标“结果未知”，没领到的保持原样。没检成（服务停了、服务商不在了）的原因写在模型列表头上。
- 协议检测（输出 21）的状态在页面：检测前等还没回来的连接写入（改地址、协议、认证）写完；换服务商、离开页面时取消在途的检测，结果不跨服务商留。采纳（`adoptApi`）失败为 `connection-changed` 时不发通知（结果块随快照置灰），别的失败照常通知。
- “删除”先确认（写明去掉几个模型、密钥一起删、哪些角色会变成未绑定）。删的是当前选中的那家时，删除后选中并聚焦下一家，没有时上一家，都没有时“添加服务商”（窄布局里落到顶上的下拉或“添加”）；删的是别的一家时选中不变，焦点回到当前项。取消或删除失败时焦点回到那家的条目（窄布局里是下拉旁的删除按钮）。都等确认框真正关掉、这家从快照里消失之后再移焦点。确认框按打开时取定的那家挂载，不跟着当前项：删掉之后当前项变了，跟着当前项会让确认框在关掉之前就被卸掉。
- 写失败：经 `reportWriteFailure(没保存的那一项, {reason, uncertain})` 交给窗口通知，`unknown-outcome` 时 `uncertain` 为真；控件随后跟着快照回到实际值。
- 打开到指定位置（对话的提示卡用）：第一份快照到了才取走 `focus`（`takeFocus`）。`add` 打开添加服务商；已添加的服务商 id 选中这家并聚焦密钥框（不要认证的没有密钥框，只选中）；认不出的取走后不动。

## 数据

```ts
defineProps<{
    store: ModelsStore;                                             // 浏览器入口建的数据模块，两页共用
    writable: boolean;                                              // 当前标签那一层能不能写（页面上下文的 writable）
    reportWriteFailure: SettingsPageContext["reportWriteFailure"];  // 写失败交给窗口通知
    focus?: string | null;                                          // 页面上下文的 focus；缺省 null
    takeFocus?: () => string | null;                                // 取走 focus（页面上下文的 takeFocus）；缺省总是 null（Lab 与测试不给时不定位）
}>();
```

没有 emits、slots 与 expose；attrs 落在根元素上。

## 状态

- 读取中：第一份快照之前写“读取中”。
- 只读：远程合同不可用（服务端入口没运行或已停止）时顶上写一句说明，写控件全部停用；层不能写（`writable` 为假）时同样停用。
- 空：没有服务商时是引导。
- 出错：写失败走窗口通知；读模板表、拉取模型失败的原因写在对应的对话框里，读模型行失败的原因写在模型列表头上。

## 不支持

- 本作品标签下编辑（两个设置项只允许用户层，分区在本作品标签下停用）。
- OAuth 登录、发现方式与兼容选项（见 Spec 的非目标）。

## 隐藏通道理由

- `state:local`：当前选的服务商、各对话框的开合与它们的读取结果、正在确认删除的那家。
- `state:inject`：文字经宿主注入的翻译端口取。
- `env:portal`：对话框、下拉与提示传送到 `body`。

数据模块、`writable` 与 `reportWriteFailure` 都经属性传入，读写走的是这条明面通道，所以页面没有 `io:*` 与 `state:shared-*` 标签，能在 Lab 里用内存里的远程合同替身摆出来（场景见 `models/web/lab/ModelsPageFixture.vue`）。
