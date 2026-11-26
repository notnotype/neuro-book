# 拖动会话：createDragSession 与 useDragSession

一组东西可以拖来拖去（列表行、标签、卡片）时，会话管“按下、过了门槛起拖、移动时判定落点、放下提交、取消”这一整场；落点长什么样、提交做什么由宿主给。

```ts
const {state} = useDragSession(rootEl, (root) => ({
    sourceAt: (target) => target.closest<HTMLElement>("[data-row]")?.dataset.row ?? null, // 按下处的来源；null 不起拖
    resolve: ({top}) => (top === null ? null : rowAt(top)),   // 这一刻的落点；不改布局，可能被调多次（rowAt、move 是宿主自己的函数）
    actionKey: (drop) => drop.key,                            // 落点要做的动作的比较键；只显示不提交的为 null
    commit: (drop, source) => move(source, drop),             // 放下，且与最后显示过的动作相同
}));
```

## 选项

| 选项 | 是什么 |
|---|---|
| `sourceAt(target)` | 按下处的来源。要自己排除可交互的元素（按钮、输入框），不然点按钮也会起拖 |
| `activate?(source, keyboard, at)` | 过了门槛时调：宿主冻结它要的东西；返回 `false` 不起拖 |
| `resolve(query)` | 同步判定这一刻的落点。放下时、自动滚动时也会调，不能假定一次移动只调一次。不改布局、不提交；可以记下这一场的判定、在读完 DOM 之后写跟手的反馈 |
| `actionKey(drop)` | 落点动作的比较键；放下时与最后显示过的相同才提交（`commitsUnderPointer` 为真时例外） |
| `commit(drop, source, keyboard)` | 提交 |
| `commitsUnderPointer?(keyboard)` | 为真时放下提交此刻判定的落点，不要求与最后显示过的相同。别的东西跟着指针即时让位（实时布局、`useSortable`）时用：显示的总比指针慢一拍。缺省假 |
| `onActiveChange?(active)` | 一场开始与结束：宿主在这里写光标、禁选这类标记 |
| `sampled?()` | 有新的指针样本：会话自己的 `pointermove` 处理一开头同步调，早于它排发布的帧。宿主自己按需排帧的循环在这里叫醒，帧就排在发布的前面 |
| `onEnd?(end, last)` | 一场结束时调：`committed`（提交了）、`no-action`（放下了但没有要做的动作）、`cancelled`（带原因：Escape、失焦、根没了等） |
| `structure?()` | 此刻的结构键；一场里它变了整场取消 |
| `scroll?` | `"reevaluate"`（缺省）滚动时重新判定；`"withdraw"` 滚动时撤下落点，直到指针再动 |
| `autoScroll?` | `{containers({point, top}), edgePx?, maxStepPx?}`：指针靠近容器的边时自动滚动，见下面的“边缘滚动”；缺省不滚 |
| `keyboard?` | 键盘拖动；缺省只有指针。要给 `sourceAt`（焦点处的来源）、`regions`（Tab 依次走过的区域）、`stops`（区域里方向键停的点）、`start`（拿起时在哪个区域、哪一点）、`refocus`（结束后焦点还给谁） |
| `config?` | 起拖门槛等 |

自己画的拖动反馈（拖影、插入线）要带 `data-drag-feedback`：会话判定落点时跳过它们，不然它们会挡住指针下的目标。设了 `pointer-events: none` 的元素本来就不在浏览器的命中里，挡不住落点；`data-drag-feedback` 给要接指针、或设不了 `pointer-events: none` 的反馈。菜单、对话框挡在落点上时，落点不接收。

`state` 是此刻的状态（来源、落点、动作），没有拖动时是 `null`；宿主据此画反馈。

## 时序与先后

**起拖门槛**：鼠标与笔按下后移动 6px 才起拖；触摸要按住 200ms、期间移动不超过 6px。缺省值是 `DRAG_GESTURE_DEFAULTS`，经 `config` 改。e2e 里按下之后要先移过门槛，`activate` 与 `resolve` 才会被调。

**边缘滚动**：没在滚时指针每次移动、在滚时每帧开头，会话调一次 `containers`，按交回的先后（从里到外）给横竖两个轴各挑一个容器：这个轴让滚（计算样式的 `overflow-x`、`overflow-y` 是 `auto` 或 `scroll`）、这个方向还没到头、指针离这一端不到 `edgePx`（缺省 24）或已越过它。两个轴都挑中时一起滚。越过一端也算，所以几条并排的标签条只交指针下的那条：`containers: ({top}) => { const strip = top?.closest<HTMLElement>("[data-tab-strip]"); return strip == null ? [] : [strip]; }`；固定的列表交 `() => [list]`，指针拖出列表上下边时照样滚，而且最快。每帧先按上一帧滚动后的内容判定、再滚，滚动中松手等下一帧再放下。

**起拖时网格还在过渡**：会话的判定量的是此刻的矩形。网格的布局过渡还在走时起拖，量到的是过渡中间的位置，宿主要在 `activate` 里调网格的 `settleMotion()`，让过渡直接到终点。`createLiveDragSession` 自己会调。开发检查（`setLayoutDevChecks`）只在宿主把 `dragging` 交给 `NestedGrid` 时查得到漏调。

**收场的先后**：

1. 拆掉这一场的监听，释放根上的指针捕获；
2. `state` 置为 `null`；
3. `onActiveChange(false)`；
4. `onEnd(end, last)`；
5. 放下且有要做的动作时 `commit`：它在 `onEnd` 之后；
6. 键盘拖动还焦点：提交了的在下一帧还（提交引起的重渲染已经完成），取消的当场还；焦点已经离开或会话被销毁时不还。

**`actionKey` 为 null 的落点**：放下时这一场以 `no-action` 结束，不调 `commit`。宿主在拖动中做的跟手副作用（例如用 `placeFloat` 挪窗）要在 `onActiveChange(false)` 或 `onEnd` 里自己撤，否则窗停在拖到的地方。整窗移动怎么接这几步见 [`NestedGrid` 的“整窗移动的做法”](NestedGrid.md#整窗移动的做法)。要在这种落点上照样提交，就交回非 null 的键，或者让 `commitsUnderPointer` 为真。

**click**：指针拖动时根持有指针捕获，松手后浏览器把这次 click 发给根，不发给按下时的按钮。会话还在根的捕获阶段吞掉这次手势末尾的 click（`detail` 不为 0 的；键盘触发的 click 不吞）。两层各自都能让按钮收不到 click，所以测试只能断言“按钮的动作没发生”；只去掉其中一层，按钮照样收不到，这是预期。

## useDragSession：组件里的会话

`useDragSession(root, createOptions)` 在有根时建会话：

- 调用时根已有值就立即建；模板 ref 的根在组件挂载之后的那次刷新里建，挂载回调里还是 `null`。
- 根换了，先销毁旧的再建新的；根没了或所在的作用域结束时销毁。换根与销毁时进行中的那一场以“销毁”收尾（`onEnd` 收到 `cancelled`、`disposed`）。
- `createOptions(root)` 每在一个根上建会话时调一次，建好后不再读：选项里读到的响应式值之后变了，会话不重建。要换选项就换根。
- `createOptions` 抛错时这个根上没有会话，错误交给应用的错误处理。

交回 `{session, state}`，没有根时两者都是 `null`。

## createDragSession：不在组件里

`createDragSession({root, ...选项})` 直接建一场会话，用完调 `dispose()`。会话还有：

- `invalidate()`：内容变了而指针没动时，撤下落点直到指针再动；
- `flush()`：宿主这一帧要写 DOM 时先调，让判定（读）在写之前；
- `abort()`：宿主那边已经结束了这场，收场，不调 `onEnd`。
