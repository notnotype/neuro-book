/**
 * 视图“看得见”的上报：视图有效可见、并且页面在前台才算看得见；页面转到后台、组件卸载时报看不见。“后台任务”视图据此记看过
 * （docs/specs/workbench/background-tasks.md 输出 13），“通知”视图据此不弹出新通知（docs/specs/workbench/notifications.md
 * 输出 15、16）。在组件的 `setup` 里调用：监听挂在 `document` 上，卸载时摘掉。
 */

import {onBeforeUnmount, ref, watch} from "vue";
import type {Ref} from "vue";

export function useForegroundVisibility(visible: Readonly<Ref<boolean>>, report: (visible: boolean) => void): void {
    const pageVisible = ref(document.visibilityState === "visible");
    const onVisibility = (): void => {
        pageVisible.value = document.visibilityState === "visible";
    };
    document.addEventListener("visibilitychange", onVisibility);
    watch(() => visible.value && pageVisible.value, (next) => report(next), {immediate: true});
    onBeforeUnmount(() => {
        document.removeEventListener("visibilitychange", onVisibility);
        report(false);
    });
}
