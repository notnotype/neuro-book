---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: agent.profile-settings
owners:
  - packages/neuro-book/src/plugins/agent
---

# Profile 设置页

## 目标与非目标

给用户一个看和改 Profile 的地方：哪些 Profile 能用、不能用的原因，每个 Profile 用什么模型、新会话的审批模式、能用哪些工具，以及新建、打开、删除自己写的 Profile。

不承诺：

- 不做 `settingsSchema` 表单、按 Profile 的压缩设置、按 Profile 的 Skill、插件 Profile 的启用与停用。
- 不做“复制内置 Profile”：内置的依赖插件内部模块，复制出去打包不过。
- 改动不改变已打开会话的模型与审批模式：它们是新会话的初值（[`contributions.md`](contributions.md) 输出 13）。工具从下一次模型请求起生效（同上输出 4）。
- MCP 工具按服务器分组不在这里定。

## 术语与参与者

- **提供者**：贡献工具的插件。Agent 插件自带的工具显示为“内置”。
- **绑定**：设置项 `nbook.agent.toolBindings` 里这个 Profile 的 `{added, removed}`。
- **Profile 设置**：设置项 `nbook.agent.profileSettings` 里这个 Profile 的 `{model?, role?, approvalMode?}`。
- **模型看到的工具**：工具集（[`contributions.md`](contributions.md) 输出 4）按交给模型的名字去重之后的结果，同名的先出现者胜出（[`harness/runtime.md`](../harness/runtime.md) 输出 15）。

## 输入与前置条件

- 设置窗口的 page 分区（[`settings/settings-window.md`](../settings/settings-window.md)），分类 `ai`，排在“模型角色”之后，只有用户层。`toolBindings`、`profileSettings` 两项归这个分区。
- 用到的远程方法与事件见 [`sessions.md`](sessions.md) 的远程合同：`profiles`、`toolCatalog`、`createUserProfile`、`deleteUserProfile`、`profileCatalogChanged`。
- 模型与角色来自模型服务的快照与变更事件（[`models/service.md`](../models/service.md)）。

## 输出与可观察行为

**整页**

1. 左边是 Profile 列表，右边是选中的那个。第一次打开选中第一项。页面窄于 600px 时，列表收成顶上的下拉加一个新建按钮，下拉选项写状态，工具行与控件改成上下排。
2. 列表每项一行，高度同窗口左栏：图标、名称，行尾一格；有问题时这一格是图标（不可用、有错误各一种），悬停条目写原因；来源（内置、插件名、“我写的”）不写在列表里，在详情头部的提示里。可选的在前，`hidden` 的放最后一组“后台”。键盘同“服务商与模型”的左栏：上下键、Home、End 移动并选中，只有当前项在 Tab 序列里；“新建 Profile”不在这个序列里。
3. 右边头部一行：名称与说明（放不下时截断）、问题、用户级的“打开文件”“删除”。名称与说明可以聚焦，悬停或聚焦时提示全文、key 与来源。
4. 问题不占新的一行：有没有问题，头部之下的内容位置相同。Profile 级的（不可用、有错误）在头部右边，写原因，放不下时截断，全文在提示里；字段级的在这一行标题后加图标，并把说明换成问题。

**模型与审批**

5. 模型一行列“跟随默认”、模型角色（带图标）、可用的模型，依次排列。说明写跟随默认时用哪个角色。选“跟随默认”时删掉这个 Profile 设置里的 `model` 与 `role`；选角色只留 `role`，选模型只留 `model`。文件里两个都有时按 `model` 显示。
6. 绑定的模型或角色已经用不了（模型停用或被删、没有凭据、角色不在或未绑定）时，选项里仍列出它并标“不可用”，这一行按字段级问题提示。
7. 模型服务不在时，模型一行停用，说明写“模型服务不可用”。
8. 审批模式一行：跟随默认加四档；跟随默认时删掉 `approvalMode`，不写哨兵值。说明写只影响新会话的初值，选 `auto`、`yolo` 时换成它们的后果。`hidden` 的 Profile 没有这一行。
9. Profile 声明了 `modelNeeds`，解析到的模型缺看图、缺思考、或上下文窗口小于 `minContext` 时，模型一行按字段级问题提示。不拦选择。模型的窗口未知时不算小于；模型找不到时只提示不可用，不提示缺什么。

**工具**

10. 工具一节列模型看到的工具，按提供者分组，内置在前。组头有折叠箭头、组名与个数，折叠状态不保存。一个工具一行：名字、等级（读、写、执行）、一句说明（放不下时截断，全文在提示里）。Agent 插件自带的工具说明来自界面文字，别的插件的取声明说明的第一行。
11. Profile 必需的工具标“必需”，不能去掉。其余的“×”去掉，立刻写入，可访问名称带工具名与 id。
12. 绑定或 Profile 要求里有、现在不存在的工具列在最后一组“已卸载”：绑定加的能移除，Profile 必需的只标“必需”。
13. 这个 Profile 在绑定里有项时显示“恢复默认”，点了删掉这一项。绑定的 `added`、`removed` 都空时不留这一项。
14. “添加工具”打开对话框：可搜索，按提供者分组，只列打开时还没开的工具，每行“+”，点过变“−”。改动留在对话框里，“完成”时一次写入，没有改动直接关，“取消”不写。写入中按钮停用；失败时留在对话框并写原因。选中的 Profile 变了或消失时对话框关闭。
15. 对话框里，和已开工具同名的工具写明“加入后换掉已开的同名工具”，完成时同一次写入里加新的、去掉旧的。已开的同名工具是 Profile 必需的时，这一行停用并写明原因。
16. 开回 Profile 本来就有的工具时从 `removed` 删掉，不写进 `added`。
17. 有错误、从未成功的 Profile 没有工具一节；之前成功过的按上一次成功的显示。没有工具的后台 Profile 没有这一节。

**写入**

18. 改了就写，没有保存按钮。写入按排队的顺序进行，每次在写的那一刻对设置当时的值求改动，只动这一个 Profile：连点、改不同 Profile、另一个窗口同时写都不互相覆盖。别处抢先写时重算一次，仍冲突算写入失败。
19. 回执之前页面显示这次改动的结果；写入失败时回到设置里的实际值，并走窗口的写入失败通知（对话框的“完成”除外，见输出 14）。
20. 这一层不能写（`writable` 为假）时，所有写入控件停用，“打开文件”照常可用。

**用户级 Profile**

21. “新建 Profile”只问名字（小写字母、数字、连字符）。建好后用编辑器打开文件；它出现在目录里时选中它，状态是“有错误”也选中。已有同名的在对话框里报错，不覆盖。
22. 新建的文件一次写成：过程中目录里不出现空文件造成的错误项。骨架只依赖 SDK 的 `@notnotype/nb-plugin-sdk/agent`，不改就能打包成功。
23. “删除”先确认，确认文字写明不能恢复、用它的会话会变成只读。删除后选中第一项，焦点落在它上面。
24. 目录变了（新建、改坏、修好、删除、工具增减、连接恢复）页面都重取，选中的 Profile 消失时回到第一项。

25. “可派的子代理”一节：工具一节下面，Profile 有 `agent_spawn` 时才有。样子与工具一节相同：按来源分组、一行一个 Profile（图标、名字、“推荐”、说明），Profile 声明里没有、用户加的标“我加的”；每行能去掉；“添加”打开同样的对话框，列出不在白名单里、可用的 Profile；有改动时“恢复默认”。写入 `profileSettings[key].agents: {added, removed}`，规则与时序同工具绑定（输出 14–18）；两个数组都空时不留这一项。推荐由 Profile 声明，这里不能改。白名单里的 Profile 已被删除或不可用时显示一行警告，能去掉；自己派自己、互相派不拦，由深度上限兜底。
26. “Skill”一节：可派的子代理一节下面，样子与它相同：按来源分组（我的 Skill 在前、各插件一组、内置在后，见 [`skills.md`](skills.md) 输出 34）、一行一个 Skill（图标、名字、说明），未初始化的标出；声明 `"all"` 的列出 Skill 目录里的全部，每个能去掉，去掉的收在最后一组“已去掉”，能加回；只声明了几个的，“添加”列出不在白名单里的 Skill，用户加的标“我加的”；白名单里已不在目录的收在“已删除或不可用”，能去掉；有改动时“恢复默认”。写入 `profileSettings[key].skills: {added, removed}`，规则与时序同工具绑定（输出 14–18）；两个数组都空时不留这一项（[`skills.md`](skills.md)）。
27. “表情包”一节：Skill 一节下面，行、分组、添加与恢复默认同 Skill 一节；每行是第一个常用表情的缩略图、显示名、说明与表情数，写入 `profileSettings[key].stickers: {added, removed}`（[`stickers.md`](stickers.md) 输出 19）。
28. **全局对象一行。** 工具一节里，同一个全局对象（[`contributions.md`](contributions.md) 输出 25）的方法合成一行：名字是对象名，等级列出各方法的等级（例如“读、执行”），说明来自界面文字；“×”去掉、对话框里“+”加回、恢复默认、计数与“已卸载”都按对象算；Profile 的工具里没有 `eval` 时这一行照样列出并标明用不了。行的样子与对话框里的写法随界面评审定稿（planned）。
29. **按对象存绑定。** 去掉对象行写进这个 Profile 绑定的 `objects.removed`，加回时从中删掉（Profile 本来没有这个对象时写进 `objects.added`）；动对象行时同时删掉这个对象的方法在 `added`、`removed` 里的旧条目（planned）。

## 状态与转换

| 状态 | 页面 |
|---|---|
| 目录或工具目录加载中 | 占满内容区居中，一个转动的指示加一句说明 |
| 读失败 | 占满内容区居中，原因加重试 |
| 有目录 | 输出 1 到 24 |

时序与寿命：

- 页面先订阅 `profileCatalogChanged`，再取目录与工具目录：两步之间发生的变化不会漏。事件与 `onResync` 都重取两份，晚到的旧结果被丢掉。
- 页面关闭时释放订阅。写入队列里已发出的写入照常完成。
- 对话框打开期间目录变了：候选不刷新，完成时的改动对当时的设置值求值；选中的 Profile 没了就关闭，改动丢掉。

## 副作用与数据

只写 `toolBindings`、`profileSettings` 两个设置项（用户层）与 `<状态根>/user/profiles/` 下的入口文件。删除只删入口文件，它导入的本地文件留着。没有回收站（[`workspace/files.md`](../workspace/files.md)）。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `invalid-name` | 名字不合规则 | 新建对话框原位说明 |
| `exists` | 已有同名文件 | 新建对话框原位说明，不覆盖 |
| `not-found` | 要删的文件已经不在 | 当作已删除，重取目录 |
| 设置写入失败（`conflict` 等） | 见 [`settings/configuration.md`](../settings/configuration.md) | 窗口通知；对话框原位说明 |

## 边界与兼容

页面只读写上面列出的设置项，服务端照旧按这两项算工具集与模型缺省，不读页面状态。绑定加了 `objects` 之后，旧版本读到带它的 `toolBindings` 时按不符合 schema 的值处理（[`settings/configuration.md`](../settings/configuration.md)），降级前写下的对象绑定在旧版本里不生效（planned）。设置文件里手写的值按同一套规则显示；页面不改写它没动的 Profile。

## 验收与 Smoke

- 新建 Profile、给它去掉一个工具、绑模型，新建会话用它发一条：请求里的工具集与模型都变了；再改坏文件，页面标“有错误”，会话继续用上一版；修好恢复；删除后会话只读。
- 两个窗口同时改不同 Profile、同一 Profile 的不同字段，都不丢。
- Smoke：开发服务里打开设置窗口的 Profile 分区走一遍上面的流程。

## 实现合同

- **公开入口**：设置窗口的 `profiles` 分区（`nbook.agent` 的 web 入口登记）；远程方法 `toolCatalog`、`createUserProfile`、`deleteUserProfile` 与事件 `profileCatalogChanged`（`nbook/plugins/agent/shared/remote`）；`nbook/plugins/agent/shared/profile-tools`（`profileToolIds`、`visibleToolIds`、`userProfileAddress`）与 `shared/model-needs`（`modelNeedGaps`）。
- **owner 与依赖方向**：页面与两个设置项（`toolBindings`、`profileSettings`）的写入归 `nbook.agent` 的 web 端，写入经设置服务；Profile 目录与用户级 Profile 文件归服务端的 Profile 打包；模型列表与能力经模型服务插件的 `shared/contracts`，不深导入。
- **关键不变量**：
  - 页面与服务端用同一个 `profileToolIds` 合成工具集，同名按先出现者胜出（`profile-tools.test.ts`“工具集”“改绑定”）。
  - 写入在写时按设置里的当前值重算，冲突重试一次，仍冲突就回到实际值；别的 Profile 与同一 Profile 的别的字段不被覆盖（`profile-page.dom.test.ts`“别处抢先写了”）。
  - 目录先订阅后取，晚到的旧结果不盖新的（`profile-page.dom.test.ts`“目录”）。
  - 新建经同目录的唯一临时文件再链接成入口：同名只有一个成功，不覆盖、不留临时文件（`profiles.test.ts`“输出 18”）。

## 证据

- 批准依据：开发者 2026-11-07 确认的计划（`.agents/works/w00032-agent-integration/tasks/t05-profile/plan.md`）与评审板三轮决定；单行列表（输出 2）依据 [t29 的计划](../../../.agents/works/w00032-agent-integration/tasks/t29-ui-polish-after-t15/plan.md)，开发者 2026-11-16 确认计划并批准晋升。；全局对象一行与按对象存绑定（输出 28、29，planned）依据 [w00033 t03 计划](../../../.agents/works/w00033-page-agent/tasks/t03-ui-guide/plan.md)（开发者 2026-11-26 确认）
- 实现入口：[`profile-page.ts`](../../../packages/neuro-book/src/plugins/agent/web/profile-page.ts)、[`ProfileSettingsPage.vue`](../../../packages/neuro-book/src/plugins/agent/web/components/ProfileSettingsPage.vue)、[`profile-bundles.ts`](../../../packages/neuro-book/src/plugins/agent/backend/profile-bundles.ts)
- 合同测试：[`profile-page.dom.test.ts`](../../../packages/neuro-book/src/plugins/agent/web/profile-page.dom.test.ts)、[`profile-view.test.ts`](../../../packages/neuro-book/src/plugins/agent/web/profile-view.test.ts)、[`profiles.test.ts`](../../../packages/neuro-book/src/plugins/agent/profiles.test.ts)
- Smoke：[`agent-profiles.e2e.ts`](../../../packages/neuro-book/e2e/agent-profiles.e2e.ts)
