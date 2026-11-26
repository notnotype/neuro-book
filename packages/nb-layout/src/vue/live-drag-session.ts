/**
 * 实时布局的拖动会话（Spec `ui/layout-drag` 的“实时布局的编排”）：一次建好拖动会话与编排引擎（`../live-drag.ts`），两者之间、引擎与网格之间的接线都在这里，
 * 宿主只写领域判断（`LiveDragHost`）。
 *
 * 接线的先后是合同，写反了类型检查照样过：
 * - 拿起全在包住的 `activate` 里：宿主的 `activate` 先；返回真、网格在、过渡时长不为 0 时 `settleMotion`（键盘拖动、`live` 不给来源的也是）；
 *   又不是键盘拖动才问 `live`，给出来源才 `begin`。
 *   手势在 `activate` 返回后取结构键，宿主的结构键读引擎的 `active` 时，两次取到的一样，拿起不会被当成结构变了。
 *   宿主的 `activate` 先于 `settleMotion`：它在 `activate` 里量到的矩形可能是过渡中间的。
 * - 判定：宿主的 `resolve` 返回之后交给引擎（`offer`）。
 * - 收场：引擎的 `end` 先于宿主的 `onActiveChange(false)`：`end` 里放回跟手的要读宿主这一场的状态，宿主在自己的回调里才换成空闲的一份。
 * - 放下：实时布局的这一场提交指针下的候选（`commitsUnderPointer`），与宿主自己的结果取“或”。
 * - 指针一动先叫醒引擎（会话的 `sampled`），帧排在会话发布的帧前面。
 */

import type {GridDropPoint} from "../grid-drop";
import type {GridRect} from "../grid-rects";
import {createLiveDrag} from "../live-drag";
import type {LiveDrag, LiveDragHost, LiveDragState} from "../live-drag";
import {createDragSession} from "./drag-session";
import type {DragSession, DragSessionOptions} from "./drag-session";

/**
 * 网格这一侧要的四样：`NestedGrid` 的实例满足，包着它的组件代理这四样也满足。
 * @experimental 1.0 之前签名会变。
 */
export interface LiveGrid {
    /** 网格根的左上角（视口坐标）：卡片与空位相对它。 */
    origin(): GridDropPoint;
    /** 写拿起的内容项的矩形（相对网格根）。 */
    placeLifted(rect: GridRect): void;
    /** 进行中的过渡直接到终点：拿起后马上要量矩形。 */
    settleMotion(): void;
    /** 布局过渡的时长；0 是减少动效，不走实时布局。 */
    motionMs(): number;
}

/**
 * @experimental 1.0 之前签名会变。
 */
export interface LiveDragSessionOptions<S, D, R, L, G> extends Omit<DragSessionOptions<S, D, R>, "root" | "sampled"> {
    /** 这一场的来源走不走实时布局：返回实时布局的来源（可以收窄），null 是照常落点指示。拿起时问一次；键盘拖动、减少动效与没有网格时库先判为不走，不问。 */
    live(source: S): L | null;
    /** 宿主要写的那份：领域判断，按 `L` 定类型。 */
    readonly host: LiveDragHost<L, D, G>;
    grid(): LiveGrid | null;
    /** 引擎的可见状态变了。 */
    changed?(state: LiveDragState): void;
}

/** @experimental 1.0 之前签名会变。 */
export interface LiveDragSessionHandle<S, D, L, G> {
    readonly session: DragSession<S, D>;
    readonly live: LiveDrag<L, D, G>;
    dispose(): void;
}

/**
 * 选项用工厂给：工厂收到引擎，宿主的回调里读 `live.geometry()` 不必引用还没返回的变量。工厂只调一次。
 * @experimental 1.0 之前签名会变。
 */
export function createLiveDragSession<S, D, R = never, L = S, G = unknown>(
    root: HTMLElement,
    createOptions: (live: LiveDrag<L, D, G>) => LiveDragSessionOptions<S, D, R, L, G>,
): LiveDragSessionHandle<S, D, L, G> {
    const view = root.ownerDocument.defaultView as Window;
    // 工厂先拿到这个转发的对象，引擎在选项有了之后才建。
    let engine: LiveDrag<L, D, G> | null = null;
    const current = (): LiveDrag<L, D, G> => {
        if (engine === null) throw new Error("createLiveDragSession: the engine is not ready while the options factory runs");
        return engine;
    };
    const live: LiveDrag<L, D, G> = {
        state: () => current().state(),
        begin: (source, point) => current().begin(source, point),
        offer: (drop) => current().offer(drop),
        wake: () => current().wake(),
        geometry: () => current().geometry(),
        unmoved: (point) => current().unmoved(point),
        sticky: (point) => current().sticky(point),
        previewedDrop: () => current().previewedDrop(),
        end: () => current().end(),
    };
    const options = createOptions(live);
    let session: DragSession<S, D> | null = null;
    /** 这一场拿起时的网格：`begin` 之后整场用它（容器变了整场取消）。 */
    let grid: LiveGrid | null = null;
    engine = createLiveDrag(options.host, {
        judge: () => session?.flush(),
        pointer: () => session?.state.value?.point ?? null,
        origin: () => grid?.origin() ?? {x: 0, y: 0},
        place: (rect) => grid?.placeLifted(rect),
        changed: (state) => options.changed?.(state),
        requestFrame: (run) => view.requestAnimationFrame(run),
        cancelFrame: (frame) => view.cancelAnimationFrame(frame),
    });
    const started = engine;
    session = createDragSession<S, D, R>({
        ...options,
        root,
        sampled: () => started.wake(),
        activate: (source, keyboard, at) => {
            if (options.activate !== undefined && !options.activate(source, keyboard, at)) return false;
            const box = options.grid();
            if (box === null || box.motionMs() <= 0) return true;
            // 不论走不走实时布局都把过渡送到终点：落点指示与键盘拖动的判定同样要量终点的矩形。
            box.settleMotion();
            // 键盘拖动不走实时布局：没有指针可跟；键盘拿起后可能因为没有区域而不起拖，那时不收场，引擎就没人结束。
            if (keyboard) return true;
            const from = options.live(source);
            if (from === null) return true;
            grid = box;
            started.begin(from, at?.point ?? null);
            return true;
        },
        resolve: (query) => {
            const drop = options.resolve(query);
            started.offer(drop);
            return drop;
        },
        commitsUnderPointer: (keyboard) => (options.commitsUnderPointer?.(keyboard) ?? false) || (!keyboard && started.state().active),
        onActiveChange: (active) => {
            if (!active) {
                started.end();
                grid = null;
            }
            options.onActiveChange?.(active);
        },
    });
    const created = session;
    return {session: created, live, dispose: () => created.dispose()};
}
