/**
 * 分隔线装饰的设备像素对齐：一个父组件只有一份窗口监听和一帧 rAF，这一帧里跑一遍它名下所有分隔线。
 *
 * 为什么不让每条 `SashHandle` 自己监听：监听数会从分支数变成分隔线数，页面每次滚动都要读
 * 分隔线条数次布局（`getBoundingClientRect`）。所以由父组件调用一次 `useSashSnap()` 并 provide，
 * 分隔线 inject 后登记自己的对齐函数。
 *
 * 对齐函数读布局，所以过渡中的几何要等过渡结束再 `schedule()` 一次，否则读到的是旧位置。
 *
 * 一帧里先让所有分隔线量完，再统一写：每条线都是“读位置、写内联样式”，逐条做的话，后一条的读会因为前一条的写
 * 强制重算一次样式与布局，改窗口大小时每一步都要多付分隔线条数次重算（w00046 t19 量过）。
 */
import {inject, onBeforeUnmount, onMounted, provide, watch, type InjectionKey, type Ref} from "vue";

import {useDevicePixelRatio} from "./useDevicePixelRatio";

export interface SashSnapHost {
    /**
     * 登记一条分隔线的对齐函数，返回注销。参数是当前的设备像素比。对齐函数只读布局与样式、不写，
     * 把要写的东西包成函数交回（没有要写的交回 null）；写在这一帧所有分隔线都量完之后执行。
     */
    register(snap: SashSnapMeasure): () => void;
    /** 合并到一帧，重新对齐所有分隔线。 */
    schedule(): void;
}

/** 量一条分隔线：只读，交回这一帧量完之后要做的写入。 */
type SashSnapMeasure = (dpr: number) => (() => void) | null;

const SASH_SNAP_KEY: InjectionKey<SashSnapHost> = Symbol("nb-layout.sash-snap");

/**
 * 由持有分隔线的父组件在 setup 里调用一次；内部 provide。`root` 是它的根元素（分隔线都在里面），用来判哪些滚动挪动了分隔线。
 *
 * 触发源很多（拖动预览、宿主发布尺寸、接缝尺寸、方向、挂载与窗口变化），统一合并到一帧：
 * 重复请求只多跑一遍对齐，不会各排一个回调。窗口的 `resize` 与捕获阶段 `scroll` 在挂载后才监听、卸载时拆掉，
 * 并取消排着的那一帧。
 */
export function useSashSnap(root: Readonly<Ref<HTMLElement | null>>): SashSnapHost {
    const snaps = new Set<SashSnapMeasure>();
    let frame = 0;
    let disposed = false;
    // 设备像素比只有一个来源：缩放变了要重新对齐，不靠别处顺带触发。
    const dpr = useDevicePixelRatio();
    watch(dpr, () => schedule());

    function schedule(): void {
        if (disposed || typeof requestAnimationFrame !== "function") {
            return;
        }
        if (frame) {
            return;
        }
        frame = requestAnimationFrame(() => {
            frame = 0;
            const writes: Array<() => void> = [];
            for (const snap of snaps) {
                const write = snap(dpr.value);
                if (write !== null) {
                    writes.push(write);
                }
            }
            for (const write of writes) {
                write();
            }
        });
    }

    /**
     * 滚动改变接缝在视口里的位置，叠加 dpr 后会算出不同的对齐位移：捕获阶段监听（滚动不冒泡）挂到 window，
     * 一次覆盖所有滚动容器；只排一帧几何，不读布局，也不产生滚动副作用。
     * 只有滚动的是文档、或是包着根的元素时，分隔线才跟着挪：网格里面的滚动（资源管理器的树、编辑器的正文）不挪分隔线，
     * 不然页面里任何一处滚动每一帧都要把所有分隔线量一遍、写一遍。嵌套的网格各判自己的根。根还没挂上时照排。
     * 网格可能在 Shadow DOM 里：`contains` 不跨 Shadow 边界，从根往上走时到了 Shadow 根就跳到它的宿主。
     */
    function onScroll(event: Event): void {
        const element = root.value;
        const target = event.target;
        if (element === null || !(target instanceof Node) || target instanceof Document || encloses(target, element)) schedule();
    }

    onMounted(() => {
        window.addEventListener("resize", schedule);
        window.addEventListener("scroll", onScroll, {capture: true, passive: true});
    });

    onBeforeUnmount(() => {
        disposed = true;
        window.removeEventListener("resize", schedule);
        window.removeEventListener("scroll", onScroll, {capture: true});
        if (frame) {
            cancelAnimationFrame(frame);
        }
        frame = 0;
    });

    const host: SashSnapHost = {
        register(snap) {
            snaps.add(snap);
            return () => {
                snaps.delete(snap);
            };
        },
        schedule,
    };
    provide(SASH_SNAP_KEY, host);
    return host;
}

/** `outer` 是 `inner` 自己或它的祖先：往上走，到了 Shadow 根接着走它的宿主。 */
function encloses(outer: Node, inner: Node): boolean {
    for (let node: Node | null = inner; node !== null; node = node instanceof ShadowRoot ? node.host : node.parentNode) {
        if (node === outer) return true;
    }
    return false;
}

/** `SashHandle` 用：取最近一层父组件提供的对齐宿主。没有就是接线错误，直接报错而不是静默不对齐。 */
export function injectSashSnap(): SashSnapHost {
    const host = inject(SASH_SNAP_KEY, null);
    if (host === null) {
        throw new Error("[nb-layout] SashHandle must be rendered under a component that called useSashSnap().");
    }
    return host;
}
