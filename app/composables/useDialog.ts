import { createApp, type App, type ComponentPublicInstance, defineComponent, h, type InjectionKey, nextTick, ref, type VNodeRef } from "vue";
import Dialog from "nbook/app/components/common/Dialog.vue";
import { IDE_THEME_HOST_CLASS } from "../utils/theme/theme-tokens";

/**
 * 对话框 JS API 的内部类型。
 */
type DialogType = "alert" | "confirm" | "prompt";
type DialogActionValue = "confirm" | "cancel" | "discard" | string;

/**
 * 对话框 JS API 的内部参数结构。
 */
interface DialogOptions {
    type: DialogType;
    message: string;
    title?: string;
    defaultValue?: string;
}

interface ChooseDialogOptions {
    message: string;
    title?: string;
    actions: Array<{
        label: string;
        value: DialogActionValue;
        tone?: "default" | "primary" | "danger";
    }>;
}

type VueI18nContextApp = App<Element> & {
    __VUE_I18N_SYMBOL__?: InjectionKey<object>;
    _context: {
        provides: Record<symbol, object>;
    };
};

/**
 * 让动态创建的 Dialog app 复用 Nuxt 主 app 的 i18n 注入。
 */
function inheritI18nContext(app: App<Element>, sourceApp: VueI18nContextApp): void {
    const i18nSymbol = sourceApp.__VUE_I18N_SYMBOL__;
    if (!i18nSymbol) {
        return;
    }

    const i18nInstance = sourceApp._context.provides[i18nSymbol];
    if (!i18nInstance) {
        return;
    }

    const targetApp = app as VueI18nContextApp;
    targetApp.__VUE_I18N_SYMBOL__ = i18nSymbol;
    app.provide(i18nSymbol, i18nInstance);
}

/**
 * 动态创建一个对话框实例，返回 Promise。
 * 对话框关闭后自动销毁 DOM 和 Vue app。
 */
function createDialogInstance(
    options: DialogOptions,
    sourceApp: VueI18nContextApp,
): Promise<string | boolean | null> {
    return new Promise((resolve) => {
        // 宿主 DOM 节点
        const container = document.createElement("div");
        const themeHost = document.querySelector<HTMLElement>(`.${IDE_THEME_HOST_CLASS}`);
        (themeHost ?? document.body).appendChild(container);

        let resolved = false;

        /**
         * 销毁对话框实例和 DOM。
         */
        const destroy = (): void => {
            // 延迟销毁，等过渡动画完成
            setTimeout(() => {
                app.unmount();
                container.remove();
            }, 300);
        };

        // 动态组件定义
        const DialogWrapper = defineComponent({
            setup() {
                const visible = ref(true);
                const inputValue = ref(options.defaultValue ?? "");

                /**
                 * 确认逻辑。
                 */
                const onConfirm = (): void => {
                    if (resolved) {
                        return;
                    }
                    resolved = true;
                    visible.value = false;

                    if (options.type === "alert") {
                        resolve(undefined as unknown as string);
                    } else if (options.type === "confirm") {
                        resolve(true);
                    } else {
                        resolve(inputValue.value);
                    }

                    destroy();
                };

                /**
                 * 取消逻辑。
                 */
                const onCancel = (): void => {
                    if (resolved) {
                        return;
                    }
                    resolved = true;
                    visible.value = false;

                    if (options.type === "alert") {
                        resolve(undefined as unknown as string);
                    } else if (options.type === "confirm") {
                        resolve(false);
                    } else {
                        resolve(null);
                    }

                    destroy();
                };

                return () => {
                    // body 内容
                    const bodyContent: ReturnType<typeof h>[] = [];

                    // 消息文本
                    if (options.message) {
                        bodyContent.push(
                            h("p", {
                                class: "m-0 text-sm leading-relaxed text-[var(--text-secondary)]",
                            }, options.message),
                        );
                    }

                    // prompt 类型的输入框
                    if (options.type === "prompt") {
                        bodyContent.push(
                            h("input", {
                                value: inputValue.value,
                                onInput: (e: Event) => {
                                    inputValue.value = (e.target as HTMLInputElement).value;
                                },
                                onKeydown: (e: KeyboardEvent) => {
                                    if (e.key === "Enter") {
                                        onConfirm();
                                    }
                                },
                                class: "block w-full mt-3 px-3 py-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-main)] text-sm outline-none focus:border-[var(--accent-main)] transition-colors",
                                ref: ((el: Element | ComponentPublicInstance | null) => {
                                    // 自动聚焦输入框
                                    if (el instanceof HTMLInputElement) {
                                        nextTick(() => el.focus());
                                    }
                                }) as VNodeRef,
                            }),
                        );
                    }

                    return h(Dialog, {
                        modelValue: visible.value,
                        "onUpdate:modelValue": (val: boolean) => {
                            visible.value = val;
                        },
                        title: options.title ?? "",
                        closable: options.type !== "alert",
                        closeOnOverlay: options.type !== "alert",
                        showCancel: options.type !== "alert",
                        closeOnEsc: true,
                        width: "400px",
                        teleportTarget: false,
                        onConfirm,
                        onCancel,
                        onRequestClose: onCancel,
                    }, {
                        default: () => bodyContent,
                    });
                };
            },
        });

        const app = createApp(DialogWrapper);
        inheritI18nContext(app, sourceApp);
        app.mount(container);
    });
}

/**
 * 动态创建一个多动作对话框实例，返回选中的动作值。
 */
function createChooseDialogInstance(options: ChooseDialogOptions, sourceApp: VueI18nContextApp): Promise<DialogActionValue> {
    return new Promise((resolve) => {
        const container = document.createElement("div");
        const themeHost = document.querySelector<HTMLElement>(`.${IDE_THEME_HOST_CLASS}`);
        (themeHost ?? document.body).appendChild(container);

        let resolved = false;

        /**
         * 销毁对话框实例和 DOM。
         */
        const destroy = (): void => {
            setTimeout(() => {
                app.unmount();
                container.remove();
            }, 300);
        };

        const DialogWrapper = defineComponent({
            setup() {
                const visible = ref(true);

                /**
                 * 关闭并返回选中的动作。
                 */
                const choose = (value: DialogActionValue): void => {
                    if (resolved) {
                        return;
                    }

                    resolved = true;
                    visible.value = false;
                    resolve(value);
                    destroy();
                };

                return () => h(Dialog, {
                    modelValue: visible.value,
                    "onUpdate:modelValue": (val: boolean) => {
                        visible.value = val;
                    },
                    title: options.title ?? "",
                    closable: false,
                    closeOnOverlay: false,
                    closeOnEsc: false,
                    width: "420px",
                    teleportTarget: false,
                    onCancel: () => choose("cancel"),
                    onRequestClose: () => choose("cancel"),
                }, {
                    default: () => h("p", {
                        class: "m-0 text-sm leading-relaxed text-[var(--text-secondary)]",
                    }, options.message),
                    footer: () => options.actions.map((action) => h("button", {
                        class: action.tone === "primary"
                            ? "inline-flex items-center justify-center h-8 whitespace-nowrap px-3 rounded-md text-[13px] font-medium cursor-pointer border border-transparent bg-[var(--accent-main)] text-[var(--text-inverse)] transition-all duration-200 hover:opacity-90 hover:shadow-md active:scale-95"
                            : action.tone === "danger"
                                ? "inline-flex items-center justify-center h-8 whitespace-nowrap px-3 rounded-md text-[13px] font-medium cursor-pointer border border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger)] transition-colors duration-200 hover:bg-[var(--status-danger)] hover:text-[var(--text-inverse)] active:scale-95"
                                : "inline-flex items-center justify-center h-8 whitespace-nowrap px-3 rounded-md text-[13px] font-medium cursor-pointer border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-main)] transition-colors duration-200 hover:bg-[var(--bg-hover)] active:scale-95",
                        onClick: () => choose(action.value),
                    }, action.label)),
                });
            },
        });

        const app = createApp(DialogWrapper);
        inheritI18nContext(app, sourceApp);
        app.mount(container);
    });
}

/**
 * 通用对话框 JS API composable。
 *
 * 提供 alert / confirm / prompt 三个异步函数，
 * 用于替代浏览器原生的 window.alert / window.confirm / window.prompt。
 */
export function useDialog() {
    const {t} = useI18n();
    const nuxtApp = useNuxtApp();
    const sourceApp = nuxtApp.vueApp as VueI18nContextApp;

    /**
     * 消息提示对话框，替代 window.alert。
     */
    const alert = (message: string, title?: string): Promise<void> => {
        return createDialogInstance({ type: "alert", message, title: title ?? t("dialog.alertTitle") }, sourceApp) as unknown as Promise<void>;
    };

    /**
     * 确认对话框，替代 window.confirm。
     * 用户点击确定返回 true，取消返回 false。
     */
    const confirm = (message: string, title?: string): Promise<boolean> => {
        return createDialogInstance({ type: "confirm", message, title: title ?? t("dialog.confirmTitle") }, sourceApp) as Promise<boolean>;
    };

    /**
     * 输入对话框，替代 window.prompt。
     * 用户点击确定返回输入值，取消返回 null。
     */
    const prompt = (message: string, defaultValue = "", title?: string): Promise<string | null> => {
        return createDialogInstance({ type: "prompt", message, defaultValue, title: title ?? t("dialog.promptTitle") }, sourceApp) as Promise<string | null>;
    };

    /**
     * 多动作选择对话框。
     */
    const choose = (
        message: string,
        actions: ChooseDialogOptions["actions"],
        title?: string,
    ): Promise<DialogActionValue> => {
        return createChooseDialogInstance({
            message,
            title: title ?? t("dialog.chooseTitle"),
            actions,
        }, sourceApp);
    };

    return { alert, confirm, prompt, choose };
}
