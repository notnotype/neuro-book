---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: harness.extensions
owners:
  - nb-harness
---

# Harness 扩展：定义、装配、状态与反应

## 目标与非目标

给插件作者与 Profile 作者一套扩展接口：扩展只做四件事，归约（事件 → 自己的状态）、反应（事件写入之后补记事件）、视图（状态 → 请求的片段）、拦截（输入、模型调用、工具、压缩之前或之后改或挡），外加装上外部事实的 `mount`。Profile 是拦截链最里层、地位最高的扩展；对话记录本身也是内置扩展。扩展的状态全部由会话日志归约而来，所以回退、fork、重启、压缩之后自动正确。

插件撤回与重新装配（输出 26、27）随宿主面补齐。日志与会话目录见 [`harness/session.md`](session.md)；视图（模板、`turn`、`commit`、槽）、拦截链与运行控制在 harness 的 Profile 与运行时 Spec（待建）。

不承诺：

- 多进程扩展：扩展在打开会话的进程内运行。
- 安全隔离：扩展是受信任代码（ADR 0022），请求可被任意修改，靠修改记录追查。
- 流式增量不给扩展看。
- 拦截的粗粒度层（`layer`）与处理函数推给界面的进度（`ctx.status`）：以后再加。

## 术语与参与者

- **扩展**：`defineExtension` 或 `implement(契约, …)` 返回的对象；被所有会话共享，闭包里不放会话状态。
- **契约**：`defineContract` 返回的对象：别人能监听的事件与能读的导出。
- **片**：扩展记住的一份数据，`slice.path` 跟着对话路径走，`slice.session` 在树外。
- **装配**：打开会话或换 Profile 时，把 Profile、它的扩展与插件贡献的扩展排成顺序并检查。
- **装配序**：依赖在前、同一层按 id 排的顺序；决定反应写入、槽拼接、`mount` 的顺序。
- **拦截序**：装配序之后接 Profile 的 `extensions`、Profile 自己、审批。
- **处理函数**：`on` 里按事件名挂的函数。

## 输入与前置条件

公开入口 `@notnotype/nb-harness/kernel/contracts`：`defineExtension`、`implement`、`defineContract`、`optional`、`shape`、`slice`、`conv`、`ext`、`defineProfile`；helper（`reminder`、`opening`、`standardLayout`、`finalOnly`、`withoutEvents`、`deriveProfile`）随实现加入。各入口的类型以该入口导出的定稿类型为准。

| 字段 | 回答的问题 |
|---|---|
| `id`、`version`、`tags`、`dependsOn` | 我是谁、Profile 怎样成批排除我、我依赖谁 |
| `settings` | 用户能配什么（TypeBox schema，每项带 `default`） |
| `state`、`events`、`reduce` | 我记什么、我写哪几种事件、看到一条事件我记的东西变成什么 |
| `on`、`mount` | 发生某件事之后我补记什么；外部世界怎样进来 |
| `exports`、`contribute`、`render` | 别人能问我什么；这一刻我给模型看什么；我的对话事件给模型看是什么文字 |
| `intercept`、`onFailure`、`timeoutMs` | 某个动作之前或之后要不要改、挡；出错与超时 |

id 的规则：

| 谁 | id |
|---|---|
| 插件贡献的扩展 | 所属插件的 id，或“所属插件 id.名字”；宿主随扩展传入所属插件，内核校验前缀 |
| Profile | Profile 的 key `<来源>.<名字>`（`builtin.writer`、`story.qa`、`user.x`） |
| 内核与测试 | 不属于插件的扩展（所属插件为 null） |

一个会话里全部扩展与 Profile 的 id 互不重复。日志里扩展事件的类型名与 `source` 都用这个 id。

## 输出与可观察行为

定义与装配：

1. 装配时检查并拒绝：id 不合规则或前缀与所属插件不符、id 重复（含 Profile）、同一个扩展装两次、依赖缺失、依赖成环。拒绝时给出全部问题，每条带来源、英文 `message` 与 `hint`。
2. 装配时检查并写诊断，会话照常打开：设置缺 `default`（`setting-missing-default`）；`on`、`reduce`、`render` 的键不是这个扩展看得到的事件（`unknown-event-handler`，`hint` 给出编辑距离最近的名字；看得到的是内核事件、自己的事件、`dependsOn` 里每个依赖（含 `optional` 的）的事件；扩展的 `render` 只认自己的事件）；`contribute` 的槽名不是小写字母、数字与连字符（`bad-slot-name`）；`reminder()` 既没有 `every` 也没有 `watch`（`reminder-without-trigger`）。
3. 装配序：依赖在前，同一层按 id 排；拦截序是装配序之后接 Profile 的 `extensions`、Profile 自己、审批。最终顺序与装配清单记进 `profileChanged`。
4. 扩展只能写以自己 id 开头的事件，只能声明 `conv` 与 `ext` 两种，不许与内核事件同名。

状态与归约：

5. `reduce` 按事件名给出同作用域片的补丁：path 事件的归约只拿到、只能改 path 的片，session 事件同理。返回 undefined 表示不变。
6. 归约只看自己的片，各扩展的归约互不依赖，谁先谁后结果一样。
7. 归约出错：这次补丁不用，叶子照样前进，写诊断 `reduce-threw`；重放得到同样的结果。
8. 状态递归只读；开发模式下冻结，改它抛错。
9. `resetOnCompaction` 的片在压缩事件上回到初值。
10. 回退与切分支之后，path 片的值等于新叶子上的值；session 片不受影响。

反应：

11. 处理函数在事件写入并归约之后调用；打开会话归约时不调用。
12. 处理函数里读到的 `ctx.state` 是这条事件刚写下之后的值，不含自己这次 `set` 的；同一批里后面的事件，它的处理函数读到的也是那条事件刚写下时的值，不含同一批前面事件引出的反应。
13. `emit(名字, 数据?, {key?})` 与 `set(片, 值)` 先收集，处理函数完成时作为一个写入批写入；抛错、超时就都不写，写 `extensionFailed`（`code` 为 `threw`、`timeout`，带丢弃的条数）；`emit` 没声明的事件、`set` 没声明的片、值不能被 JSON 如实表示时同样整批丢弃（`invalid-output`）；完成之后再调用得诊断 `emit-after-settle`、不写；同一片 `set` 多次取最后一次；与当时的值相同不写；带幂等键的 `emit` 同一来源同一个键已写过时不写，也不引出反应。
14. 同一条事件的各个处理函数看同一份状态、可以并发执行，输出按装配序写入；全部完成之后才算下一次请求。
15. 反应链从根事件起最多写到第 3 层；超出时写 `reactionLimit`，超出的输出丢弃。
16. 处理函数有时限（缺省 30 秒，`timeoutMs` 可改）：超时中止它的 `ctx.signal`、丢弃输出、写 `extensionFailed{code: "timeout"}`。时限走注入的时钟。
17. `continue(text, {max})` 只在 `assistant` 的处理函数里有：写一条 `continued` 并再请求一次；这一轮这个扩展超过 `max`（缺省 3）次时返回 false、不写。
18. 由运行写入引出的反应，`ctx.signal` 同时挂在运行的中止上：中止时不再等它们，输出丢弃并写 `extensionFailed{code: "aborted"}`。

装上：

19. `mount` 在会话打开、换 Profile 之后新装上时调用；全部 `mount` 完成之后才受理指令。返回的清理函数在摘下或关闭会话时调用并等待，`ctx.signal` 同时触发。
20. `mount` 里写的事件排进单写者队列：空闲时立刻写入，运行中到下一个边界写入。
21. `mount` 超时（缺省 30 秒）或抛错：写 `extensionFailed{entry: "mount"}`，这个扩展标为失败、不再派发给它，会话照常打开。
22. `ctx.callback(fn)` 包住外部回调：出错带扩展 id 写诊断，不成为没人接的 Promise 拒绝；摘下之后不再调用。

上下文与读取：

23. 各入口读到的状态：`reduce` 读这条事件之前；`on` 读这条事件写入之后；视图与模型拦截读这次请求所在的叶子；工具拦截读发出这批调用的回复所在的叶子；输入拦截读受理这条指令时的叶子。
24. `read` 只放 `dependsOn` 里写了的依赖与内置的 `core.history`；`optional` 的依赖没装时返回 undefined。
25. 设置按扩展分开，`settingsChanged` 只派发给设置所属的扩展；插件设置有全局缺省，用户可以按 Profile 覆盖。

插件装卸：

26. 插件撤回时，运行中的会话这次运行里调它的入口得诊断 `extension-revoked` 并跳过，归约照常；空闲时自动重新装配并写 `profileChanged{reason: "plugin-removed"}`。新装的插件同理（`plugin-added`）。
27. 重新装配失败（例如依赖缺失）时会话进只读，快照报 `dependency-missing`。

版本：

28. Profile 哈希由 Profile 的 id 与 `version`、装配序里每个扩展的 id、`version` 与所属插件算出；内核不对源码算哈希。扩展或 Profile 改了提示词、归约或渲染，要升自己的 `version`，否则打开旧会话时不会写 `profileChanged{code-updated}`、已提交的轮不会按新代码重新渲染。

helper：

29. `reminder({every?, watch?, text})`：在每轮开头（`turnStarted`）判断：第一次、`watch` 的值变了、或距上次提醒满 `every` 轮时调用 `text`，返回文字就写一条自己的对话事件 `reminder`；返回 null 不写，但记下这次的值。记录在它自己的 path 片里，压缩时清空（压缩后再提醒一次），回退时跟着回去。
30. `opening({load})`：会话创建时与每次压缩之后调用 `load`，丢掉空的部分，存进自己的 path 片，交给共用的稳定槽 `opening`（各部分之间空一行）。

## 状态与转换

| 扩展在会话里的状态 | 事件 | 下一状态 |
|---|---|---|
| 未装上 | 会话打开或重新装配，`mount` 成功 | 生效 |
| 未装上 | `mount` 超时或抛错 | 失败 |
| 生效 | 插件撤回（运行中） | 已撤回（这次运行跳过它） |
| 已撤回 | 会话空闲 | 摘下，重新装配 |

时序与寿命：第 19–22 条；扩展对象被所有会话共享，会话状态只在片里。

## 副作用与数据

- 扩展的状态只来自日志；没有另存的状态文件。
- 改变了结果的失败（输出被丢弃、拦截被跳过、工具被缺省拒绝）写 `extensionFailed` 进日志；其余只写诊断。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `dependency-missing` | 依赖的扩展没装 | 装上依赖，或在 Profile 里排除用到它的扩展 |
| `dependency-cycle` | 依赖成环 | 改依赖 |
| `duplicate-extension-id` | id 重复（含 Profile） | 改 id |
| `bad-extension-id` | id 不合规则或前缀与所属插件不符 | 改 id |

诊断码的完整表在 `@notnotype/nb-harness/kernel/contracts` 导出的 `diagnosticCodes`。

## 边界与兼容

- 公开接口：`/kernel/contracts` 导出的构造函数与类型；扩展事件的类型名与版本进日志，是长期合同。
- 扩展事件的版本：只归约声明过的版本，更高版本的事件按 [`harness/session.md`](session.md) 输出 14 处理。

## 验收与 Smoke

1. 同一组扩展经回退、切分支、重启（从日志重新打开）与压缩之后，各片的值与从头归约的结果一致。
2. 一个处理函数抛错、一个超时、一个在完成后才调用 `emit`：前两个的输出整批丢弃并写 `extensionFailed`，第三个得 `emit-after-settle`，其余扩展的输出照常写入。
3. 运行中撤回一个插件：这次运行跳过它的入口，运行结束后自动重新装配并写 `profileChanged{reason: "plugin-removed"}`。

Smoke：不适用——扩展行为由内核测试与 nb-story 验收测试覆盖，没有独立的入口。

## 证据

- 批准依据：[提案：Agent harness 的事件模型](../../proposals/agent-harness-event-model.md)（2026-10-31 接受）、[ADR 0035](../../adr/0035-harness-log-driven-kernel.md)
