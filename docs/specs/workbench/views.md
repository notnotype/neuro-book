---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: workbench.views
owners:
  - nbook.workbench
---

# 工作台视图

## 目标与非目标

**目标**：插件经贡献点 `workbench.views` 向工作台提供视图（侧栏、右栏或面板里的一块工具内容）：插件给声明与组件加载函数，工作台持有实例、落位、尺寸与失败呈现。视图在声明、实现、实例三层上各有寿命，插件入口停止、激活失败、组件加载失败、组件渲染出错都只影响这一个视图，不拖垮外壳，也不丢用户的布局。落位、容器与“移动到”的界面行为见 [`ui.workbench-shell`](../ui/workbench-shell.md) 外壳二。

**非目标**：

- 声明式容器（把多个视图预先归为一组）：随第一个需要分组的消费者另加贡献点；本 Spec 只有隐式容器 `view:<视图 id>`。
- 视图的 `when`、视图标题动作的贡献、供其它插件揭示视图的服务：随第一个消费者。
- 按需激活：可见视图触发 `onView` 激活所属入口（[`runtime.browser-host`](../runtime/browser-host.md) 输出 6）不在本 Spec 的第一版；第一版里贡献视图的入口按自己的激活事件激活。
- 插件禁用、卸载与入口正常停止后的再启用：随插件管理；本 Spec 只定义到时工作台怎样处理“声明消失”。
- 视图自己的持久化状态：由视图所属插件用自己的 store 声明，不在视图声明里。

## 术语与参与者

- **视图声明**：贡献点 `workbench.views` 上一条已接受的声明；贡献 id 就是视图 id。
- **交付句柄**：工作台的接收者在 `published` 时拿到的 `ContributionHandle`（[`runtime.plugins`](../runtime/plugins.md) 输出 24），每次加载都经它的 `implementation()` 取实现。
- **视图代际**：工作台为每个视图维护的单调整数，每创建一个新实例加一；工作台存活期内按视图 id 不复用，不写进布局记录。
- **有效可见**：视图所在容器是所在 ToolPart 的选中容器、该 Part 可见（未隐藏、未拖到零、未被最大化遮住）、视图没有被隐藏或收起，且容器宿主有落点。
- 参与者：贡献视图的插件入口（贡献方）、`nbook.workbench` 的浏览器入口（贡献点拥有者、接收者与实例宿主）、浏览器宿主（提供本地能力 `window.plugins`）。

## 输入与前置条件

声明（贡献点 `workbench.views`，`implementation: "required"`，只接受浏览器入口的贡献）：

```ts
interface ViewDeclaration {
    readonly title: LocalizedText;                       // 与命令标题同一方案
    readonly icon: string;                               // 图标类名，例如 i-lucide-files
    readonly location: "sidebar" | "auxiliarybar" | "panel"; // 默认位置
    readonly order?: number;                             // 同一位置内的顺序，同值按 id
    readonly layout: "scroll" | "fill";                  // scroll：外壳给内边距并负责滚动；fill：视图占满、自己滚动
    readonly minimumSize?: {readonly width?: number; readonly height?: number};
    readonly maximumSize?: {readonly width?: number; readonly height?: number};
    readonly movable?: boolean;                          // 默认 true
}
interface ViewImplementation {
    load(): Promise<Component>;                          // 只取得组件定义；实例由工作台创建
}
// 组件的 props：{context: ViewContext}
interface ViewContext {
    readonly id: string;
    readonly generation: number;
    readonly visible: Readonly<Ref<boolean>>;            // 有效可见；停放与加载中都不算
    readonly location: Readonly<Ref<"sidebar" | "auxiliarybar" | "panel">>;
}
```

| 规则 | 不满足时 |
|---|---|
| 视图 id 至多 128 个字符；`nbook.*` 插件写 `nbook.<名>`，其它插件以自己的插件 id 加 `.` 开头 | 声明被拒（`invalid-declaration`） |
| `title` 两种语言都非空；`icon` 非空；`location`、`layout` 取上表的值 | 同上 |
| 尺寸是正有限数；`maximumSize` 不小于有效最小值（[`ui.workbench-shell`](../ui/workbench-shell.md)“副作用与数据”） | 同上 |
| 声明不认识的字段 | 同上 |

前置：`nbook.workbench` 的浏览器入口已激活；它激活时读本位置已接受的全部视图声明。

## 输出与可观察行为

输出 1–6、8、9 已实现；输出 7（声明消失时清理布局项）要等插件管理提供声明消失的来源，现在只在纯模型里有规则。本 Spec 仍为 `planned`。

1. **注册表的两种输入**：工作台激活时从已接受声明取得视图目录，未交付实现的视图也出现在导航里；接收者只更新交付句柄与交付状态。导航不因交付先后而跳动。
2. **交付状态**：每个视图处于下列之一，原位呈现：
   | 状态 | 含义 | 原位呈现 |
   |---|---|---|
   | `declared` | 有声明，所属入口尚未激活或激活中 | 加载占位 |
   | `entry-blocked` | 所属入口受阻（依赖缺失、环等） | 受阻原因，无动作 |
   | `entry-failed` | 所属入口激活失败 | 失败原因与“重试” |
   | `entry-stopped` | 已交付的实现被撤回（`scope-closed`、`activation-stopped`、`delivery-failed`、`receiver-closed`） | 停止原因 |
   | `available` | 句柄已发布 | 视图内容（见第 3、4 条） |
3. **首次有效可见才加载**：视图第一次有效可见时调用一次 `handle.implementation().load()`，取得组件后创建实例，代际加一，组件收到 `context`。之后的隐藏、切换容器、移动、换轴只停放，不重建实例（[`ui.workbench-shell`](../ui/workbench-shell.md) 输出 18）。
4. **加载门禁**：一次加载记下视图 id、交付句柄与视图代际。结果回来时，句柄已不是该视图的当前句柄、句柄已不处于 `published`、代际已变或工作台已停止，就丢弃这次结果：不挂组件，也不记为加载失败。
5. **三种失败分开**：
   | 失败 | 呈现 | 重试 |
   |---|---|---|
   | 入口受阻或激活失败 | 第 2 条 | 激活失败经“重试”请浏览器宿主恢复并重新激活该入口；受阻不提供重试 |
   | `load()` 失败 | 视图原位显示错误摘要与“重新加载” | 只重试加载，代际加一 |
   | 组件渲染或运行出错（Vue 错误边界接住的部分） | 视图原位显示错误摘要与“重试” | 卸载并重建这个视图的实例，代际加一 |
   一个视图的失败不影响同容器的其它视图与外壳；组件自己发起、没有交给 Vue 的异步错误由所属插件处理。
6. **撤回只卸载**：交付句柄被撤回时卸载该视图的组件、丢弃已加载的组件定义，当前代际作废，布局项保留；`receiver-closed`（工作台自己的接收者关闭）同样只释放运行资源，不当作用户删除定制。之后同一视图再次交付时，用新的句柄与新代际重新创建。
7. **声明消失**：视图的声明不再被接受时（插件禁用或卸载，随插件管理），该视图从呈现中移除，工作台清除这个视图的布局项，不动同插件其它仍有效的视图；它的隐式容器若仍有别的成员则保留（[`ui.workbench-shell`](../ui/workbench-shell.md) 输出 26）。
8. **`window.plugins`**：浏览器宿主向工作台提供本地能力：查询入口状态、订阅入口状态变化、对激活失败的入口执行“恢复并重新激活”（不是激活失败的入口返回 `not-failed`）。工作台只经视图 id 重试，拿不到别的入口。
9. **`ViewContext.visible`** 随有效可见变化；加载中、停放、收起时为 `false`。`location` 随视图所在 ToolPart 变化。

## 状态与转换

| 初始状态 | 事件 | 下一状态 | 实例 |
|---|---|---|---|
| `declared` | 句柄 `published` | `available` | 有效可见时加载并创建 |
| `declared` | 入口受阻 / 激活失败 | `entry-blocked` / `entry-failed` | 无 |
| `entry-failed` | 用户点“重试”且恢复、激活成功 | `available`（新的贡献方代次） | 有效可见时加载，新代际 |
| `entry-failed` | 重试后仍失败 | `entry-failed`（新原因） | 无 |
| `available` | 句柄撤回 | `entry-stopped` | 卸载，代际作废 |
| `entry-stopped` | 同一视图再次交付 | `available` | 新句柄、新代际 |
| 任意 | 声明消失 | 移除 | 卸载并清理布局项 |

时序与寿命：

- 交付句柄从 `published` 起可用，到 `revoke` 为止；撤回之后访问 `implementation()` 抛错，工作台不缓存实现。
- 一次加载从发起到结果回来之间，入口可能停止：撤回先于结果到达时按第 4 条丢弃；结果先到、撤回后到时，先挂上的实例随撤回卸载。
- 视图代际在工作台存活期内单调；工作台重建后旧的回调与菜单全部作废。
- “重新加载”“重试”在一次进行中时重复点击不发起第二次。
- 入口状态的变化通知可能晚于接收者回调；两者不一致时以交付句柄为准：有已发布句柄就是 `available`。

## 副作用与数据

- 视图只读写自己插件的数据；工作台只写布局记录 `views-customizations` 里的视图与容器字段（[`ui.workbench-shell`](../ui/workbench-shell.md)“副作用与数据”）。
- 交付状态、代际、已加载的组件定义只在内存。

## 失败与恢复

| 情况 | 结果 | 调用方或用户怎么办 |
|---|---|---|
| 声明不合规则 | 声明被拒，内核诊断写明原因；视图不出现 | 插件作者按诊断修正 |
| 入口受阻 | `entry-blocked`，原位显示原因 | 解决依赖后刷新页面 |
| 入口激活失败 | `entry-failed`，原位显示原因与“重试” | 点“重试” |
| `load()` 失败 | 原位错误与“重新加载” | 点“重新加载” |
| 渲染出错 | 原位错误与“重试” | 点“重试” |
| 已交付后撤回 | `entry-stopped`，原位显示原因 | 等入口重新交付，或刷新页面 |
| `window.plugins` 不可用（宿主没有提供） | 交付状态只区分 `declared`、`available`、`entry-stopped`，没有“重试” | 无 |

## 边界与兼容

- 公开接口：贡献点 `workbench.views`、`ViewDeclaration`、`ViewImplementation`、`ViewContext`。声明字段只增不改；新增可选字段不影响旧插件。
- 信任边界：组件跑在工作台的 Vue 应用里，错误边界只覆盖 Vue 调用路径；第三方插件的组件加载随 [`runtime.plugin-code-loading`](../runtime/plugin-code-loading.md)。
- `window.plugins` 是浏览器宿主给工作台的本地能力，不是插件公开 API；插件管理实现后它的职责并入插件管理的服务。

## 验收与 Smoke

1. Given 一个贡献视图的测试插件，When 打开产品页，Then 视图按声明出现在默认位置，第一次有效可见才加载，`context.generation` 为 1；When 移动、隐藏再显示，Then 实例不重建。
2. Given 插件入口激活失败，When 打开产品页，Then 视图原位显示原因与“重试”，布局项保留；When 消除失败原因后点“重试”，Then 视图以新代际出现在原位置。
3. Given 已显示的视图，When 所属入口停止，Then 组件卸载、原位显示停止原因，布局项保留；刷新页面后视图回到原位置。
4. Given `load()` 失败与渲染出错的两个视图，When 分别点“重新加载”与“重试”，Then 只有对应视图换代，同容器其它视图与外壳不受影响。
5. Given 一次进行中的加载，When 所属入口在结果回来前停止，Then 结果被丢弃，不挂组件，不显示加载失败。
6. Given 工作台自己的入口停止（`receiver-closed`），Then 视图全部卸载、之后的加载作废，布局记录没有被改写；工作台入口重新激活要插件管理的重新登记，不在本 Spec。

Smoke 入口：`e2e/workbench-views.e2e.ts`（e2e 构建装上测试插件 `test.sample-views`）。

## 实现合同

- 公开入口：贡献点与声明 `plugins/workbench/shared/views.ts`（`WORKBENCH_VIEWS_POINT`、`ViewDeclaration`、`validateViewContribution`）；实现与上下文 `plugins/workbench/web/contracts.ts`（`ViewImplementation`、`ViewContext`）；宿主能力 `shared/host.ts` 的 `windowPluginsKey`。
- owner 与依赖方向：`nbook.workbench` 的浏览器入口拥有贡献点与注册表（`web/views/registry.ts`），只经内核的贡献句柄与宿主能力 `window.plugins` 知道入口状态；浏览器宿主（`web/host/window-plugins.ts`）用应用自己的插件宿主实现该能力。
- 不变量：注册表不缓存实现，每次加载经句柄取；加载结果回来时句柄已不是当前句柄、不处于 published 或工作台已停止就作废（`registry.test.ts` 用真实内核的串行窗口锁定）。代际在实例层按视图 id 单调，每次加载与渲染重试加一。

## 证据

- 实现入口：[`web/views/registry.ts`](../../../packages/neuro-book/src/plugins/workbench/web/views/registry.ts)、[`web/components/WorkbenchViewInstances.vue`](../../../packages/neuro-book/src/plugins/workbench/web/components/WorkbenchViewInstances.vue)、[`web/components/WorkbenchViewFrame.vue`](../../../packages/neuro-book/src/plugins/workbench/web/components/WorkbenchViewFrame.vue)、[`web/host/window-plugins.ts`](../../../packages/neuro-book/src/web/host/window-plugins.ts)
- 合同测试：[`views/registry.test.ts`](../../../packages/neuro-book/src/plugins/workbench/web/views/registry.test.ts)（真实内核：从未交付、受阻、激活失败与重试、停止、加载中停止、拥有者停止）
- Smoke：[`workbench-views.e2e.ts`](../../../packages/neuro-book/e2e/workbench-views.e2e.ts)（测试插件 `test.sample-views`：全链路、激活失败与重试、入口停止与刷新、加载失败与渲染出错）
- 批准依据：[外壳设计稿](../../proposals/workbench-shell-abstractions.md)（2026-10-07 `accepted`）第 4、5 节；视图合同提前到外壳二的决策记录见同一设计稿末尾。
