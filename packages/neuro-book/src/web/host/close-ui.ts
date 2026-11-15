/**
 * 关闭前询问在页面上的样子（docs/specs/runtime/browser-host.md 输出 10）：“正在关闭”层、宿主自己的三种询问，与询问期间挡输入。
 * 状态在这里，`CloseLayer.vue` 只按状态画；询问的先后在 `close-query.ts`。
 *
 * 挡输入分三层，各管一件：
 *
 * - 层本身是一个模态对话框（`CloseLayer.vue`）：焦点锁在对话框里、对话框之外点不到。参与方之后开的对话框是更上一层的模态，
 *   叠在它上面照常可用。
 * - 盖层之前给 `body` 下已有的子节点设 `inert`：已经开着的菜单与命令面板也传送在 `body` 下，层级高于模态，只靠模态盖不住它们。
 *   之后打开的对话框是新的子节点，不受影响。撤层时只撤自己设的。层自己的根与桌面窗口外框的根（`DesktopFrame`）不设：询问期间
 *   窗口照样能最小化、最大化，再点关闭交给壳（browser-host 输出 10 的例外）。拖动不行：层的遮罩盖满窗口、不是拖动区域。
 * - 键盘拦截（`installCloseKeyGuard`）：工作台的键位在 `window` 的捕获阶段处理，焦点在对话框里也照样触发，所以要在它之前
 *   注册一个同阶段的拦截器，见那里的说明。
 */

import {shallowRef} from "vue";
import type {ShallowRef} from "vue";

import type {CloseLayer, ClosePrompt, ClosePrompts} from "./close-query";

export interface CloseUiState {
    readonly layer: boolean;
    readonly prompt: ClosePrompt | null;
}

export interface CloseUi {
    readonly state: Readonly<ShallowRef<CloseUiState>>;
    readonly layer: CloseLayer;
    readonly prompts: ClosePrompts;
    /** 用户在宿主的询问里选了。 */
    answer(choice: "close" | "cancel"): void;
    /** 层的对话框关完之后（它自己的焦点归还已经做完）把焦点还给盖层之前的位置。 */
    restoreFocus(): void;
}

export interface CloseUiOptions {
    readonly document: Document;
    /** 不设 `inert` 的根：层自己的挂载根，桌面窗口外框的根。 */
    readonly exemptRoots: () => ReadonlyArray<Element | null>;
}

export function createCloseUi(options: CloseUiOptions): CloseUi {
    const state = shallowRef<CloseUiState>({layer: false, prompt: null});
    let inerted: Element[] = [];
    let focusBefore: HTMLElement | null = null;
    let pending: ((choice: "close" | "cancel") => void) | null = null;

    const layer: CloseLayer = {
        show() {
            if (state.value.layer) return;
            const active = options.document.activeElement;
            focusBefore = active instanceof HTMLElement && active !== options.document.body ? active : null;
            const exempt = options.exemptRoots();
            for (const child of [...options.document.body.children]) {
                if (exempt.includes(child) || child.hasAttribute("inert")) continue;
                child.setAttribute("inert", "");
                inerted.push(child);
            }
            state.value = {...state.value, layer: true};
        },
        hide() {
            if (!state.value.layer) return;
            for (const element of inerted) element.removeAttribute("inert");
            inerted = [];
            state.value = {...state.value, layer: false};
        },
    };

    const prompts: ClosePrompts = {
        ask(prompt, signal) {
            pending?.("cancel");
            return new Promise((resolve) => {
                const settle = (choice: "close" | "cancel"): void => {
                    if (pending !== settle) return;
                    pending = null;
                    signal.removeEventListener("abort", onAbort);
                    state.value = {...state.value, prompt: null};
                    resolve(choice);
                };
                const onAbort = (): void => settle("cancel");
                pending = settle;
                state.value = {...state.value, prompt};
                if (signal.aborted) settle("cancel");
                else signal.addEventListener("abort", onAbort, {once: true});
            });
        },
    };

    return {
        state,
        layer,
        prompts,
        answer: (choice) => pending?.(choice),
        restoreFocus() {
            const target = focusBefore;
            focusBefore = null;
            if (target !== null && target.isConnected && !target.closest("[inert]")) target.focus({preventScroll: true});
        },
    };
}

/** 询问期间对话框里能用的键：在按钮之间移动、按下、关对话框。不带 Ctrl、Alt、Meta。 */
const DIALOG_KEYS = new Set(["Tab", "Enter", " ", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"]);

/**
 * 询问期间的键盘拦截：注册在 `window` 的 `keydown` 捕获阶段，必须早于工作台的键位（`WorkbenchCommandHost.vue` 挂载时注册，
 * 同一目标同一阶段按注册先后执行），所以在窗口界面挂载之前调用。询问进行中，只放行焦点在对话框里的几个导航键，其余一律
 * `preventDefault` 加 `stopImmediatePropagation`：焦点在对话框里按 Ctrl+S、Ctrl+W 也不能执行命令。
 */
export function installCloseKeyGuard(target: Pick<Window, "addEventListener" | "removeEventListener">, active: () => boolean): () => void {
    const onKeydown = (event: KeyboardEvent): void => {
        if (!active()) return;
        const inDialog = event.target instanceof Element && event.target.closest("[role='dialog'], [role='alertdialog']") !== null;
        if (inDialog && !event.ctrlKey && !event.altKey && !event.metaKey && DIALOG_KEYS.has(event.key)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    };
    target.addEventListener("keydown", onKeydown, true);
    return () => target.removeEventListener("keydown", onKeydown, true);
}
