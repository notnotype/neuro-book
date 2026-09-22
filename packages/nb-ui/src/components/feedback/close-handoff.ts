import {onBeforeUnmount, watch} from "vue";

/**
 * S4 关闭交接：把「内容真的卸载完了」表达成一个只发一次的 `closed`。
 *
 * 为什么不能直接在 `close-auto-focus` 里发：Reka 的 FocusScope 在自己的卸载清理里
 * 才排 `setTimeout(…, 0)` 去摘焦点栈（`FocusScope.vue` 的 cleanupFn）。同一个同步任务里
 * 排的定时器会排在它前面，宿主动手时焦点栈/指针锁还没释放。
 * 所以这里先 `queueMicrotask` 把定时器登记推迟到本同步任务之后，再排下一宏任务；
 * token 让重开、换文档与组件卸载作废未结算的旧交接。
 *
 * 语义见 docs/design-language.md §七.6 与 docs/ui-development-spec.md §4.2.18：
 * `closed` 表示关闭已完成，宿主在此之后才执行命令或激活下一个交互层，不许用固定毫秒数代替。
 */
export type CloseHandoff = Readonly<{
    /** 在内容的 close-auto-focus 里调用；settle 只在本次打开周期仍然有效时执行一次 */
    schedule: (settle: () => void) => void;
    /** 作废尚未结算的关闭（重开、场景切换、卸载） */
    invalidate: () => void;
}>;

export function useCloseHandoff(isOpen: () => boolean): CloseHandoff {
    let token = 0;
    let timer: number | undefined;
    let disposed = false;

    function invalidate(): void {
        token += 1;
        // 未登记的 timer 是 undefined，清它按约定是 no-op
        clearTimeout(timer);
        timer = undefined;
    }

    watch(isOpen, (open) => {
        if (open) invalidate();
    });

    onBeforeUnmount(() => {
        disposed = true;
        invalidate();
    });

    function schedule(settle: () => void): void {
        const current = ++token;
        clearTimeout(timer);
        timer = undefined;
        queueMicrotask(() => {
            if (disposed || current !== token) return;
            timer = window.setTimeout(() => {
                timer = undefined;
                if (disposed || current !== token) return;
                settle();
            }, 0);
        });
    }

    return {schedule, invalidate};
}
