/**
 * 命令类场景的局部宿主：注册表、面板入口命令、键位分发与确认闸门都跟着当前 fixture 实例走。
 *
 * LabShell 不再持有产品命令宿主：Lab 按 `组件:场景` 为 key 重挂 fixture，这里用
 * `provideWorkbenchCommands` 建出来的宿主于是和场景同寿——切场景时键位监听、面板、
 * 未决确认与注册表一起释放，不会漏到下一个场景，也不会让别的组件场景响应命令快捷键。
 *
 * 执行审计转成 Lab 的 `command` 事件（事件 tab 可见）；失败另写入 `failure`，由
 * 命令检视区唯一的 `role="alert"` 显示。这里不弹 Toast，也不写任何偏好或 Storage。
 */
import {computed, onBeforeUnmount, onMounted, ref, shallowRef, watch, type ComputedRef, type Ref, type ShallowRef} from "vue";
import {useI18n} from "vue-i18n";
import {Type, type TSchema} from "typebox";
import {provideWorkbenchCommands, type WorkbenchCommandsHost} from "nbook/app/composables/useWorkbenchCommands";
import type {CommandConfirmationRequest, CommandDescriptor, Release} from "nbook/app/utils/workbench/commands";
import {createKeymapDispatcher} from "nbook/app/utils/workbench/keymap";
import {useLabEventSink} from "../lab-event-sink";

export type LabCommandTitleOf = (key: string, params?: Record<string, unknown>) => string;

type PendingConfirmation = {
    request: CommandConfirmationRequest;
    decision: "pending" | "approved" | "denied";
    resolve: (approved: boolean) => void;
};

export type LabCommandConfirmation = Readonly<{
    visible: Ref<boolean>;
    pending: ShallowRef<PendingConfirmation | null>;
    title: ComputedRef<string>;
    args: ComputedRef<string>;
    destructive: ComputedRef<boolean>;
    settle: (approved: boolean) => void;
    onOpenChange: (open: boolean) => void;
    onClosed: () => void;
}>;

export type LabCommandScene = Readonly<{
    host: WorkbenchCommandsHost;
    titleOf: LabCommandTitleOf;
    /** 最近一次命令失败（注册表报告或执行失败）；空串表示没有待看的失败。 */
    failure: Ref<string>;
    confirmation: LabCommandConfirmation;
}>;

/** 快捷键的平台口径：macOS 上 Mod 是 Meta，其它平台是 Ctrl。 */
function isMacPlatform(): boolean {
    if (typeof navigator === "undefined") {
        return false;
    }
    return /Mac|iPhone|iPad/u.test(navigator.platform || navigator.userAgent);
}

export function useLabCommandScene(): LabCommandScene {
    const emitLabEvent = useLabEventSink();
    const {t} = useI18n();
    const titleOf: LabCommandTitleOf = (key, params) => params === undefined ? t(key) : t(key, params);

    const failure = ref("");
    const reportError = (error: Error): void => {
        failure.value = error.message;
        emitLabEvent("command-error", error.message);
    };

    const visible = ref(false);
    const pending = shallowRef<PendingConfirmation | null>(null);
    /** 面板打开时到达的确认请求要等它真正关闭再显示；面板关闭或场景卸载时清空。 */
    const paletteCloseWaiters: (() => void)[] = [];

    const host = provideWorkbenchCommands({
        development: import.meta.dev,
        report: reportError,
        confirm: requestConfirmation,
    });

    function waitForPaletteClosed(): Promise<void> {
        if (!host.palette.open.value) {
            return Promise.resolve();
        }
        return new Promise<void>((resolve) => paletteCloseWaiters.push(resolve));
    }

    /** 确认闸门：从收到请求到 AlertDialog 的 closed 结算前一直非 null；同一时刻只放行一个。 */
    function requestConfirmation(request: CommandConfirmationRequest): Promise<boolean> {
        if (pending.value !== null) {
            return Promise.resolve(false);
        }
        return new Promise<boolean>((resolve) => {
            const entry: PendingConfirmation = {request, decision: "pending", resolve};
            pending.value = entry;
            void (async () => {
                await waitForPaletteClosed();
                if (pending.value === entry) {
                    visible.value = true;
                }
            })();
        });
    }

    function settle(approved: boolean): void {
        const entry = pending.value;
        if (entry === null || entry.decision !== "pending") {
            return;
        }
        entry.decision = approved ? "approved" : "denied";
        visible.value = false;
    }

    /**
     * Reka 的 Action 会先触发 confirm 再发 update:open(false)。把「关闭即拒绝」推迟一个
     * 微任务，显式批准才不会被同一次点击的关闭事件覆盖成拒绝。
     */
    function onOpenChange(open: boolean): void {
        if (!open) {
            queueMicrotask(() => settle(false));
        }
    }

    /** 关闭动画与焦点归还完成后才结算 Promise，注册表里的调用在这之前一直等待。 */
    function onClosed(): void {
        const entry = pending.value;
        if (entry === null) {
            return;
        }
        pending.value = null;
        entry.resolve(entry.decision === "approved");
    }

    watch(host.palette.open, (open) => {
        if (open) {
            return;
        }
        for (const notify of paletteCloseWaiters.splice(0)) {
            notify();
        }
    }, {flush: "sync"});

    const releaseAudit = host.registry.onDidExecuteCommand((event) => {
        emitLabEvent("command", {
            id: event.id,
            requestedId: event.requestedId,
            invocation: event.invocation,
            ok: event.result.ok,
            code: event.result.ok ? null : event.result.code,
            reason: event.result.ok ? null : event.result.reason,
            durationMs: event.durationMs,
        });
        if (!event.result.ok) {
            failure.value = `${event.id}：${event.result.reason}`;
        }
    });

    const releasePaletteCommands = registerPaletteCommands(host, (reason) => {
        failure.value = reason;
        emitLabEvent("command-registration-error", reason);
    });

    let keymap: {handle: (event: KeyboardEvent) => void; dispose: Release} | null = null;
    function onKeydown(event: KeyboardEvent): void {
        // 确认界面开着时不派发面板键：既不打开新面板，也不制造失败审计。
        if (pending.value !== null) {
            return;
        }
        keymap?.handle(event);
    }

    onMounted(() => {
        keymap = createKeymapDispatcher(host.registry, isMacPlatform() ? "mac" : "other", reportError);
        window.addEventListener("keydown", onKeydown, true);
    });

    onBeforeUnmount(() => {
        window.removeEventListener("keydown", onKeydown, true);
        keymap?.dispose();
        keymap = null;
        releaseAudit();
        releasePaletteCommands?.();
        host.closePalette();
        for (const notify of paletteCloseWaiters.splice(0)) {
            notify();
        }
        // 场景卸载同时结算未决确认：注册表里等待的调用不能永远挂着。
        const entry = pending.value;
        pending.value = null;
        visible.value = false;
        entry?.resolve(false);
    });

    const title = computed(() => pending.value === null ? "" : titleOf(pending.value.request.command.titleKey));
    const args = computed(() => pending.value === null ? "" : JSON.stringify(pending.value.request.args));
    const destructive = computed(() => pending.value?.request.command.expose?.hints?.destructive === true);

    return {
        host,
        titleOf,
        failure,
        confirmation: {visible, pending, title, args, destructive, settle, onOpenChange, onClosed},
    };
}

/**
 * 两条面板入口命令：open-commands 是键盘/按钮入口（human=false，不进候选），
 * open-line 只在有行导航能力时可用。任何一条注册失败都先撤掉已注册的，不留半截注册表。
 */
function registerPaletteCommands(host: WorkbenchCommandsHost, fail: (reason: string) => void): Release | null {
    const noArguments = Type.Object({}, {additionalProperties: false});
    const descriptors: CommandDescriptor<TSchema, null>[] = [
        {
            id: "nbook.quick-open.open-commands",
            titleKey: "workbenchCommands.openCommands",
            description: "Open the command palette.",
            argsSchema: noArguments,
            effect: "read",
            defaultKeybinding: "Mod+Shift+P",
            expose: {human: false, agent: "never"},
            run: () => {
                host.openPalette("commands");
                return {ok: true, value: null};
            },
        },
        {
            id: "nbook.quick-open.open-line",
            titleKey: "workbenchCommands.openLine",
            description: "Switch the open command palette to line navigation.",
            argsSchema: noArguments,
            effect: "read",
            when: {requires: ["editor-line-navigation"]},
            expose: {human: true, agent: "never"},
            run: () => {
                host.openPalette("line");
                return {ok: true, value: null};
            },
        },
    ];

    const registered: Release[] = [];
    for (const descriptor of descriptors) {
        const result = host.registry.registerCommand(descriptor);
        if (!result.ok) {
            fail(`面板命令注册失败：${descriptor.id}：${result.reason}`);
            for (const release of registered) {
                release();
            }
            return null;
        }
        registered.push(result.value);
    }
    return () => {
        for (const release of registered.splice(0)) {
            release();
        }
    };
}
