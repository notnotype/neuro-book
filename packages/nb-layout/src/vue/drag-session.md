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
| `sampled?()` | 有新的指针样本：会话自己的 `pointermove` 处理一开头同步调，早于它排发布的帧。按需排帧的循环（`createFrameLoop`）在这里叫醒，帧就排在发布的前面 |
| `onEnd?(end, last)` | 一场结束时调：`committed`（提交了）、`no-action`（放下了但没有要做的动作）、`cancelled`（带原因：Escape、失焦、根没了等） |
| `structure?()` | 此刻的结构键；一场里它变了整场取消 |
| `scroll?` | `"reevaluate"`（缺省）滚动时重新判定；`"withdraw"` 滚动时撤下落点，直到指针再动 |
| `autoScroll?` | `{element, edgePx?, maxStepPx?}`：指针靠近这个元素的边时自动滚动；缺省不滚 |
| `keyboard?` | 键盘拖动；缺省只有指针。要给 `sourceAt`（焦点处的来源）、`regions`（Tab 依次走过的区域）、`stops`（区域里方向键停的点）、`start`（拿起时在哪个区域、哪一点）、`refocus`（结束后焦点还给谁） |
| `config?` | 起拖门槛等 |

自己画的拖动反馈（拖影、插入线）要带 `data-drag-feedback`：会话判定落点时跳过它们，不然它们会挡住指针下的目标。菜单、对话框挡在落点上时，落点不接收。

`state` 是此刻的状态（来源、落点、动作），没有拖动时是 `null`；宿主据此画反馈。

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
