---
标签: [state:local, state:inject, env:portal]
别名: ["服务商与模型", "模型服务设置", "Providers and Models"]
---

# ProvidersPage

设置窗口 AI 分组下的“服务商与模型”页（[`models/settings-pages.md`](../../../../../../../docs/specs/models/settings-pages.md) 输出 1 到 12、15 到 17）：`nbook.models` 贡献的 fill 页面，只在“用户”标签下可用。添加服务商、填密钥与地址、管理并检测模型、删除服务商都在这里。它是页面，不是宿主：数据与写入全在数据模块（`web/models-store.ts`，两页共用一份），组件只读它的快照、调它的方法，写失败交给窗口通知（`reportWriteFailure`）。设置窗口给的页面上下文由 `web/pages.ts` 拆成 `writable` 与 `reportWriteFailure` 两个属性，页面组件只吃普通的属性。改了就写，没有“未保存”状态。

## 布局

- 左栏 [`ProviderRail`](ProviderRail.md)（164px，不随详情滚动），右边是所选服务商的标题与 [`ProviderDetail`](ProviderDetail.md)，或“全部模型”时的 [`AllModelsView`](AllModelsView.md)；右边自己纵向滚动。
- 标题区右侧（`SettingsPageActions`）是当前服务商的“删除”。
- 页面声明 `container-type: inline-size`；宽不到 600px 时左栏收起，右边顶上换成服务商下拉加“添加”。窗口最小 600×400 时详情可滚动。
- 还没有服务商时没有左栏，右边是引导（`EmptyState`）与“添加服务商”。

## 交互

- 第一次挂载时让数据模块订阅快照（`start()`）；拿到第一份快照之前写“读取中”。
- 第一次拿到快照时选第一家服务商；当前这家被删（包括别处删的）时回到“全部模型”。
- “添加服务商”打开 [`AddProviderDialog`](AddProviderDialog.md)，先读目录；添加成功后关掉对话框、新服务商成为当前项，失败的原因留在对话框里。
- 模型的齿轮与“手动添加”打开 [`ModelEditDialog`](ModelEditDialog.md)，保存成功才关；“管理模型”打开 [`ManageModelsDialog`](ManageModelsDialog.md)：目录服务商读目录模型，自定义服务商拉取 `/models`，对话框关掉或重新拉取后迟到的结果丢掉；“完成”一次写加入与移出，自定义服务商拉到的模型缺上下文窗口的加入后停用。
- 检测与“检测全部”进行中可取消；离开页面不取消，结果记在数据模块里，回来还在。
- “删除”先确认（写明去掉几个模型、密钥一起删、哪些角色会变成未绑定），删除后焦点到下一家，没有时上一家，都没有时“添加服务商”（等确认框真正关掉、这家从快照里消失之后再移焦点）。确认框按打开时取定的那家挂载，不跟着当前项：删掉之后当前项变了，跟着当前项会让确认框在关掉之前就被卸掉。
- 写失败：经 `reportWriteFailure(没保存的那一项, {reason, uncertain})` 交给窗口通知，`unknown-outcome` 时 `uncertain` 为真；控件随后跟着快照回到实际值。

## 数据

```ts
defineProps<{
    store: ModelsStore;                                             // 浏览器入口建的数据模块，两页共用
    writable: boolean;                                              // 当前标签那一层能不能写（页面上下文的 writable）
    reportWriteFailure: SettingsPageContext["reportWriteFailure"];  // 写失败交给窗口通知
}>();
```

没有 emits、slots 与 expose；attrs 落在根元素上。

## 状态

- 读取中：第一份快照之前写“读取中”。
- 只读：远程合同不可用（服务端入口没运行或已停止）时顶上写一句说明，写控件全部停用；层不能写（`writable` 为假）时同样停用。
- 空：没有服务商时是引导。
- 出错：写失败走窗口通知；读目录、拉取模型失败的原因写在对应的对话框里。

## 不支持

- 本作品标签下编辑（两个设置项只允许用户层，分区在本作品标签下停用）。
- OAuth 登录、发现方式与兼容选项（见 Spec 的非目标）。

## 隐藏通道理由

- `state:local`：当前选的服务商、各对话框的开合与它们的读取结果、检测的取消句柄。

数据模块、`writable` 与 `reportWriteFailure` 都经属性传入，读写走的是这条明面通道，所以页面没有 `io:*` 与 `state:shared-*` 标签，能在 Lab 里用内存里的远程合同替身摆出来（场景见 `ModelsPageFixture.vue`）。
- `state:inject`：文字经宿主注入的翻译端口取。
- `env:portal`：对话框、下拉与提示传送到 `body`。
