# 实时布局的拖动会话

`createLiveDragSession` 与组件版 `useLiveDragSession`：拖动中布局真的变，反馈就是布局本身，拿起的内容做成卡片跟着指针。它在[拖动会话](drag-session.md)上接好编排：什么时候换预览、收起与展开来源、判定用哪份几何、什么时候拿起与收回卡片、一帧里各步的先后。宿主只写领域判断：落点、预览摆成什么、几何怎么量。各条规则写在下面“宿主要写的”与“约定”里。0.x 期间都是 `@experimental`，1.0 之前签名会变。

```ts
const box = ref<HTMLElement | null>(null);              // 包住网格的那一层：会话的根
const gridRef = ref<InstanceType<typeof NestedGrid> | null>(null);
const {liveState, lifted, dragging} = useLiveDragSession(box, (live) => ({
    sourceAt: (target) => …,                            // 同拖动会话
    resolve: ({source, point}) => {
        if (live.unmoved(point)) return lastJudged;      // 来源收起、展开那一刻起指针没动：沿用那一刻的判定
        const kept = live.sticky(point);                // 指针在已显示的空位里：候选不变
        if (kept !== null) return kept;
        const rects = live.geometry() ?? measureNow();  // 拿起时的几何；量到之前现量、不存
        return lastJudged = judge(rects, point);
    },
    actionKey: (drop) => …,
    commit: (drop, source) => …,
    live: (source) => source,                           // 这一场走不走实时布局；null 是落点指示
    grid: () => gridRef.value,                          // NestedGrid 的实例（或代理 origin、placeLifted、settleMotion、motionMs 的组件）
    host: {
        facts: (source, drop) => ({key, inPlace, home: false, slotOnScreen}),
        show: (target) => { preview.value = …; return 摆出来了; },
        measure: (source) => measureNow(),
        collapsed: (source, before) => 收起之后的几何 ?? null,
        card: {key: (source) => 内容项的键, rect: (source, container, geometry) => geometry.get(source) ?? null},
    },
}));
```

`<NestedGrid ref="gridRef" … :lifted="lifted" :dragging="dragging">`。完整的例子见应用 Lab 的 `fixtures/nb-layout/LivePanelsScene.vue`（只经公开入口）。

## 宿主要写的（`LiveDragHost`）

| 名字 | 是什么 |
|---|---|
| `facts(source, drop)` | 落点的描述：`key`（摆出来一样的落点同一个键）、`inPlace`（放下去是原样）、`home`（落在这里还没离开来源，不收起它）、`slotOnScreen`（长出新块时的空位，视口坐标）、`container`（可选：吸收来源的容器）。每个落点在交来时算一次 |
| `show(target, {source, collapsed})` | 摆预览：按落点、来源收起的样子，或 null（已提交的样子）。按落点摆出来了返回真；摆不出来返回假，并且自己摆兜底：来源收起着摆来源收起的样子，没收起摆已提交的样子 |
| `measure(source)` | 判定的几何：拿起后第一帧开头调一次 |
| `collapsed(source, before)` | 来源收起后的几何；null 是收起不改几何 |
| `staysWithoutSource?(source)` | 来源那块摘掉它还在：要卡片时马上收起来源（撕下）。只有工作台验证过 |
| `card` | `key`（卡片里放哪个内容项）、`rect(source, container, geometry)`（某块的矩形：`container` 为 null 是来源那块）、`compact`（缩到多大，缺省 380×260）、`keepSizeInsideHome`（指针还在来源那块里时不缩）、`refreshMs`（尺寸多久写一次） |
| `follow?` | 容器里跟手：`read(at)` 只读、返回写的那一步，`afterRender(at)` 渲染之后再放一次。只有工作台验证过 |

## 约定

- 预览只给渲染：`structure` 与 `resolve` 读已提交的状态，预览改结构键会让一场一拿起就取消。
- 预览把来源摘掉时，拿起的内容项由 `NestedGrid` 留住（见它的 `lifted`）；`lifted` 要在摘掉它的那一次渲染里给出，`useLiveDragSession` 的 `lifted` 就是这样。
- 键盘拖动、减少动效（网格的 `motionMs()` 为 0）、`grid()` 为 null 时这一场是落点指示，`live` 不会被问。
- 合成接线的先后（`activate`、`resolve` 之后交给编排、收场时编排先结束）写在 `live-drag-session.ts` 的头注释里，宿主不用自己排。宿主的 `activate` 返回真、网格在、过渡时长不为 0 时，会话把网格的过渡送到终点（`settleMotion`），键盘拖动与 `live` 返回 null 的这一场也是，落点指示的判定因此量到终点的矩形。宿主的 `activate` 先于 `settleMotion`，它在 `activate` 里量到的矩形可能是过渡中间的。
