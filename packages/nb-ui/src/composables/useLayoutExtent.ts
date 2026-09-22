/**
 * 承载盒的**布局尺寸**测量：所有把容器尺寸喂给 grid 会话的宿主共用这一份。
 *
 * 为什么不能各写一遍 `getBoundingClientRect()`：那是**变换后**的盒子，祖先的 `transform`
 * （例如验证台淡入时的 `scale(0.99)`）会把尺寸算小，而 `ResizeObserver` 只看布局盒、
 * 变换结束后不再回调，于是那份被缩放过的尺寸会一直留着，预览布局与受控布局对不上。
 * `clientWidth/clientHeight` 是布局盒，且不含 padding/border，正是 grid 分配要的空间
 * （承载盒因此要求无 padding/border）。命中判定仍用 client 坐标 rect，两者不要混。
 *
 * 三个状态要分清：**未挂载 = `null`**（宿主不能凭它开手势）、**真实零 = `0`**（容器确实没有
 * 空间）、**有尺寸**（正常）。两轴都没变时不发布新对象，避免下游无谓重算。
 */
import {onScopeDispose, ref, watch, type Ref} from "vue";
import type {GridExtent} from "../components/layout/grid-types";

export function useLayoutExtent(element: Readonly<Ref<HTMLElement | null>>): Readonly<Ref<GridExtent | null>> {
    const extent: Ref<GridExtent | null> = ref(null);
    let observer: ResizeObserver | null = null;

    function publish(next: GridExtent | null): void {
        const current = extent.value;
        if (next === null) {
            if (current !== null) {
                extent.value = null;
            }
            return;
        }
        if (current !== null && current.width === next.width && current.height === next.height) {
            return;
        }
        extent.value = next;
    }

    function measure(target: HTMLElement): GridExtent {
        return {width: Math.max(0, target.clientWidth), height: Math.max(0, target.clientHeight)};
    }

    function disconnect(): void {
        observer?.disconnect();
        observer = null;
    }

    watch(element, (target, previous) => {
        disconnect();
        if (previous !== null && previous !== undefined) {
            publish(null);
        }
        if (target === null) {
            return;
        }
        publish(measure(target));
        if (typeof ResizeObserver !== "undefined") {
            observer = new ResizeObserver(() => publish(measure(target)));
            observer.observe(target);
        }
    }, {immediate: true});

    onScopeDispose(disconnect);

    return extent;
}
