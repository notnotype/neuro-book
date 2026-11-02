/**
 * `Dialog` 与 `FloatingWindow` 共用的关闭、确认与焦点处理（合同见 docs/ui-development-spec.md 的“浮层的打开与关闭”）。
 *
 * 关闭先发 `request-close`，`closeOnRequest` 为真时随即发 `update:open(false)`；宿主要拦（脏表单、守卫）时传
 * `:close-on-request="false"` 自己决定。行为不随宿主挂了哪些监听变化。确认按钮只发 `confirm`，关不关由宿主决定。
 * reka 自己的外部点击与 Escape 关闭都拦下，由这里判定后发出。
 */
import {useCloseHandoff} from "./close-handoff";

export type DialogCloseOptions<Reason extends string> = {
    readonly open: () => boolean;
    readonly busy: () => boolean;
    readonly closeOnRequest: () => boolean;
    readonly closeOnEsc: () => boolean;
    readonly initialFocus: () => string | undefined;
    /** 外框元素：初始焦点在它里面找，找不到时聚焦它。 */
    readonly panel: {readonly value: HTMLElement | null};
    readonly emitRequest: (reason: Reason | "escape") => void;
    readonly emitOpen: (value: boolean) => void;
    readonly emitConfirm: () => void;
    readonly emitClosed: () => void;
};

export function useDialogClose<Reason extends string>(options: DialogCloseOptions<Reason>) {
    function requestClose(reason: Reason | "escape"): void {
        if (options.busy()) return;
        options.emitRequest(reason);
        if (options.closeOnRequest()) options.emitOpen(false);
    }

    function confirm(): void {
        if (options.busy()) return;
        options.emitConfirm();
    }

    const handoff = useCloseHandoff(options.open);

    /** `closed`：内容卸载完、焦点栈释放之后才发（见 close-handoff.ts）。 */
    function onCloseAutoFocus(): void {
        handoff.schedule(options.emitClosed);
    }

    /** reka 想自己关（外部点击、Escape）都已在这里拦掉；外部点击由宿主自己判定（模态看遮罩，窗口不关）。 */
    function preventDismiss(event: Event): void {
        event.preventDefault();
    }

    /**
     * Escape：只有最上层收得到（reka 判定）。reka 在 window 上冒泡阶段监听，内层控件已经处理过（`.prevent`）的、
     * 输入法正在组字时按的，都不算关闭。
     */
    function onEscapeKeyDown(event: KeyboardEvent): void {
        const handled = event.defaultPrevented || event.isComposing || event.keyCode === 229;
        event.preventDefault();
        if (!handled && options.closeOnEsc()) requestClose("escape");
    }

    function onOpenAutoFocus(event: Event): void {
        const selector = options.initialFocus();
        if (selector === undefined) return;
        event.preventDefault();
        const element = options.panel.value;
        (element?.querySelector<HTMLElement>(selector) ?? element)?.focus({preventScroll: true});
    }

    return {requestClose, confirm, onCloseAutoFocus, preventDismiss, onEscapeKeyDown, onOpenAutoFocus};
}
