# 设计：Agent 看懂并引导 NeuroBook 界面（第四稿，第一批，实验后修订）

## 依据

- Work 的“已定的事”：[README](../../README.md)；来源 [w00032 t16](../../../w00032-agent-integration/tasks/t16-command-bridge/README.md) 的决定 2 到 14。本 Task 的决定 1 到 19 见 [Task README](README.md)。
- eval 与全局对象：[`agent/eval.md`](../../../../../docs/specs/agent/eval.md)、[`agent/contributions.md`](../../../../../docs/specs/agent/contributions.md)（输出 24、25）、[`agent/permissions.md`](../../../../../docs/specs/agent/permissions.md)（输出 24、25）；远程服务与订阅：[`runtime/plugin-channel.md`](../../../../../docs/specs/runtime/plugin-channel.md)（输出 7、8）。
- 调研：[宿主操作](../../../w00032-agent-integration/research/2026-10-30-host-control-survey.md)、[浏览器 Agent](../../../w00034-browser-use/research/2026-11-19-browser-agents-survey.md)。
- 审查：第一轮[处理记录](evidences/design-review-disposition.txt)，第二轮[处理记录](evidences/design-review-r2-disposition.txt)。第二批另开 [t02](../t02-ui-actions/README.md)（决定 18）。
- 开工前的实验（2026-11-26，三个子代理，实测为主）：[快照、层与界面目录](evidences/experiments-snapshot-layers-catalog.txt)、[截图、说明框、点击事件与 CSP](evidences/experiments-capture-callout-clicks-csp.txt)、[订阅](evidences/experiments-subscription.txt)。本稿按实验结论改过，文中“（实验）”指这三份。

## 现状里要用到的事实

- 服务端插件按窗口的实例 id 调用浏览器端登记的远程服务（`use(合同).at({client: 实例 id})`），也能向窗口发起订阅（合同 `provider: "client"`、`callers: ["server"]`）；提供方只能推事件，结束订阅由订阅方 `release()`（实验）。
- 内核的两处缺口（实验实测，都与通道 Spec 不符，都是“服务端节点自己作调用方、上游是路由”时漏掉的路径）：服务端插件调 `context.remote.instances()` 得 `target-gone`（输出 8）；窗口断开时，服务端发起的订阅收不到任何结束通知，句柄一直挂着（输出 7）。
- 远程消息单条至多 1 MiB（按 UTF-8 字节、整帧），超了断开整条连接；二进制走插件自己的 HTTP 路由（主题素材的 `PUT` 上传是先例）。
- eval 全局对象：对象与方法属于同一个插件；方法收一个对象参数；`effect` 只有 `read`、`write`、`exec`；嵌套调用有 `shared`、`exclusive` 两种并发档。工具处理函数拿得到会话 id、作品、是否后台运行，拿不到窗口。业务失败交回代码时只剩码与文字。eval 的审批两层（决定 13）。
- 窗口里能读到的界面声明（实验）：命令服务 `list()` 给全部命令（标题、分类、快捷键、`human`、参数 schema），`isEnabled()` 给此刻能不能用，命令面板就是这样筛候选的；设置窗口的数据源 `sections()`、`settings()` 正好是全部分节与设置项，但标为“不是公开接口”；视图有声明，视图此刻在哪里没有任何对外出口。
- 页面上已有的标识（实验，“改主题”逐步实点核过）：标题栏动作 `data-title-action`（命令 id）；活动栏的设置项 `data-activity-item`（打开设置窗口）；视图容器入口 `data-tool-view`（视图 id，例如资源管理器的入口在活动栏上叫“项目”）；设置窗口的层切换是 `data-settings-tabs` 里 `role=radio` 的按钮，`data-value` 为 `user` 或 `project`；节 `data-settings-nav`；行 `data-settings-row`（设置键）。外观一节是 `nbook.appearance`，主题是 `nbook.workbench/theme`，自动保存是 `nbook.editor/autoSave`；`nbook.settings.open({section, layer, focus})` 能直接打开到某层某节。
- 规模（实验）：命令 132 条（人可用 126）、设置 72 项、分节 18 个、视图 8 个、标题动作 9 个；全部压紧成目录约 4,300 token。
- 层（实验）：没有任何弹层写 `aria-modal`。删除确认与命令面板是真模态（遮罩、body `pointer-events: none`、其余部分 `aria-hidden`）；设置窗口不是模态，下面照样能点；右键菜单与下拉不挡指针，点外面会穿过去并关掉它们。弹层都挂在 body 的直接子元素下，角色都可认（dialog、alertdialog、menu、listbox）。
- 标题动作的“悬停才出现”是祖先 `[data-hover-actions]` 的 `opacity: 0`，按钮本身不透明，此时仍可点（实验）。

## 范围

第一批：快照与引用、界面目录、截图、引导；以及“要先补的上游”。

不做：一切会改数据的动作（[t02](../t02-ui-actions/README.md)）；指针与拖动；命令绑定；页面内执行任意脚本；iframe 内部；设置的读写与窗口状态的只读面；安全区与私有投影（决定 10）；可复用的引导脚本（以后另开 Task）；菜单里的命令进目录（决定 19）。

## 结构

```
packages/nb-page-agent/        核心包（纯 TS，不依赖应用、nb-ui 与 Vue）
  src/api/     业务 schema：方法的参数、返回、失败码（TypeBox，没有 DOM）
  src/         页面内引擎：快照、引用、定位、截图、高亮与说明框
  src/attrs.ts nbTarget(name, key?)：只返回 data-nb-* 属性对象的纯函数，独立入口 ./attrs
  e2e/         自带夹具页，Playwright 在真实 Chromium 里跑
packages/neuro-book/src/plugins/page-agent/   内置插件 nbook.page-agent
  shared/      窗口合同 nbook.page-agent/window（provider client，callers ["server"]）
  backend/     全局对象 ui 与方法工具；选窗口；截图的上传路由
  web/         每个窗口里起引擎、实现窗口合同、拼界面目录、给引擎标识映射表
```

- 引擎第一次被调用时才动态加载；只读 DOM，以后 w00034 经 CDP 注入外部网页（实验：严格 CSP 下 shadow root、`adoptedStyleSheets`、`popover` 都可用，`<style>` 元素与 `style` 属性被拦，样式一律走 `adoptedStyleSheets` 或 CSSOM）。界面目录与标识映射表只在插件的 `web/` 里。
- 业务 schema 是唯一来源：从它派生 eval 文档里的签名、远程合同的对象形状输入与读写声明、失败码映射。

## 给模型的接口：全局对象 `ui`

| 方法 | 审批档 | 做什么 |
|---|---|---|
| `ui.snapshot({scope?, includeText?, maxTokens?})` | read | 当前窗口的文字快照 |
| `ui.find({query, kind?, limit?})` | read | 在界面目录里找设置、视图、命令，交回标识与路径 |
| `ui.screenshot({of?, annotate?})` | exec | 截当前窗口或某个控件，图附在结果里 |
| `ui.highlight({…定位, message, title?, side?, until, step?, total?, timeout?})` | read | 高亮一个控件、写说明，等用户点它或点“下一步” |

- 方法都声明 `shared` 并发档：高亮的等待不挡同一段代码里别的 `ui` 调用。
- `ui` 与 eval 一样作主创与临时帮手的可选工具，不进任何 Profile 的 `required`，bot 的 Profile 不带；Profile 页按对象一行开关。后台会话拿不到 `ui`。

### 定位

扁平对象，字段都可选，运行时校验恰好给一种主定位：`ref`；`target` 加可选 `key`（稳定名）；`command`（命令 id）；`role` 加 `name`；`text`（可见文字，最后手段）。另有 `exact`、`nth` 与 `within`（引用或稳定名）。名字与文字缺省不分大小写、折叠空白的子串匹配，`exact: true` 时精确；命中多个又没给 `nth` 时得 `ambiguous`，候选放进失败的 `details`。目标不是可交互元素时，落到它唯一的可交互后代。

稳定名有两个来源：手写的 `data-nb-target` 与 `data-nb-key`；以及插件给引擎的标识映射表，把现有标记翻成稳定名或命令 id，不另起一套：

| 现有标记 | 翻成 |
|---|---|
| `data-title-action` | 命令 id |
| `data-activity-item` | `workbench.activity` 加项 id |
| `data-tool-view` | `workbench.view` 加视图 id |
| `data-settings-tabs` 里 `role=radio` 的 `data-value` | `settings.layer` 加 `user` 或 `project` |
| `data-settings-nav` | `settings.section` 加节 id |
| `data-settings-row` | `settings.row` 加设置键 |

### 引用

形如 `a3.12`：前段是这次页面加载的短前缀，后段是窗口里单调发的号。发号时存下元素的身份（角色、主名、稳定名、key、命令、所在层），每次使用先重算核对；前缀不对或身份变了，按“不在了”处理。只读的方法可在同一层内、稳定名与 key 都相同时重找，结果标 `rebound`；否则得 `stale-ref` 并附当前候选。

### 快照

交回文本树与元素数组：

```
window a3 "NeuroBook" /project/雾港  1440x900  focused
layers: base > dialog "设置"
- dialog "设置"
  - radio "用户" [a3.40 checked target=settings.layer key=user]
  - link "外观" [a3.41 target=settings.section key=nbook.appearance]
  - combobox "主题" [a3.42 target=settings.row key=nbook.workbench/theme value="NeuroBook"]
- region "项目" …
```

- **看得见**：沿祖先链累乘不透明度，并看 `visibility`、`display`、被裁成零面积；不透明度很低的（悬停才出现的动作）标 `faint`，仍可定位。`aria-hidden`、`inert` 的不列。
- **能不能点**：在元素可点区域的中心做命中检查，被盖住时退到四角，给出能点的那一点（第二批的动作就点这一点）；分清“被别的元素盖住”与“滚出了滚动容器”（后者标 `offscreen`，不算被挡）。
- **层**：按角色认层根（dialog、alertdialog、menu、listbox），层与层的先后、底层是否被挡都由命中检查判断，不按角色推断（设置窗口不是模态，下面照样可点）。完全被挡的层只写名字；页面禁了指针时结果点名说明。
- **列表**：列表类容器写一行摘要（总数、已渲染范围、可滚动），行上带位置；滚出视口、多渲染的行由命中检查排除。
- **名字**：内容命名的角色（树行、标签、菜单项）另算主名，跳过状态标记；快照写主名。
- **预算**按估算 token，缺省 3000、至多 8000（实验：常见状态 900 到 2000，设置窗口打开时约 2000），超了按“最上层 > 焦点所在区域 > 其余”截断，并写明能用 `scope`（引用或稳定名）缩小到哪些区域。
- **转义**：名字与值按 JSON 字符串转义（含换行、控制字符、双向控制字符），先截断再转义。
- **不列**：Agent 自己的对话视图（`data-nb-agent="skip"`；实验：空会话就占快照的 9% 到 21%）、引擎自己的节点。密码框的值不输出。
- **大小**：窗口回复前量 UTF-8 字节：文字至多 64 KB、元素至多 500 个、`details` 至多 8 KB，超了截断并标记。耗时预算：工作台快照 50 毫秒以内（实验 12 到 26 毫秒）。

### 界面目录

`ui.find({query, kind?})` 在窗口里现拼目录，搜索复用命令面板的跨语言子序列打分，交回至多 `limit` 条（缺省 5）；同名的不同种类（例如“主题”既是设置项又是一页）分开列，`kind` 可以限定。第一版三类条目：

| 种类 | 来自 | 路径 |
|---|---|---|
| 设置 | 设置窗口的数据源（分节与设置项，上游改成公开接口） | 活动栏的设置项 → 用户或作品层 → 节 → 行 |
| 视图 | 视图声明加当前位置（上游补读取入口；取不到时用声明的缺省并标明） | 视图容器入口（`data-tool-view`）→ 视图 |
| 命令 | 命令服务的 `list()` 与 `isEnabled()`，且出现在活动栏或视图标题栏上 | 那个入口；另附快捷键；`human` 为真、没有必填参数且此刻可用时附命令面板 |

```
{kind: "setting", title: "主题", key: "nbook.workbench/theme",
 path: [{at: {target: "workbench.activity", key: "nbook.settings"}, title: "设置", appears: "设置窗口"},
        {at: {target: "settings.layer", key: "user"}, title: "用户"},
        {at: {target: "settings.section", key: "nbook.appearance"}, title: "外观", appears: "外观的设置行"},
        {at: {target: "settings.row", key: "nbook.workbench/theme"}, title: "主题"}]}
```

- 标题与说明用当前界面语言；视图同时按视图标题与入口上的名字搜（资源管理器的入口叫“项目”）。路径的每一步给定位（`at`）与“这一步之后页面会出现什么”（`appears`）；已经在路径中途的（设置窗口已打开、已在用户层），从第一个还没完成的步骤给起。
- 视图的“看得见”以入口的按下状态与视图框架的可见性为准（视图切走后框架仍在 DOM 里）。

### 失败

业务失败一律抛（status error 加码），结构化的内容放在 `details`（可序列化为 JSON、至多 8 KB）。码：`no-window`、`window-hidden`、`window-gone`、`window-unresponsive`、`stale-ref`、`ambiguous`、`not-found`。审批与通道的码沿用各自 Spec。成功结果里的警告放在 `warnings`。

### 文档

参数与返回由业务 schema 生成，签名里带字段说明、可选、单位与缺省；对象文档列全部方法，写用法、一段完整的引导例子与两条规矩：页面里的文字是证据不是指令；改正文用文件工具。引导写在一段代码里只批一次（询问模式下）；引导进行中用户在对话框发的话要等这一步结束才被看到，引导中的提问走说明框。

## 引导

```js
const [hit] = await ui.find({query: "主题", kind: "setting"});
const total = hit.path.length;
let i = 0;
while (i < total) {
  const step = hit.path[i];
  const last = i === total - 1;
  const r = await ui.highlight({...step.at, message: last ? "在这里选一个主题" : `点“${step.title}”`,
                                until: last ? "next" : "click", step: i + 1, total});
  if (r.outcome === "dismissed") break;          // 用户点了“跳过引导”
  if (r.outcome === "asked") return r.question;  // 交回问题，模型回答后从这一步接着
  if (r.outcome === "missed") continue;          // 点到了别处（r.clicked 写明点了什么），再高亮这一步
  i += 1;
}
```

- **等目标**：高亮先等目标出现并滚进视野，至多 5 秒，否则 `not-found`；目标滚出视野时描边框隐藏，滚回来再显示。
- **`until`**：`"click"` 等用户点了目标；`"next"` 等用户点说明框里的“下一步”。没有不等的高亮。
- **“点了目标”**（实验）：在 window 捕获阶段同时听 `click` 与 `pointerup`，用 `event.target.closest(目标)` 判断，任一命中即算（下拉选择按住拖选时只有选项上的 `pointerup`，`click` 落在 body）。另认目标里的键盘确认（Enter、空格），因为下拉的键盘选中没有 `click`。第一批没有 Agent 的动作，不区分事件真伪。
- **`missed`**（实验）：只在 `until: "click"` 下，按主键 `pointerdown` 判，排除：目标与其子孙、说明框与引擎自己的节点、系统滚动条（`target` 是滚动容器且按在滚动条区域）、模态遮罩、右键。第一次点错就以 `missed` 结束，带上点到的元素的角色与名字。
- **结局**：`clicked`、`next`、`asked`（带 `question`）、`missed`（带 `clicked`）、`dismissed`（跳过引导）、`gone`（目标消失）、`replaced`（同一窗口有新的高亮）、`timeout`、`window-gone`（窗口断开或刷新）、`cancelled`（eval 停止或单元超时）。调用结束时高亮一定撤掉。
- **说明框**：自写（决定 11）。跟随目标的描边框加说明框；说明框里有标题与说明、进度、“下一步”（`until: "next"`）、“跳过引导”与一个小的“提问”输入。说明只作纯文本。不压暗页面、不改页面元素的样式。
- **挂在哪里**（实验）：说明框是一个 `popover="manual"` 的元素，挂进当前最上层弹层的 DOM 子树里。挂在 body 下时，一按说明框，命令面板与下拉菜单就关，带焦点圈定的面板会把“提问”的输入抢回去；挂进弹层子树后两者都正常。`popover` 进顶层，不被小弹层的 `overflow: hidden` 裁掉，也不受弹层入场缩放的坐标影响（实验 2 里不进顶层时最大偏差约 27 像素）；没有弹层时挂在 body 下。
- **不抢焦点**：说明框出现本身不改焦点与选区；“下一步”“跳过”在 `pointerdown`、`mousedown` 上取消默认，点了也不抢焦点；用户点进“提问”输入框打字后，说明框撤掉时把焦点还给原来的元素。
- **跟随**：`ResizeObserver`、捕获阶段的滚动、DOM 变化触发重算；有动画在跑时（`getAnimations`）逐帧重算到没有运行中的动画为止（实验：只靠事件在入场动效里最多滞后约 25 像素；逐帧重算偏差 0）。
- **悬停才出现的目标**：工作台的悬停样式加一个“Agent 指着这里时也显示”的属性，高亮期间加到目标所在的 `[data-hover-actions]` 上；不聚焦目标。
- 同一窗口同时一个高亮，新的替换旧的（旧的得 `replaced`）。层级登记进 nb-ui 层级表的例外；减弱动效时没有过渡。说明框的外观先出静态稿。

**等待的机制**：高亮是服务端向窗口的一次订阅。订阅开始时窗口装上高亮，用户动作或到时后推一条结局，服务端收到即 `release()`；服务端 `release()`（eval 停止、单元超时）时窗口撤掉高亮。窗口断开或刷新时，订阅以 `target-gone` 结束（要先补内核的缺口，见“要先补的上游”），结局是 `window-gone`；短暂断线同样结束这一步，不做重连后重建，模型重新高亮这一步即可。`timeout` 缺省 300 秒、至多 3600 秒。nb-harness 给嵌套调用一个“正在等用户”的标记，从窗口确认装上开始、结算即收回，随调用取消自动收回；连接、装载、查找与清理照常计时。eval 按整个单元暂停计时，等待期间并发跑的别的代码也不计时，上限是高亮自己的 `timeout`，接受这一取舍。

## 目标窗口

每次 `ui` 调用按下表选窗口，取第一个：

| 次序 | 条件 |
|---|---|
| 1 | 这个会话上次用的窗口：还连着、看得见、2 分钟内用过 |
| 2 | 有焦点的窗口 |
| 3 | 看得见、最近有真实输入的窗口 |

- 候选是提供了窗口合同的客户端实例；第 2、3 档并发问 `info()`（有没有焦点、看不看得见、最近一次真实输入的时刻），每个 800 毫秒超时；第 1 档只问那一个窗口。用户切到另一个窗口时，只要上次那个还看得见、2 分钟内用过就不跟过去（决定 3）；它转后台就按第 2、3 档重选。
- “上次用的窗口”记在插件后端一张以会话 id 为键的小表里（有条数上限，最久没用的先丢）；子会话按同一规则自己选，不继承。
- 都不满足得 `no-window`；目录查询本身失败得 `window-unresponsive`，不当成“没有窗口”。后台会话拿不到 `ui`。
- 窗口调用的时限：快照与目录 3 秒，截图 15 秒，到时得 `window-unresponsive`。
- 同一窗口两个会话同时引导时，后一个替换前一个；第一批没有会改数据的动作，不做租约。

| 情形 | 上次用的窗口 | 引用 | 高亮 |
|---|---|---|---|
| 断线（同一实例之后重连） | 重连后仍可用 | 仍有效 | 订阅以 `target-gone` 结束，`window-gone` |
| 窗口刷新（新实例） | 重选 | 前缀不符，`stale-ref` | 同上 |
| 窗口转后台 | 重选 | 仍属于那个窗口 | 高亮期间转后台不结束，等用户回来 |
| 服务端重启 | 表清空 | 窗口重连后前缀不变的仍有效 | 服务端那边随进程结束；窗口那边订阅被取消，高亮撤掉 |

窗口合同的每个方法声明 read，输出 schema 写字节、长度与条数上限。信任边界是现有拓扑的“本机插件都受信、只有一个使用主体”。

## 截图

- **审批**：`exec` 档，判定对象 `{kind: "screen", value: of === undefined ? "window" : "element"}`。在 eval 里调用时是第二层的一次询问，可选“本会话都允许”“以后都允许”（后者对之后所有会话的截图生效）。批准的含义是“截你正在用的那个窗口”，结果写明截的是哪个窗口。
- **重画**：用 snapdom（实验：1440×900 一张 0.3 到 0.6 秒，首次 1.4 到 2.7 秒；版面、弹层、背景模糊都对；自绘滚动条变成系统滚动条、悬停态丢失、小字抗锯齿差一两像素）。缩到长边至多 1280 像素，编码成 WebP（实验约 50 KB），浏览器不支持时用 JPEG 质量 0.8（约 85 KB），至多 512 KB。
- **传输与提交点**：服务端先签一次性上传凭证（绑定这次调用与窗口），再调窗口的 `capture`（15 秒）；窗口重画、编码、经插件的 `PUT` 路由上传，上传完成后 `capture` 才返回。服务端以“凭证对应的上传已收到且 `capture` 成功”为提交点，二者缺一则作废并失败；只有提交后的图进工具结果。路由检查来源、类型、尺寸与字节。
- **保存**：截图存进会话日志，是会话的持久数据：归档不删，fork 会复制；删除等会话删除的合同。
- DOM 重画是近似，不是屏幕像素；以后桌面外壳给真实截图时换实现，接口不变。`annotate: true` 时在图上叠引用编号。

## 控件的名字

不做 `v-nb-target` 指令（决定 14）：

| 层 | 谁写 | 写什么 |
|---|---|---|
| 自动 | 渲染方，已有的标记直接用 | 见“定位”里的映射表 |
| 手写 | 插件作者，只给自动层覆盖不到的控件 | `data-nb-target` 与可选 `data-nb-key`，可用 `v-bind="nbTarget('explorer.row', file.address)"` |

- 稳定名是点分的小写段，第一段是所属插件或区域；列表项的 key 用业务身份，不用下标。唯一性只要求在最近的带 key 的容器里。
- 开发构建里由引擎扫描 DOM 检查重复与不合规的名字，每个名字警告一次，重复数变化时再警告。
- 引导优先引用命令 id 与设置键；被引用的手写稳定名列进 Spec 的名字表，治理测试防悄悄改名。

## 技术选型

| 问题 | 选用 | 理由 | 否决 |
|---|---|---|---|
| 角色与可访问名 | `dom-accessibility-api`（MIT）算名字；交互角色自维护小表 | 名字规则容易写错，用久经考验的库 | 照抄 Playwright 的 `roleUtils` |
| 高亮与说明框 | 自写，说明框用 `@floating-ui/dom`（MIT）定位，`popover="manual"` 进顶层 | 实验 2 的挂法与跟随都按自写的样机验过 | driver.js（决定 11） |
| 截图 | snapdom（MIT） | 实验 1：快、保真、弹层正常 | modern-screenshot（慢 10 倍以上）；html-to-image（更慢，弹层整块缺失）；html2canvas；屏幕共享 |
| 界面目录的搜索 | 复用命令面板的跨语言子序列打分 | 与用户在命令面板里搜到的一致 | 另写分词匹配 |
| 等用户 | 远程服务的订阅（补上内核的缺口） | 取消即撤高亮，断开有确定的结局 | 另开回报合同加等待 id |
| 截图传输 | 插件的 `PUT` 路由加一次性凭证 | 通道 Spec 的做法 | 截图塞进远程结果 |

## 要先补的上游

| 模块 | 改什么 |
|---|---|
| nb-runtime | 服务端插件的 `instances()` 由路由本地回答（通道 Spec 输出 8）；服务端发起的订阅在目标成员的链路关闭时以 `target-gone` 结束，与经路由转发的订阅一致（输出 7）；两处各补用例（实验 7 的复现脚本可作起点） |
| nb-harness | 嵌套调用的“正在等用户”标记；工具的“只给有用户在看的会话”标记 |
| `nbook.agent` | 失败时 `ToolCallError` 带 `details`；eval 文档签名打印字段说明、可选与缺省；工具绑定支持按 eval 对象开关（存对象，之后新增的方法跟随），Profile 页显示成一行；对话视图标 `data-nb-agent="skip"` |
| 工作台 | 视图当前位置的读取入口；悬停样式加“Agent 指着这里时也显示”的属性 |
| 设置 | 设置窗口的数据源（全部分节与设置项）改成公开的读取接口 |

## 实验之后还没验证的

- 暗色主题下的说明框与截图（实验时不能改主题设置）。
- 悬停才出现的目标加上“Agent 指着这里时也显示”的属性后的样子（要先有那条上游改动）。
- 有对话内容时对话视图占快照的比例（样例作品里没法产生真实对话；它反正不列）。
- 订阅在真实 Chrome 里刷新与关标签页时的表现（实验用的是进程内链路与真实 WebSocket，不是浏览器）。

这几项在实施的对应切片里补测。

## 测试

- 逻辑单测（bun）：定位校验、引用身份与前缀、转义、字节上限、稳定名规则、失败码与 `details`、业务 schema 派生的文档与远程合同、界面目录的拼装与搜索。
- 核心包的真实浏览器测试（Playwright，自带夹具页）：原生与 ARIA 控件、shadow root、遮挡层、嵌套滚动；以 index 为 key 的列表反序后旧引用得 `stale-ref`；名字里有引号、换行、双向控制字符时行数不变；说明文字里的标签原样显示；“点了目标”认 `click` 与 `pointerup`、点到别处按排除条件得 `missed`；说明框不抢焦点，“提问”得 `asked`；说明框挂进弹层后点它不关弹层。
- 真实组件场景：应用里一个 Lab 场景（设置窗口、命令面板、右键菜单、下拉、确认框、虚拟树、悬停动作、拆组编辑器），核心与应用的测试共用；无障碍对照用 CDP 的 `Accessibility.getFullAXTree`；另开一份不减弱动效的配置。
- 内核：`instances()` 与订阅在成员断开时的结束，用真实路由与链路测（实验 7 的情形）。
- 订阅的收口（真实服务端与窗口）：eval 停止、单元超时、断线、刷新、服务端重启时，结局各对一次、高亮都撤掉，“正在等用户”标记随之收回。
- 应用 e2e：脚本化模型写 eval 代码，`find` 找到主题的路径并逐步高亮，用 Playwright 真实点击推进，断言每一步高亮的是对的控件，最后一步“下一步”结束；三个窗口里用真实输入的时刻区分谁被选中；刷新后旧引用 `stale-ref`；询问模式下先批 eval 再见截图的审批卡；截图超大视口不断线、超过字节上限的快照被截断而不是断线。
- 变异检查：引用前缀、身份核对、跨层重找、转义、字节上限、忽略自己的节点、`missed` 的排除、不抢焦点、说明框挂进弹层、订阅取消时撤高亮。
- 性能：快照 50 毫秒、界面目录与截图的耗时预算，含大文档与上千节点。
- 真实模型冒烟（`*.llm.test.ts`）：“在哪改主题，带我去”走一遍，记请求数与输入 token。

## 风险

- **界面目录跟着界面变**：路径依赖活动栏、设置窗口与视图入口的真实标记，标记改名会让目录指错；映射表与“改主题”“打开资源管理器”的路径进 e2e。
- **说明框与弹层**：挂进弹层子树依赖弹层的 DOM 结构；弹层实现换了要重测。
- **token**：只列可交互元素、按 token 的预算、列表摘要；冒烟时盯请求数。
- **没有安全边界**（决定 10）：Agent 能读到窗口里的密钥（密码框除外）。第二批开工前，把它能点到审批卡、模式开关一事再交开发者确认。
- **上游改动多**：第一批的工作量主要在“要先补的上游”，每项单独提交、单独测试。
