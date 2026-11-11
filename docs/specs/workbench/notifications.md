---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: workbench.notifications
owners:
  - nbook.workbench
---

# 工作台通知

## 目标与非目标

给窗口里的插件一个统一的通知去处：一次操作的结果、后台的失败与长任务的进度，经工作台的通知服务发出，显示在窗口右下角，并记进本窗口的通知中心（底部面板的“通知”视图，状态栏的铃铛）；能当场改的输入留在表单里提示，整页或整视图不可用的原位阻断。本 Spec 定三个去处的分工、通知服务的合同、视口的位置、上限与时长规则，以及通知里“详情”（开发诊断原文）的载体。

不承诺：

- 活动栏角标、系统通知、标签页标题计数、勿扰模式：以后另定。
- 通知中心只记本窗口的通知，刷新页面后清空（输出 13）。
- 持续存在的连接状态横幅：组件 `Banner` 已在 nb-ui，第一个使用者随浏览器宿主的断线重连另定。
- 跨窗口的通知：每个窗口一份队列，别的窗口看不到。

## 术语与参与者

- **去处**：一条提示该显示在哪：表单、通知、原位。判据是“用户能对它做什么”。
- **通知服务**：`nbook.workbench` 提供的服务 `nbook.workbench/notifications`（`notificationsKey`），插件在入口依赖里声明后经 `notify` 发出通知。
- **视口**：nb-ui 的 `NotificationStack`，挂在工作台两个内置页面的根上，显示本窗口的队列。
- 参与者：发出通知的插件（书架、编辑器、文件等）；工作台（队列、视口）；用户（关闭、点动作）。

## 输入与前置条件

- 服务合同（`nbook/plugins/workbench/shared/contracts`）：

  ```ts
  interface NotificationInput {
      tone?: "info" | "success" | "warning" | "error";   // 缺省 info
      title?: Text;
      message: Text;
      action?: {label: Text; run: () => void};
      progress?: number | null;                           // 0 到 100；null 不确定进度；不给就没有进度条
      sticky?: boolean;                                   // 常驻；缺省 error、带动作与带详情的常驻
      detail?: string;                                    // 开发诊断原文；不翻译，必须已脱敏
  }
  interface NotificationHandle { id: string; update(patch: Partial<NotificationInput>): void; dismiss(): void }
  interface Notifications { notify(input: NotificationInput): NotificationHandle }
  ```

- 标题、正文与动作名是文字值 `Text`（字符串、语言映射或文字引用，[`ui/i18n`](../ui/i18n.md)）：服务原样放进队列、不改写，视口显示时按窗口的当前语言翻（输出 9）。字符串是不翻译的字面文字，原样显示；发出方要让通知随语言切换，就交文字引用或语言映射，不先折成字符串。文字引用要自己带命名空间（插件用 SDK `/text` 的 `pluginText`）：通知是运行期文字，不经登记补命名空间。
- `detail` 是开发诊断原文（ADR 0034：诊断原文只进“详情”，不当主文案），是字符串不是 `Text`，不翻译。**传进来的必须已脱敏**：载体不做脱敏，复制会把它原样交给系统剪贴板（脱敏是诊断提供者的责任，[`runtime/diagnostics`](../runtime/diagnostics.md)）。去掉首尾空白后为空的等于没有详情；载体最多留 8000 个 UTF-16 码元，超出的截掉并注明“已截断”（输出 11）。错误码与参数由失败投影在进入通知之前变成这个字符串，载体不接受别的形状。
- 文案格式：标题说发生了什么（“书架没有更新”），正文说原因与现在显示的是什么（“取不到作品列表：连接已断开。显示的是上次的数据。”），动作说能做什么（“重试”）。

## 输出与可观察行为

1. **三个去处。** 用户在当前界面就能改的输入（本地校验不过、服务端针对这个字段的拒绝）留在表单里，不发通知：能事先判断的让提交不可用；提交后才知道的把字段标为无效并聚焦，原因写在表单固定位置的状态行，表单排版不变（[UI 规范](../../../packages/nb-ui/docs/ui-development-spec.md)“表单与无障碍”第 8 条）。一次操作做完的结果与后台的失败发通知；整页或整视图不可用（首次取数失败、窗口失败页、视图加载失败）原位显示原因与重试，不发通知。工作台里持续存在的问题（布局未保存、偏好未保存）仍走状态栏条目。
2. **发出。** `notify` 把通知加进本窗口的队列并返回句柄；视口按加入顺序从下往上堆叠在窗口右下角，容器至多 448px 宽，窄屏按视口宽度收窄。
3. **时长。** `sticky` 为真的不自动消失；没给 `sticky` 时，`tone` 为 `error`、带 `action` 或带 `detail` 的不自动消失（明确给的 `sticky: false` 仍按色调限时）；其余按色调自动消失（info、success 3.2 秒，warning 4.2 秒）。指针停在一条通知上时它的计时暂停，离开后按剩余时间继续、至少再留 0.8 秒。每条通知都有关闭按钮。
4. **动作。** 点动作按钮执行 `run` 并移除该通知；`run` 抛错时通知仍移除，错误记诊断。
5. **更新与移除。** `update` 改标题、正文、色调、动作、进度、详情与常驻（`detail` 给空串清除详情）；改了色调、动作、`sticky`，或详情从无到有、从有到无时，按新值重算是否常驻并从现在重新计时（只换一段原文不重新计时）（进度通知在任务结束后改成 `success` 就会按时消失）；发出时或之后明确给过的 `sticky` 一直算数，直到再次明确改它；指针停在通知上时改了也只重算到期时间，离开后才按剩余时间继续。`dismiss` 立即移除；已消失的通知再 `update` 或 `dismiss` 无效果。
6. **进度。** `progress` 为数字时通知正文下画一条确定进度条，`null` 画不确定进度条（系统设了减少动画时不动）。
7. **寿命。** 队列与 `nbook.workbench` 的浏览器入口同寿：入口停止时清空队列与计时器；页面切换（`/` 与 `/workbench` 之间）不清空。Lab 页面不挂产品视口，Lab 场景要通知时自建队列。
8. **可访问性。** 每条通知是 `role="status"`；关闭按钮有可访问名称；视口不拦截空白处的指针事件。视口根是 `role="region"`，可访问名称“通知”。
9. **文字跟随界面语言。** 视口每次渲染时经窗口的翻译端口把标题、正文与动作名翻成当前语言（规则见 [`ui/i18n`](../ui/i18n.md) 输出 2、4）；切换界面语言后，已显示的通知原地换成新语言的文字，不重新发出、不重新计时。动作抛错的诊断里的动作名按记诊断时的语言翻。
10. **动作行。** 动作与“详情”在正文（与进度条）下面单独一行、左对齐：先是动作（通知色调），有详情时再是“详情”；关闭按钮留在右上角。正文宽度与有没有动作无关。
11. **详情对话框。** 点“详情”打开一个模态对话框：标题是“通知标题：详情”，通知没有标题时只写“详情”，标题随界面语言切换；正文是原文（等宽、折行，续行比本行多缩 2 个字符），原文被截断时下面一行“原文过长，已截断”；页脚是“复制原文”与“关闭”。“复制原文”先用剪贴板 API，不可用（非安全上下文）或被拒时退到浏览器的旧复制命令，两条都不通才显示“复制失败，请手动选择文字”；原文本身也可以选中复制。对话框里是点开那一刻的快照。打开期间整个视口 `inert`，并降到遮罩之下：看着原文时点不到通知里的动作，要先关对话框。Escape、点遮罩、“关闭”都关闭；关闭后焦点回到“详情”按钮，那条通知已经不在时落到视口根。
12. **上限与折叠。** 视口最多显示最新 4 条，更早的折起来，整列最上面一个“还有 n 条较早的通知”小条；点它展开全部（列表在视口里纵向滚动，滚到最新一条），再点收起；总数回到 4 条以内时自动收起。折叠只按时间，不区分常驻与限时；折起来的限时通知照常到时消失，用户展开时它可能已经不在。
13. （planned）**通知中心。** 本窗口发出的每条通知同时记进通知中心，与右下角弹出的那一份是同一条：
    - 新的在前，至多 100 条，多了丢最早的；与队列同寿（入口停止时清空，页面切换不清空，刷新页面就是新的窗口）。
    - 用户关掉、到时消失的通知留在中心；发出方 `dismiss` 的同时从中心移除；`update` 同时改中心里的那一条。
    - 每条记下发出的时刻。
14. （planned）**“通知”视图。** `nbook.workbench` 贡献的视图，第一次放在底部面板，排在“后台任务”（[workbench.background-tasks](background-tasks.md)）之后，显示通知中心。
    - 每条一行，整个列表共用几列：没看过的点、色调图标、标题与正文（同一行，正文淡一档；放不下时截断，悬停看全文）、时间（规则同 [workbench.background-tasks](background-tasks.md) 输出 10）、动作与“详情”（有时才有）、移除。没看过的标题加粗。
    - 点动作执行 `run`，并把这条从中心与弹出的队列里一起移除（`run` 抛错同输出 4）；点“详情”打开输出 11 的对话框；点移除只从中心移除。
    - 视图头的动作“全部清除”：中心为空时不可用。
    - 中心为空时视图中间一句“没有通知。”
15. （planned）**看过。** 通知记进中心时是没看过的；“通知”视图在本窗口有效可见时，中心里的都算看过。视图标签上写没看过的条数（“通知 2”，[workbench.views](views.md) 输出 17），为 0 时只写“通知”。
16. （planned）**视图开着时不弹出。** “通知”视图有效可见时，新的通知只记进中心（算看过），不进右下角弹出的队列；视图不可见以后发出的照常弹出。
17. （planned）**铃铛。** 工作台页面的状态栏右侧固定区，在“显示面板”左边（[ui.workbench-shell](../ui/workbench-shell.md) 输出 44），一直在：
    - 12px 的铃铛图标，与“显示面板”同一种按钮；有没看过的通知时右上角一个强调色的小点，铃铛本身不变色。
    - 悬停提示与可访问名称：没有没看过的时“通知”，有时“通知：N 条没看过”。
    - 点它打开“通知”视图（同 [workbench.views](views.md) 输出 14 的 `nbook.view.open`）。

## 状态与转换

| 当前 | 事件 | 下一状态 |
|---|---|---|
| 不在队列 | `notify` | 显示中（限时或常驻） |
| 显示中（限时） | 到时 | 移除 |
| 显示中（限时） | 指针进入 | 计时暂停 |
| 计时暂停 | 指针离开 | 显示中（剩余时间，至少 0.8 秒） |
| 显示中 | `update` 改了色调、动作、`sticky` 或详情的有无 | 显示中，按新值重算常驻并重新计时 |
| 显示中 | 点动作、点关闭、`dismiss` | 移除 |
| 任一 | 入口停止 | 移除 |
| 显示中 | 用户关掉、到时（planned） | 从弹出的队列移除，通知中心里留着 |
| 在通知中心 | 发出方 `dismiss`、在中心点动作（planned） | 从中心与弹出的队列一起移除 |
| 在通知中心 | 在中心点移除、“全部清除”、超过 100 条（planned） | 只从中心移除 |

时序与寿命：句柄在通知移除后仍可调用，调用无效果；`run` 在视口的点击处理里同步调用。

## 副作用与数据

无持久化；队列只在内存里。

## 失败与恢复

| 情形 | 行为 |
|---|---|
| `run` 抛错 | 通知移除，错误记诊断（`workbench.notifications`） |
| 没有页面根（视口未挂载） | 通知仍进队列，视口挂上后显示 |
| 详情对话框打开期间通知被移除 | 对话框照常显示快照；关闭后焦点落到视口根 |
| `detail` 超过 8000 个码元 | 截到上限（不切开代理对），对话框注明“原文过长，已截断” |
| 剪贴板 API 与旧复制命令都不可用 | “复制原文”显示“复制失败，请手动选择文字”，原文仍可手动选中 |

## 边界与兼容

- 公开接口：`notificationsKey`、`Notifications`、`NotificationInput`、`NotificationHandle`（`nbook/plugins/workbench/shared/contracts`）。
- （planned）视图 `nbook.workbench.notifications`；命令 `nbook.workbench.clear-notifications`（视图头的“全部清除”，不对 Agent 开放）。发出方的服务合同不变。
- nb-ui 侧：`createNotificationQueue`、`hasNotificationDetail`、`NOTIFICATION_DETAIL_MAX_CHARS`、`NotificationStack` 的 `queue` 与 `maxVisible`、`Notification` 的 `progress` 与 `hasDetail`、`DetailDialog`、`CopyButton`、`Banner`（`@notnotype/nb-ui`）。
- 信任边界：文字与详情原文按纯文本渲染，不解释 HTML；详情原文不脱敏，由发出方保证已脱敏。
- `Notification` 的动作从正文右侧一列挪到正文下一行，是 nb-ui 公开组件的外观变化（插件作者经 SDK 用到它时外观随之变）。
- 兼容：`title`、`message` 与动作的 `label` 从 `string` 放宽为 `Text`，传字符串的发出方不用改。nb-ui 队列（`createNotificationQueue`）的同名字段同样放宽，视口经注入的翻译端口翻译。

## 验收与 Smoke

1. Given 书架页，When 刷新失败，Then 右下角出现“书架没有更新”带“重试”且不自动消失；点“重试”后通知消失并重新取数；恢复后不再出现。
2. Given 两个内置页面，When 在 `/` 发出通知后导航到 `/workbench`，Then 通知仍在。
3. Given 一条带进度的通知，When 发出方推进到 100 并改成 success，Then 进度条走到头、通知在 3.2 秒后消失。
4. Given 一条标题、正文与动作名都是文字引用的通知与一条标题是语言映射、正文是字符串的通知，When 界面语言从 zh-CN 切到 en-US，Then 两条通知原地换成英文（字符串不变），同一个通知元素仍在。
5. Given 一条带 `detail`、没给 `sticky` 的 warning 通知，Then 它不自动消失；When 点“详情”，Then 对话框标题“通知标题：详情”、内容是原文，视口 inert 且在遮罩之下；When 点“复制原文”，Then 剪贴板里是完整原文（没有剪贴板 API 时同样）；When Escape，Then 焦点回到“详情”按钮。
6. Given 六条常驻通知，Then 只显示最新 4 条与“还有 2 条较早的通知”；When 点它，Then 六条全部显示、小条变“收起”；When 移除两条，Then 小条消失。
7. Given 对话框打开，When 那条通知被移除，Then 对话框仍显示原文；When 关闭，Then 焦点在视口根上。
8. （planned）Given 工作台页与三条通知（一条被用户关掉、一条到时消失、一条还在弹出），When 打开“通知”视图，Then 三条都在、新的在前，标签上的条数与铃铛的点随之消失；When 视图开着时再发一条，Then 它不弹出、直接出现在列表最上面。
9. （planned）Given 中心里一条带“重试”的通知，When 在中心点“重试”，Then `run` 执行，这条从中心与弹出的队列里一起消失；Given 发出方对另一条 `dismiss`，Then 中心里也没有它了。
10. （planned）Given 101 条通知，Then 中心只留最新的 100 条；When 刷新页面，Then 中心为空。

Smoke：`notifications.dom.test.ts`（真实队列与视口、宿主翻译引擎，验收 3、4，验收 5 的常驻规则）；`NotificationStack.test.ts`（验收 5 的对话框与焦点、6、7）；`e2e/lab-nb-ui.e2e.ts` 的“通知的‘详情’”（验收 5 的真实浏览器复制，含没有剪贴板 API 的退路）；`shelf-page.test.ts` 的刷新失败一组（验收 1）；`mount.dom.test.ts`（验收 2：真实窗口、内核与工作台插件，经路由导航换页面。产品里还没有站内去 `/workbench` 的入口，真实浏览器的验收等入口出现时补）；Lab 场景 `NotificationStack`、`Notification`（进度）、`Banner`。

## 实现合同

- **公开入口**：服务键与类型 `notificationsKey`、`Notifications`、`NotificationInput`、`NotificationHandle`（`nbook/plugins/workbench/shared/contracts`）；nb-ui 的 `createNotificationQueue`（`@notnotype/nb-ui/notifications`）与组件 `NotificationStack`、`Notification`、`Banner`。
- **owner 与依赖方向**：`nbook.workbench` 的浏览器入口持有本窗口的队列并提供服务，两个内置页面各挂一个视口显示它；发出方只依赖服务键，不引用工作台的界面。常驻与时长规则只在服务里定，nb-ui 的队列只认折算后的时长；“有没有详情”由服务、队列与视口共用 `hasNotificationDetail` 一个判据，长度上限在队列里截。详情对话框由视口自己挂一份（`DetailDialog` 是受控、无自有状态的组件，别处要显示详情时各挂一份）。
- **关键不变量**：
  - 队列随入口激活建立、停止时清空，不随页面挂载与卸载（输出 7，验收 2）。
  - 明确给过的 `sticky` 保留到再次明确改它；改了色调、动作、`sticky` 或详情的有无才重算时长（输出 5）。
  - 动作抛错时通知照样移除，错误经诊断记下（输出 4）。
  - 文字原样进队列，翻译只在视口渲染时做（输出 9）：队列与服务里不存翻好的字符串，切换语言不必重推队列。服务只在写动作失败的诊断时经窗口端口翻一次动作名。

## 证据

- 批准依据：开发者 2026-10-11 在 t76 的设计讨论中决定通知按三个去处分工、形式补足到 nb-ui 与应用的通用组件（[t76 计划](../../../.agents/works/w00017-application-runtime-architecture/tasks/t76-bookshelf-polish/plan.md)）；2026-10-12 同意晋升为 `implemented`，验收 2 先由入口级测试覆盖。标题、正文与动作名改为 `Text`（输出 9、验收 4）依据 [《界面文字的消息目录》](../../proposals/i18n-message-catalogs.md) 第 3 节“跨插件传递”（2026-10-27 接受），由 [w00028 t03](../../../.agents/works/w00028-i18n/tasks/t03-shared-packages-migration/plan.md) 的“SDK 与通知”一片实现。详情、动作行、上限折叠与详情对话框（输出 10 到 12、验收 5 到 7）依据 w00028 t04 的五轮设计评审（[Task 记录](../../../.agents/works/w00028-i18n/tasks/t04-failure-details/README.md)的“设计决定”）与[计划](../../../.agents/works/w00028-i18n/tasks/t04-failure-details/plan.md)。
- 实现入口：[`web/notifications.ts`](../../../packages/neuro-book/src/plugins/workbench/web/notifications.ts)（服务与常驻规则）、[`web/plugin.ts`](../../../packages/neuro-book/src/plugins/workbench/web/plugin.ts)（队列与入口同寿）、[`web/home-page.ts`](../../../packages/neuro-book/src/plugins/workbench/web/home-page.ts)（两个页面挂视口）、[`WorkbenchNotifications.vue`](../../../packages/neuro-book/src/plugins/workbench/web/components/WorkbenchNotifications.vue)；nb-ui [`useNotification.ts`](../../../packages/nb-ui/src/composables/useNotification.ts)（队列、计时与悬停暂停）、[`NotificationStack.vue`](../../../packages/nb-ui/src/components/feedback/NotificationStack.vue)、[`Notification.vue`](../../../packages/nb-ui/src/components/feedback/Notification.vue)、[`DetailDialog.vue`](../../../packages/nb-ui/src/components/feedback/DetailDialog.vue)、[`CopyButton.vue`](../../../packages/nb-ui/src/components/controls/CopyButton.vue)
- 合同测试：[`notifications.dom.test.ts`](../../../packages/neuro-book/src/plugins/workbench/web/notifications.dom.test.ts)（输出 2 到 5、9，验收 3、4）、[`useNotification.test.ts`](../../../packages/nb-ui/src/composables/useNotification.test.ts)（输出 3 的时长与悬停）、[`NotificationStack.test.ts`](../../../packages/nb-ui/src/components/feedback/NotificationStack.test.ts)、[`shelf-page.test.ts`](../../../packages/neuro-book/src/plugins/projects/shelf-page.test.ts)（验收 1）
- Smoke：[`mount.dom.test.ts`](../../../packages/neuro-book/src/web/mount.dom.test.ts)（验收 2）；Lab 场景 `NotificationStack`、`Notification`、`Banner`
