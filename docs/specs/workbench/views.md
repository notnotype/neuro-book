---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: workbench.views
owners:
  - nbook.workbench
---

# 工作台视图

## 目标与非目标

**目标**：插件经贡献点 `workbench.views` 向工作台提供视图（侧栏、右栏或面板里的一块工具内容）：插件给声明与组件加载函数，工作台持有实例、落位、尺寸与失败呈现。视图在声明、实现、实例三层上各有寿命，插件入口停止、激活失败、组件加载失败、组件渲染出错都只影响这一个视图，不拖垮外壳，也不丢用户的布局。落位与“移动到”的界面行为见 [ui.workbench-layout](../ui/workbench-layout.md)。

**非目标**：

- 视图的 `when`：随第一个消费者。打开视图的命令（输出 14）不移动焦点，不分“打开并聚焦”与“打开但不夺焦点”（VS Code 的 `preserveFocus`），也没有给视图所属入口的可见性事件：随第一个需要它们的消费者。（视图标题动作随资源管理器的五个按钮实现，见输出 10。）
- 按需激活：可见视图触发 `onView` 激活所属入口（[`runtime.browser-host`](../runtime/browser-host.md) 输出 6）不在本 Spec 的第一版；第一版里贡献视图的入口按自己的激活事件激活。
- 插件禁用、卸载与入口正常停止后的再启用：随插件管理；本 Spec 只定义到时工作台怎样处理“声明消失”。
- 视图自己的持久化状态：由视图所属插件用自己的 store 声明，不在视图声明里。

## 术语与参与者

- **视图声明**：贡献点 `workbench.views` 上一条已接受的声明；贡献 id 就是视图 id。
- **交付句柄**：工作台的接收者在 `published` 时拿到的 `ContributionHandle`（[`runtime.plugins`](../runtime/plugins.md) 输出 24），每次加载都经它的 `implementation()` 取实现。
- **视图代际**：工作台为每个视图维护的单调整数，每创建一个新实例加一；工作台存活期内按视图 id 不复用，不写进布局记录。
- **有效可见**：见 [ui.workbench-layout](../ui/workbench-layout.md) 输出 17。
- 参与者：贡献视图的插件入口（贡献方）、`nbook.workbench` 的浏览器入口（贡献点拥有者、接收者与实例宿主）、浏览器宿主（提供本地能力 `window.plugins`）。

## 输入与前置条件

声明（贡献点 `workbench.views`，`implementation: "required"`，只接受浏览器入口的贡献）：

```ts
interface ViewDeclaration {
    readonly title: Text;                                // 文字值（ui/i18n），与命令标题同一方案；不写时取约定键
    readonly icon: string;                               // 图标类名，例如 i-lucide-files
    readonly location: "sidebar" | "auxiliarybar" | "panel"; // 第一次放到哪个具名面板；之后它在哪由布局文档决定
    readonly order?: number;                             // 同一位置内的顺序，同值按 id；不写时见输出 13
    readonly layout: "scroll" | "fill";                  // scroll：外壳给内边距并负责滚动；fill：视图占满、自己滚动，内边距用外壳给的 --view-inset-inline、--view-inset-block
    readonly minimumSize?: {readonly width?: number; readonly height?: number};
    readonly maximumSize?: {readonly width?: number; readonly height?: number};
    readonly movable?: boolean;                          // 默认 true
    readonly actions?: ReadonlyArray<ViewAction>;        // 标题动作（输出 10），至多 8 个
}
interface ViewAction {
    readonly command: string;                            // 点了执行的命令
    readonly icon: string;
    readonly title: Text;                                // 不写时取约定键
    readonly args?: "instance";                          // 参数是被点的视图实例 {viewId, generation}；省略为 {}
    readonly toggled?: string;                           // 公开状态的布尔键：为真时按钮是按下的样子
    readonly placement?: "inline" | "menu";              // inline（缺省）画成按钮；menu 收进“⋯”
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
| `title` 是文字（见 [`ui/i18n`](../ui/i18n.md)）；`icon` 非空；`location`、`layout` 取上表的值 | 同上 |
| 尺寸是正有限数；`maximumSize` 不小于有效最小值| 同上 |
| 声明不认识的字段 | 同上 |

前置：`nbook.workbench` 的浏览器入口已激活；它激活时读本位置已接受的全部视图声明。

## 输出与可观察行为

输出 7（声明消失时清理布局项）要等插件管理提供声明消失的来源，现在只在纯模型里有规则，标 `(planned)`；其余条目已实现。

1. **注册表的两种输入**：工作台激活时从已接受声明取得视图目录，未交付实现的视图也出现在导航里；接收者只更新交付句柄与交付状态。导航不因交付先后而跳动。
2. **交付状态**：每个视图处于下列之一，原位呈现：
   | 状态 | 含义 | 原位呈现 |
   |---|---|---|
   | `declared` | 有声明，所属入口尚未激活或激活中 | 加载占位 |
   | `entry-blocked` | 所属入口受阻（依赖缺失、环等） | 受阻原因，无动作 |
   | `entry-failed` | 所属入口激活失败 | 失败原因与“重试” |
   | `entry-stopped` | 已交付的实现被撤回（`scope-closed`、`activation-stopped`、`delivery-failed`、`receiver-closed`） | 停止原因 |
   | `available` | 句柄已发布 | 视图内容（见第 3、4 条） |
3. **首次有效可见才加载**：视图第一次有效可见时调用一次 `handle.implementation().load()`，取得组件后创建实例，代际加一，组件收到 `context`。之后的隐藏、切换标签、移动只停放，不重建实例（[ui.workbench-layout](../ui/workbench-layout.md) 输出 14）。
4. **加载门禁**：一次加载记下视图 id、交付句柄与视图代际。结果回来时，句柄已不是该视图的当前句柄、句柄已不处于 `published`、代际已变或工作台已停止，就丢弃这次结果：不挂组件，也不记为加载失败。
5. **三种失败分开**：
   | 失败 | 呈现 | 重试 |
   |---|---|---|
   | 入口受阻或激活失败 | 第 2 条 | 激活失败经“重试”请浏览器宿主恢复并重新激活该入口；受阻不提供重试 |
   | `load()` 失败 | 视图原位显示错误摘要与“重新加载” | 只重试加载，代际加一 |
   | 组件渲染或运行出错（Vue 错误边界接住的部分） | 视图原位显示错误摘要与“重试” | 卸载并重建这个视图的实例，代际加一 |
   一个视图的失败不影响同一块面板的其它视图与外壳；组件自己发起、没有交给 Vue 的异步错误由所属插件处理。
6. **撤回只卸载**：交付句柄被撤回时卸载该视图的组件、丢弃已加载的组件定义，当前代际作废，布局项保留；`receiver-closed`（工作台自己的接收者关闭）同样只释放运行资源，不当作用户删除定制。之后同一视图再次交付时，用新的句柄与新代际重新创建。
7. **声明消失**：视图的声明不再被接受时（插件禁用或卸载），它留在树上显示占位，写明原因，可以关闭（[ui.workbench-layout](../ui/workbench-layout.md) 输出 4）；不动同插件其它仍有效的视图。
8. **`window.plugins`**：浏览器宿主向工作台提供本地能力：查询入口状态与入口声明的激活事件、订阅入口状态变化、对激活失败的入口执行“恢复并重新激活”（不是激活失败的入口返回 `not-failed`）；另有 `problems()` 列出本窗口的问题，供插件页显示（[`runtime.browser-host`](../runtime/browser-host.md)）。工作台只经视图 id 重试，拿不到别的入口。
9. **`ViewContext.visible`** 随有效可见变化；加载中、停放、收起时为 `false`。`location` 是视图所在具名面板的名字，在无名面板里是 `null`。
10. **标题动作**：外壳把声明的 `actions` 里 `placement` 为 `inline`（或省略）的画成 24px 的图标按钮，`menu` 的收进按钮之后的“⋯”下拉（没有 `menu` 项时不画“⋯”，[`workbench.menus`](menus.md) 输出 7）；按钮与“⋯”在面板头里，标签带之后、框架按钮之前（[ui.workbench-layout](../ui/workbench-layout.md) 输出 20）。按钮的可访问名称是动作标题；可用与否与不可用的原因看命令自己的 `when`（与应用菜单同一规则），不可用时禁用、悬停提示是原因；声明了 `toggled` 的是开关，`aria-pressed` 跟着那个公开键。点了经命令服务执行命令：`args: "instance"` 时参数是被点的那个视图实例的 `{viewId, generation}`（[workbench.commands](commands.md) 的 `refresh-files`），否则是 `{}`；视图第一次显示或重新交付、实例还没建立时，要实例的动作禁用、原因是“视图还没加载好”，不要实例的照常可点。视图自己不再画工具栏。按钮、“⋯”与“移动到”只在鼠标位于所在范围上、焦点在范围里或其中的菜单打开时显示，其余时候透明（仍占位、仍能 Tab 到）：multiple 时范围是这个视图的窗格，single 时是整个侧栏或右栏，面板标签带旁的是整个面板；显隐淡入淡出 100ms；不能悬停的设备一直显示。面板与侧栏自己的框架按钮不在此列。
11. **别的插件贡献的标题动作**：贡献点 `workbench.view-title`（菜单项的共同规则见 [`workbench.menus`](menus.md)）给某个视图加按钮或“⋯”里的项，声明里的 `view` 是视图 id。贡献来的项排在视图自己的动作之后：按钮排在视图自己的按钮之后，“⋯”里的项排在视图自己的 `menu` 动作之后、中间画一条分隔线。位置、可用与原因、按下态与“实例还没建立”的规则同输出 10；要实例的贡献项写 `context: "instance"`，收到的参数与输出 10 的 `args: "instance"` 相同。一个视图的按钮（自己的加贡献来的）至多 8 个，放不下的按钮回到它所在的节收进“⋯”（视图自己的在自己那一节，贡献的在它原来的节）。视图没有已接受的声明时它的贡献项不画。“⋯”打开时记下视图、所在容器与模式、交付状态与实例代际（同“移动到”的菜单身份，[`ui.workbench-shell`](../ui/workbench-shell.md) 外壳二），其中任一变化时菜单关闭，之前的选择不执行。
12. **滚动条**：视图里的竖向滚动条（`scroll` 由外框负责，`fill` 由视图自己的滚动元素负责）叠在内容上、不占宽度：6px 宽的半透明滑块、没有轨道底色，内容不溢出时不画；鼠标位于视图上、正在滚动（最后一次滚动后 500ms 内）或拖着滑块时显示，进入时淡入 100ms，离开后等 500ms 再用 800ms 淡出，系统减少动画时不过渡。拖滑块按比例滚动，点滑块以外的轨道按一页滚动。实现是 nb-ui 的 `OverlayScrollbar`。
13. **不写 `order` 的缺省**：内置插件（发布者是保留的发布者）的视图按 0 排；第三方插件的视图按 1000 排，排在内置视图之后，装上插件后侧栏仍先显示内置视图。内置视图的 `order` 都小于 1000。写了 `order` 的照写的排。与写明同一个 `order` 等价。`order` 只决定第一次放进具名面板时排在哪（[ui.workbench-layout](../ui/workbench-layout.md) 输出 4）。
14. **打开视图**：命令 `nbook.view.open {viewId?}`（`nbook.workbench` 的浏览器入口贡献，`effect: write`，不对 Agent 开放，`when` 要布局已就绪）显示视图所在的面板（隐藏、拖到零、收起时都回来）并激活它；成功表示布局已改，视图在下一次渲染时出现，不移动焦点。不给 `viewId` 时经选择服务列出树上的视图（标签是视图标题、说明是所在面板），取消为成功且不写。`viewId` 没有已接受的声明或不在布局里为 `invalid-args`，不在工作台页面（没有布局）为 `unavailable`。作者的状态栏条目收视图助手时，点击即以它的 id 执行这条命令（[`runtime.plugin-api`](../runtime/plugin-api.md) 的“作者 API”）。

### 约定键

视图声明的 `title` 不写时，登记时补成文字引用 `{kind: "text", ns: <贡献方插件 id>, key: "views.<本地 id>.title"}`；标题动作的 `title` 不写时补成 `views.<本地 id>.actions.<命令 id>.title`（规则见 [`ui.i18n`](../ui/i18n.md) 的“约定键”）。本地 id 是视图 id 去掉开头的 `<插件 id>.`；命令 id 原样作为一段，所以它里面的 `.` 让键多出几层（`views.panel.actions.acme.hello.refresh.title`）。声明里写了、但没写 `ns` 的文字引用补成贡献方插件 id。注册表、导航与标题动作拿到的都是补好的声明。

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

- 视图只读写自己插件的数据；工作台只写布局记录 `workbench.layout`（[ui.workbench-layout](../ui/workbench-layout.md)“副作用与数据”）。
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
4. Given `load()` 失败与渲染出错的两个视图，When 分别点“重新加载”与“重试”，Then 只有对应视图换代，同一块面板的其它视图与外壳不受影响。
5. Given 一次进行中的加载，When 所属入口在结果回来前停止，Then 结果被丢弃，不挂组件，不显示加载失败。
6. Given 工作台自己的入口停止（`receiver-closed`），Then 视图全部卸载、之后的加载作废，布局记录没有被改写；工作台入口重新激活要插件管理的重新登记，不在本 Spec。

7. Given 资源管理器声明的五个标题动作，When 打开产品页，Then 它们在侧栏的面板头里，24px；没有可以新建的位置时“新建文件”禁用并以原因作提示；When 点“显示清单文件”，Then 清单文件出现、按钮按下；点“刷新”时命令收到的是这个视图实例的 id 与代际。

8. Given 测试插件给样例视图声明一个 `menu` 动作，另一个测试插件往同一视图贡献一个按钮与一个“⋯”项，When 打开产品页，Then 标题行里视图自己的按钮在前、贡献的按钮在后，“⋯”里自己的项在前、分隔线之后是贡献的项；When 点贡献的“⋯”项（`context: "instance"`），Then 命令收到这个视图实例的 id 与代际。
9. Given 侧栏里的资源管理器与一个 `scroll` 布局、内容溢出的样例视图，When 鼠标在侧栏之外，Then 标题动作透明、滑块不可见，内容宽度与没有滚动条时相同；When 鼠标移入视图，Then 动作与滑块出现；When 鼠标移开、焦点用 Tab 进到标题动作，Then 动作仍可见；When 打开“移动到”菜单并把鼠标移到菜单上，Then 动作不消失；When 拖滑块，Then 内容按比例滚动（输出 10、12）。
10. Given 侧栏被隐藏，When 从命令面板执行“打开视图”并选侧栏里的一个视图，Then 侧栏显示、激活它；When 再执行一次并取消，Then 布局记录不变（输出 14）。

Smoke 入口：`e2e/workbench-views.e2e.ts`（e2e 构建装上测试插件 `test.sample-views`）。

## 实现合同

- 公开入口：贡献点与声明 `plugins/workbench/shared/views.ts`（`WORKBENCH_VIEWS_POINT`、`ViewDeclaration`、作者写下的形状 `WrittenViewDeclaration`（`title` 与动作的 `title` 可省）、`validateViewContribution`）；实现与上下文 `plugins/workbench/web/contracts.ts`（`ViewImplementation`、`ViewContext`）；宿主能力 `shared/host.ts` 的 `windowPluginsKey`。
- owner 与依赖方向：`nbook.workbench` 的浏览器入口拥有贡献点与注册表（`web/views/registry.ts`），只经内核的贡献句柄与宿主能力 `window.plugins` 知道入口状态；浏览器宿主（`web/host/window-plugins.ts`）用应用自己的插件宿主实现该能力。
- 不变量：注册表不缓存实现，每次加载经句柄取；加载结果回来时句柄已不是当前句柄、不处于 published 或工作台已停止就作废（`registry.test.ts` 用真实内核的串行窗口锁定）。代际在实例层按视图 id 单调，每次加载与渲染重试加一。

## 证据

- 实现入口：[`web/views/registry.ts`](../../../packages/neuro-book/src/plugins/workbench/web/views/registry.ts)、[`web/views/view-instances.ts`](../../../packages/neuro-book/src/plugins/workbench/web/views/view-instances.ts)、[`web/components/WorkbenchViewFrame.vue`](../../../packages/neuro-book/src/plugins/workbench/web/components/WorkbenchViewFrame.vue)、[`web/host/window-plugins.ts`](../../../packages/neuro-book/src/web/host/window-plugins.ts)
- 合同测试：标题动作（输出 10、11：placement 与“⋯”、别的插件贡献的项、按钮上限、按 key 执行）为 [`workbench/view-actions.test.ts`](../../../packages/neuro-book/src/plugins/workbench/view-actions.test.ts)（真实内核的命令系统与公开状态：可用与原因、按下态、instance 参数、实例还没建立）；[`views/registry.test.ts`](../../../packages/neuro-book/src/plugins/workbench/web/views/registry.test.ts)（真实内核：从未交付、受阻、激活失败与重试、停止、加载中停止、拥有者停止）；打开视图（输出 14）为 [`commands/view-commands.test.ts`](../../../packages/neuro-book/src/plugins/workbench/web/commands/view-commands.test.ts)（真实布局 store 与真实命令注册表：侧栏与面板被隐藏、面板收起时显示并选中容器，多视图容器里收起的视图展开，未知视图与没有布局，选择与取消，Agent 调用得 `not-exposed`）
- Smoke：打开视图（验收 10）为 `workbench-views.e2e.ts` 的“命令面板的打开视图……”一例；别的插件贡献的标题动作（验收 8）为 `workbench-views.e2e.ts` 的“视图自己的按钮在前、贡献的在后……”一例（测试插件 `test.menus`）；标题动作与滚动条随鼠标显示（验收 9）为同一文件的“标题动作与滚动条随鼠标显示……”一例；标题动作为 [`files-explorer.e2e.ts`](../../../packages/neuro-book/e2e/files-explorer.e2e.ts)（经标题动作新建、全部收起、切换清单文件）；[`workbench-views.e2e.ts`](../../../packages/neuro-book/e2e/workbench-views.e2e.ts)（测试插件 `test.sample-views`：全链路、激活失败与重试、入口停止与刷新、加载失败与渲染出错）
- 批准依据：标题动作（输出 10）为 [t79 计划](../../../.agents/works/w00017-application-runtime-architecture/tasks/t79-workbench-polish/plan.md) 第 5 节，开发者 2026-10-12 确认；[外壳设计稿](../../proposals/workbench-shell-abstractions.md)（2026-10-07 `accepted`）第 4、5 节；视图合同提前到外壳二的决策记录见同一设计稿末尾。输出 10 的显示规则、输出 12 与验收 9 来自 [t89 的评审板](../../../.agents/works/w00017-application-runtime-architecture/tasks/t89-explorer-polish-2/README.md#决定)，开发者 2026-10-14 确认。
