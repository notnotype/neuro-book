/**
 * 分隔线装饰的设备像素对齐：一个父组件只有一份窗口监听和一帧 rAF，这一帧里跑一遍它名下所有分隔线。
 *
 * 为什么不让每条 `SashHandle` 自己监听：监听数会从分支数变成分隔线数，页面每次滚动都要读
 * 分隔线条数次布局（`getBoundingClientRect`）。所以由父组件调用一次 `useSashSnap()` 并 provide，
 * 分隔线 inject 后登记自己的对齐函数。
 *
 * 对齐函数读布局，所以过渡中的几何要等过渡结束再 `schedule()` 一次，否则读到的是旧位置。
 */
import {inject, onBeforeUnmount, onMounted, provide, type InjectionKey} from "vue";

export interface SashSnapHost {
    /** 登记一条分隔线的对齐函数，返回注销。参数是当前的设备像素比。 */
    register(snap: (dpr: number) => void): () => void;
    /** 合并到一帧，重新对齐所有分隔线。 */
    schedule(): void;
}

const SASH_SNAP_KEY: InjectionKey<SashSnapHost> = Symbol("nb-layout.sash-snap");

/**
 * 由持有分隔线的父组件在 setup 里调用一次；内部 provide。
 *
 * 触发源很多（拖动预览、宿主发布尺寸、接缝尺寸、方向、挂载与窗口变化），统一合并到一帧：
 * 重复请求只多跑一遍对齐，不会各排一个回调。窗口的 `resize` 与捕获阶段 `scroll` 在挂载后才监听、卸载时拆掉，
 * 并取消排着的那一帧。
 */
export function useSashSnap(): SashSnapHost {
    const snaps = new Set<(dpr: number) => void>();
    let frame = 0;
    let disposed = false;

    function schedule(): void {
        if (disposed || typeof requestAnimationFrame !== "function") {
            return;
        }
        if (frame) {
            return;
        }
        frame = requestAnimationFrame(() => {
            frame = 0;
            const dpr = window.devicePixelRatio || 1;
            for (const snap of snaps) {
                snap(dpr);
            }
        });
    }

    /**
     * 滚动改变接缝在视口里的位置，叠加 dpr 后会算出不同的对齐位移：捕获阶段监听（滚动不冒泡）挂到 window，
     * 一次覆盖所有滚动容器；只排一帧几何，不读布局，也不产生滚动副作用。
     */
    onMounted(() => {
        window.addEventListener("resize", schedule);
        window.addEventListener("scroll", schedule, {capture: true, passive: true});
    });

    onBeforeUnmount(() => {
        disposed = true;
        window.removeEventListener("resize", schedule);
        window.removeEventListener("scroll", schedule, {capture: true});
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

/** `SashHandle` 用：取最近一层父组件提供的对齐宿主。没有就是接线错误，直接报错而不是静默不对齐。 */
export function injectSashSnap(): SashSnapHost {
    const host = inject(SASH_SNAP_KEY, null);
    if (host === null) {
        throw new Error("[nb-layout] SashHandle must be rendered under a component that called useSashSnap().");
    }
    return host;
}
