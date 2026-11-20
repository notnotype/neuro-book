/**
 * 窗口有没有焦点（“看到”的条件之一，docs/specs/bots/view.md 输出 4）：视图可见还不够，切到别的程序时不算看到。监听 window 的
 * focus、blur，初值取 `document.hasFocus()`；在组件的 setup 里调用，卸载时摘掉监听。
 */

import {onBeforeUnmount, onMounted, ref} from "vue";
import type {Ref} from "vue";

export function useWindowFocus(): Readonly<Ref<boolean>> {
    const focused = ref(typeof document === "undefined" ? true : document.hasFocus());
    const onFocus = (): void => {
        focused.value = true;
    };
    const onBlur = (): void => {
        focused.value = false;
    };
    onMounted(() => {
        window.addEventListener("focus", onFocus);
        window.addEventListener("blur", onBlur);
    });
    onBeforeUnmount(() => {
        window.removeEventListener("focus", onFocus);
        window.removeEventListener("blur", onBlur);
    });
    return focused;
}
