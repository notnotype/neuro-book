# 拖动卡片与帧循环

拖动时跟着指针走的那张卡片，和驱动它的帧循环。两样都是纯 TS，时间与排帧由你给；卡片缩到多大、什么时候要卡片、卡片里画什么，由你定。

```ts
import {createDragCard, createFrameLoop} from "@notnotype/nb-layout";
import type {DragCard} from "@notnotype/nb-layout";

let card: DragCard | null = null;
let pointer = {x: 0, y: 0};
const loop = createFrameLoop({
    requestFrame: (run) => requestAnimationFrame(run),
    cancelFrame: (frame) => cancelAnimationFrame(frame),
    frame: (now, elapsed) => {
        // 先让会话做完这一帧的判定（读 DOM），再读、写卡片。
        session.flush();
        card ??= createDragCard(sourceRect(), pointer, {width: 320, height: 240});
        const {rect, settling} = card.step({now, elapsed, pointer, origin: gridOrigin(), target: {width: 320, height: 240}});
        if (rect !== null) placeCard(rect);
        return settling;
    },
});
// 建拖动会话之前挂（见下文“和拖动会话一起用”）。
window.addEventListener("pointermove", (event) => {
    pointer = {x: event.clientX, y: event.clientY};
    loop.wake();
}, {capture: true, passive: true});

// 拿起时：pointer = 按下的点; card = null; loop.start();
// 放下或取消时：loop.stop(); card = null;
```

`session` 是你的拖动会话（[`createDragSession`](vue/drag-session.md)）；`sourceRect()`、`gridOrigin()`、`placeCard()` 也是你的：内容此刻所在的矩形、网格根左上角（都是视口坐标），和把矩形写到卡片元素上。拿起时先把 `pointer` 设成按下的点，不然第一帧会从 `{x: 0, y: 0}` 拿起。

## 卡片

- `createDragCard(from, pointer, fallback, options?)` 从内容此刻所在的矩形拿起：尺寸是它的，抓住的点是指针在它上面的比例。指针在矩形外时，抓住的点夹在卡片边上，卡片从矩形的位置追到指针下。`from` 量不到（null、宽或高不是正数）时尺寸是 `fallback`，抓在上沿中点。
- `step(frame)` 每帧调一次：尺寸向 `target` 指数逼近（时间常数 `tauMs`，缺省 90），离终点不到 `stillPx`（缺省 0.1）就到了。第一次 `step` 不按时间逼近，卡片先停在拿起的地方。
- 交回的 `rect` 相对 `origin`，直接写到网格根里的卡片元素上；和上一次一样时是 `null`，不用写。尺寸取整到像素；位置按画出来的尺寸算，缩放中抓住的点也一直在指针下。
- `settling` 为真是尺寸或追赶还没到终点，要再排一帧。指针不动、`settling` 为假时，帧循环就停了。
- 卡片里的内容按卡片的大小排版时，尺寸每变一次就重排一次。`refreshMs` 限制尺寸多久变一次（位置照样每帧跟手），到终点那一帧马上写。
- 卡片不要了（例如指针回到了标签条上）就丢掉这个对象，再要时重新拿起。

## 帧循环

- `start()` 排第一帧，`stop()` 撤掉排着的帧。`frame` 返回真才排下一帧，返回假就停；停着时 `wake()` 排一帧。
- `elapsed` 是离上一帧的毫秒数，时间戳回退时是 0。`start` 之后与停过之后的第一帧是 `nominalMs`（缺省 1000/60）：真实间隔可能是好几秒，按它算缩放一步就到了终点。
- 跑一帧的过程中调 `wake` 不另排。帧里抛错时异常照常抛出，之后的 `wake` 照常排。

## 和拖动会话一起用

一帧里先读、后写，样式只重算一次：判定（[拖动会话](vue/drag-session.md)的 `resolve`，读 DOM）在前，写卡片在后。要做到这一点，帧循环的帧要排在会话发布的帧前面，所以叫醒它的 `pointermove` 监听要先于会话在按下时挂的监听挂上，例如建会话时就挂，并且在你的 `frame` 里先调 `session.flush()` 让会话做完这一帧的判定，再写卡片。挂反了不报错，只是每帧多一次强制的样式重算。

候选稳定才换预览、指针在已显示的空位里候选不变，用 `stepLiveDrop` 与 `insideShownSlot`。它们的空位是视口坐标，画在网格根里时自己减去网格根的左上角。
