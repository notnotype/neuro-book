---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: agent.profile-settings
owners:
  - packages/neuro-book/src/plugins/agent
---

# Profile 设置页

## 目标与非目标

给用户一个看和改 Profile 的地方：哪些 Profile 能用、不能用的原因，每个 Profile 用什么模型、新会话的审批模式、能用哪些工具，以及新建、打开、删除自己写的 Profile。

不承诺：

- 不做 `settingsSchema` 表单、按 Profile 的压缩设置、按 Profile 的 Skill 与子代理白名单、插件 Profile 的启用与停用。
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
2. 列表每项两行：名称；来源（内置、插件名、“我写的”），有问题时第二行换成“不可用”或“有错误”。可选的在前，`hidden` 的放最后一组“后台”。键盘同“服务商与模型”的左栏：上下键、Home、End 移动并选中，只有当前项在 Tab 序列里；“新建 Profile”不在这个序列里。
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

页面只读写上面列出的设置项，服务端照旧按这两项算工具集与模型缺省，不读页面状态。设置文件里手写的值按同一套规则显示；页面不改写它没动的 Profile。

## 验收与 Smoke

- 新建 Profile、给它去掉一个工具、绑模型，新建会话用它发一条：请求里的工具集与模型都变了；再改坏文件，页面标“有错误”，会话继续用上一版；修好恢复；删除后会话只读。
- 两个窗口同时改不同 Profile、同一 Profile 的不同字段，都不丢。
- Smoke：开发服务里打开设置窗口的 Profile 分区走一遍上面的流程。

## 证据

- 批准依据：开发者 2026-11-07 确认的计划（`.agents/works/w00032-agent-integration/tasks/t05-profile/plan.md`）与评审板三轮决定。
- 实现入口：[`profile-page.ts`](../../../packages/neuro-book/src/plugins/agent/web/profile-page.ts)、[`ProfileSettingsPage.vue`](../../../packages/neuro-book/src/plugins/agent/web/components/ProfileSettingsPage.vue)、[`profile-bundles.ts`](../../../packages/neuro-book/src/plugins/agent/backend/profile-bundles.ts)
- 合同测试：[`profile-page.dom.test.ts`](../../../packages/neuro-book/src/plugins/agent/web/profile-page.dom.test.ts)、[`profile-view.test.ts`](../../../packages/neuro-book/src/plugins/agent/web/profile-view.test.ts)、[`profiles.test.ts`](../../../packages/neuro-book/src/plugins/agent/profiles.test.ts)
- Smoke：[`agent-profiles.e2e.ts`](../../../packages/neuro-book/e2e/agent-profiles.e2e.ts)
