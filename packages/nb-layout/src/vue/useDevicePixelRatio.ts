/**
 * 设备像素比的响应式读数：`placeGrid` 按它取整。`window.devicePixelRatio` 本身不响应：浏览器缩放会触发 `resize`，把窗口拖到另一块
 * 显示器不一定，所以另外盯 `matchMedia`。这个查询只对当前值成立，变了要换一个新的查询。
 */
import {onBeforeUnmount, onMounted, ref, type Ref} from "vue";

export function useDevicePixelRatio(): Readonly<Ref<number>> {
    const read = (): number => (typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
    const dpr = ref(read());
    let resolution: MediaQueryList | null = null;

    function watchResolution(): void {
        resolution?.removeEventListener("change", sync);
        resolution = window.matchMedia(`(resolution: ${dpr.value}dppx)`);
        resolution.addEventListener("change", sync);
    }

    function sync(): void {
        dpr.value = read();
        watchResolution();
    }

    onMounted(() => {
        window.addEventListener("resize", sync);
        sync();
    });
    onBeforeUnmount(() => {
        window.removeEventListener("resize", sync);
        resolution?.removeEventListener("change", sync);
    });
    return dpr;
}
