---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: web.settings-page
owners:
  - nbook.web
---

# 搜索与网页的设置页

## 目标与非目标

设置窗口 AI 分组下的“搜索与网页”页：填写网页工具（[`web/tools.md`](tools.md)）用的搜索服务密钥并检测，选用哪一家。有 DeepSeek 与 Tavily 两节（planned：Tavily 一节与选用）。密钥的数据与写入经远程合同 `nbook.web/settings`（[`web/tools.md`](tools.md) 输出 16 到 19），选用经设置服务写设置项 `nbook.web/provider`；改了就写，没有“未保存”状态。

不承诺：

- 环境变量引用（`env:` 写法）；从模型设置里带过来 DeepSeek 的密钥。
- 选用的那家没有密钥时自动改选别家；页面不拦“选一家没有密钥的”。
- 本作品标签下编辑（只有用户层）。
- 从别处按 `focus` 定位到某家的密钥框。
- 两家地址的编辑（`nbook.web/deepseekBaseUrl`、`nbook.web/tavilyBaseUrl` 只能改设置文件）。

## 术语与参与者

- **数据模块**：页面用的非组件模块，持有密钥状态与检测状态，所有远程调用经它。

## 输入与前置条件

- 页面是 `nbook.web` 浏览器入口贡献的 page 分区（贡献点 `settings.pages`）：分类 `ai`，`order` 22，`layout: "column"`，`layers: ["user"]`，图标 `i-lucide-globe`，标题“搜索与网页”，说明“让 Agent 搜索与读取网页”，关键词“联网”“网页”“搜索”“DeepSeek”“Tavily”（planned：Tavily）。窗口第一次显示这页时激活浏览器入口。
- 远程合同不可用（服务端入口没激活或已停止）时页面只读。

## 输出与可观察行为

1. **版式**：单列。顶上“使用”一节（planned）：单选 DeepSeek、Tavily；下面每家服务一节，依次“DeepSeek”“Tavily”（planned：Tavily），每节有 API 密钥、检测、说明。
2. **读取中**：第一次拿到 `status` 之前，密钥处显示“读取中”、控件停用，不显示“未设置”。`status` 得 `credentials-unavailable` 时按未设置画（在这里写入会覆盖坏文件）；因别的原因失败（远程合同不可用、请求途中服务端入口停了、超时）时按只读画（输出 7）：顶上写原因，密钥框仍写“读取中”、停用，不显示“未设置”。
3. **API 密钥**：密码框，`autocomplete="new-password"`；已设置时不回显值，显示“已设置”与“清除”；失焦或回车时写（`setKey`），发出时清空输入框，所以回车后紧接着失焦不重复写（已存的密钥不在浏览器里，不比较与写前是否相同）。页面的任何地方（输入框的值、文字、属性）都不出现已存的密钥。
4. **不支持的写法**：输入以 `env:` 开头时原位提示“这里不支持环境变量引用”，不写入。
5. **清除**：点“清除”直接写（`clearKey`），不确认。
6. **写失败**：`setKey`、`clearKey` 失败时交设置窗口通知，写明原因与请重新输入（整句在消息目录里，各语言用自己的标点）；结果未知（`unknown-outcome`）时写“可能没有保存”并重取 `status`。
7. **只读与停用**：远程合同不可用（含取 `status` 时没连上服务端）时控件停用并在页面上写原因；页面上下文的 `writable` 为假时控件停用；`status` 得 `credentials-unavailable` 时写“密钥文件读不了”。
8. **检测**：没有密钥、密钥框里也没有待写的输入时“检测”停用；框里有输入（不是 `env:` 写法）或这一家有写入在途时可点，所以第一次填完直接点就行：按下按钮时框先失焦写入，点击发出的检测等这一家在途的写入结束再发 `check`。进行中按钮显示“检测中”并停用；结果显示通过（带检测的时间）、失败（按码写原因，可以再点）、没检成（远程调用本身失败；结果未知时写“连接断了，不确定检测有没有发出去”，不借写入的说法）。按钮旁写“会发一次搜索，按次计费”。写入或清除成功后，这一家的检测结果清掉；检测已经发出之后写入成功，那次检测用的是旧密钥，取消它、回到空闲，不显示它的结果。离开这页再回来，检测结果与进行中的检测还在；入口停用时取消已经发出的检测，排在写入后面还没发出的不再发。
9. **说明**：DeepSeek 节内写“这把密钥只给搜索与读网页用，与模型设置里的 DeepSeek 密钥分开存放；同一把密钥可以在这里再填一次。”Tavily 节内写“这把密钥只给搜索与读网页用。”（planned）
10. **无障碍**：单选组有组名“使用”（planned）；密码框有标签，说明经 `aria-describedby` 关联；检测结果 `role="status"`，检测进行中在里面写一段只给读屏的“检测中”（按钮停用后读不到它的新文字）；“检测”“清除”的可访问名称带服务名。
11. **选用**（planned）：单选的值是设置项 `nbook.web/provider` 用户层的值，没写时选中缺省的 DeepSeek；点了直接经设置服务写用户层，不确认，之后开始的工具调用用新选的那家。没有密钥的那家选项旁写“未设置密钥”，照样能选。写失败时交窗口通知（同输出 6）、单选回到写前的值。停用条件同输出 7：远程合同不可用或 `writable` 为假时停用；用户层不可写时也停用。

## 状态与转换

| 状态 | 事件 | 下一状态 |
|---|---|---|
| 读取中 | 拿到 `status` | 就绪 |
| 读取中、就绪 | 远程合同不可用，或取 `status` 没连上服务端 | 只读 |
| 只读 | 下一次显示这页，重取到 `status` | 就绪（重取期间仍按只读画） |

检测：空闲 → 进行中 → 通过或失败或没检成；写入、清除成功回到空闲（已经发出的检测随之取消）。

时序与寿命：数据模块随浏览器入口建、随入口停用释放；页面卸载不丢数据模块里的状态。同一家的写入与检测排队，检测读到的是排在它前面的写入之后的密钥。

## 副作用与数据

无（数据都经远程合同）。

## 失败与恢复

| 情形 | 页面的反应 |
|---|---|
| `setKey`、`clearKey` 失败 | 窗口通知，请重新输入 |
| 写入结果未知 | 通知“可能没有保存”，重取 `status` |
| `check` 远程调用失败或结果未知 | 显示“没检成”；结果未知时写不确定检测有没有发出去 |
| `credentials-unavailable` | 页面写“密钥文件读不了” |

## 边界与兼容

- 公开接口：页面的分区 id 与声明；以后加服务时页面多一节，版式不变。
- 浏览器只拿到“有没有密钥”。

## 验收与 Smoke

1. 打开设置窗口的“搜索与网页”页，填密钥后出现“已设置”且输入框为空；检测通过（本机假端点）；清除后回到未设置，检测停用。
2. 填完密钥直接点“检测”（第一次填写、还没有密钥时也一样）：检测用到刚填的密钥。
3. 选用改成 Tavily（planned）：重开设置窗口后仍选中 Tavily；设置文件用户层里 `nbook.web/provider` 为 `"tavily"`；在 Tavily 一节填密钥、检测通过（本机假 Tavily 端点）。

Smoke：生产构建的服务端、真实浏览器、本机假 DeepSeek 端点（`e2e/web-settings.e2e.ts`）。

## 实现合同

- 公开入口：`nbook.web-tools` 浏览器入口贡献的 page 分区 `nbook.web-tools.search`（`SEARCH_SECTION`；planned：改名为 `nbook.web` 与 `nbook.web.search`）；组件 `SearchSettingsPage`、`ApiKeyField` 只在本插件内用。
- owner 与依赖方向：`nbook.web-tools` 的浏览器入口依赖设置窗口的 `settings.pages` 贡献点与自己服务端的远程合同（[`web/tools.md`](tools.md) 输出 16 到 19）。
- 不变量：
  1. 状态都在数据模块里，随浏览器入口建、停用时释放；页面卸载不丢（`search-store.test.ts`、DOM 测试）。
  2. 同一家的检测排在在途的写入后面；写入成功时已经发出的检测作废（`search-store.test.ts`）。
  3. 密钥只进不出：密钥框交出后清空，页面任何地方不出现密钥原文（DOM 测试、e2e）。
  4. 第一次填写时，框里有输入或写入在途时“检测”可点，点击不会落在停用的按钮上（e2e）。

## 证据

- 批准依据：开发者在 [w00052 t01](../../../.agents/works/w00052-web-tools/tasks/t01-design/README.md) 的决定 1 到 6 与[实施计划](../../../.agents/works/w00052-web-tools/tasks/t01-design/plan.md)第 4 稿；[w00052 t02](../../../.agents/works/w00052-web-tools/tasks/t02-tavily-and-batch-search/README.md) 里开发者 2026-11-25 的决定。
- 实现入口：[`web/plugin.ts`](../../../packages/neuro-book/src/plugins/web-tools/web/plugin.ts)
- 合同测试：[`search-store.test.ts`](../../../packages/neuro-book/src/plugins/web-tools/search-store.test.ts)、[`SearchSettingsPage.dom.test.ts`](../../../packages/neuro-book/src/plugins/web-tools/web/components/SearchSettingsPage.dom.test.ts)
- Smoke：[`web-settings.e2e.ts`](../../../packages/neuro-book/e2e/web-settings.e2e.ts)
