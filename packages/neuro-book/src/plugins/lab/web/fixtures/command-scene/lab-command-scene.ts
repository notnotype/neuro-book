/**
 * 命令类场景的局部宿主：本地命令表、面板宿主、面板入口命令、键位分发与确认闸门都跟着当前 fixture 实例走
 * （ui.component-lab 场景 16）。
 *
 * Lab 外壳不持有命令宿主。Lab 按“组件:场景”重挂 fixture，这里建的宿主因此与场景同寿：切场景时键位监听、
 * 面板、未决确认与命令表一起释放，不会漏到下一个场景，也不会让别的组件场景响应命令快捷键。
 *
 * 执行审计转成 Lab 的 `command` 事件（事件 tab 可见），失败另写入 `failure`，由命令检视区唯一的 `role="alert"`
 * 显示。这里不写任何偏好或存储。
 */

import {Type} from "typebox";
import {computed, onBeforeUnmount, onMounted, ref, shallowRef, watch} from "vue";
import type {ComputedRef, Ref, ShallowRef} from "vue";

import {DISPLAY_LOCALE, localize} from "nbook/shared/localized-text";
import {contextTable} from "nbook/plugins/commands/shared/context-keys";
import type {ContextValues} from "nbook/plugins/commands/shared/context-keys";
import type {AgentMode, Release} from "nbook/plugins/commands/shared/contracts";
import {createCommandRegistry} from "nbook/plugins/commands/shared/registry";
import type {CommandConfirmationRequest, CommandDefinition, CommandRegistry} from "nbook/plugins/commands/shared/registry";
import {createKeymapDispatcher, currentKeyPlatform} from "nbook/plugins/workbench/web/commands/keymap";
import type {KeymapDispatcher} from "nbook/plugins/workbench/web/commands/keymap";
import {createPaletteHost} from "nbook/plugins/workbench/web/commands/palette-host";
import type {PaletteHost} from "nbook/plugins/workbench/web/commands/palette-host";

import {useLabEventSink} from "../../lab-event-sink";
import type {CommandEditorBinding} from "./editor-binding";
import {LAB_CONTEXT_KEYS} from "./lab-context-keys";

interface PendingConfirmation {
    readonly request: CommandConfirmationRequest;
    decision: "pending" | "approved" | "denied";
    readonly resolve: (approved: boolean) => void;
}

export interface LabCommandConfirmation {
    readonly visible: Ref<boolean>;
    readonly pending: ShallowRef<PendingConfirmation | null>;
    readonly title: ComputedRef<string>;
    readonly args: ComputedRef<string>;
    readonly destructive: ComputedRef<boolean>;
    settle(approved: boolean): void;
    onOpenChange(open: boolean): void;
    onClosed(): void;
}

export interface LabCommandScene {
    readonly registry: CommandRegistry;
    readonly palette: PaletteHost;
    /** 本场景的上下文快照；编辑器四个键由 `activeEditor` 派生，`editor-focus` 由编辑器事件更新。 */
    readonly context: ShallowRef<ContextValues>;
    readonly agentMode: Ref<AgentMode>;
    /** 当前活动编辑器；样板编辑器就绪时写入，卸载或换代时清空。 */
    readonly activeEditor: ShallowRef<CommandEditorBinding | null>;
    /** 最近一次命令失败（登记被拒或执行失败）；空串表示没有待看的失败。 */
    readonly failure: Ref<string>;
    readonly confirmation: LabCommandConfirmation;
    patchContext(patch: ContextValues): void;
}

const SOURCE = "nbook.lab";
const NO_ARGS = Type.Object({}, {additionalProperties: false});

export function useLabCommandScene(): LabCommandScene {
    const emitLabEvent = useLabEventSink();
    const failure = ref("");
    const context = shallowRef<ContextValues>({});
    const agentMode = ref<AgentMode>("normal");
    const activeEditor = shallowRef<CommandEditorBinding | null>(null);
    const visible = ref(false);
    const pending = shallowRef<PendingConfirmation | null>(null);
    /** 面板开着时到达的确认请求要等面板真正关闭再显示；面板关闭或场景卸载时逐个唤醒。 */
    const paletteCloseWaiters: Array<() => void> = [];

    const patchContext = (patch: ContextValues): void => {
        context.value = {...context.value, ...patch};
    };
    const reportError = (error: Error): void => {
        failure.value = error.message;
        emitLabEvent("command-error", error.message);
    };

    const registry = createCommandRegistry({
        contextKeys: contextTable(LAB_CONTEXT_KEYS, () => context.value),
        agentMode: () => agentMode.value,
        confirm: requestConfirmation,
        report: reportError,
    });
    const palette = createPaletteHost({commands: registry, onVisibleChange: (open) => patchContext({"quick-open-visible": open})});

    // 同步派生：命令可用性马上要读到这几个键，不能等下一轮渲染。
    watch(activeEditor, (binding) => {
        patchContext({
            "editor-active": binding !== null,
            "editor-writable": binding !== null && !binding.readonly,
            "editor-line-navigation": binding?.handle.navigation !== undefined,
        });
        const navigation = binding?.handle.navigation;
        palette.editor.value = binding === null ? null : {target: binding.target, lineCount: navigation === undefined ? null : () => navigation.getLineCount()};
    }, {immediate: true, flush: "sync"});

    function waitForPaletteClosed(): Promise<void> {
        if (!palette.open.value) return Promise.resolve();
        return new Promise<void>((resolve) => paletteCloseWaiters.push(resolve));
    }

    /** 确认闸门：从收到请求到确认框 closed 结算前一直非 null；同一时刻只放行一个，其余直接拒绝。 */
    function requestConfirmation(request: CommandConfirmationRequest): Promise<boolean> {
        if (pending.value !== null) return Promise.resolve(false);
        return new Promise<boolean>((resolve) => {
            const entry: PendingConfirmation = {request, decision: "pending", resolve};
            pending.value = entry;
            void waitForPaletteClosed().then(() => {
                if (pending.value === entry) visible.value = true;
            });
        });
    }

    function settle(approved: boolean): void {
        const entry = pending.value;
        if (entry === null || entry.decision !== "pending") return;
        entry.decision = approved ? "approved" : "denied";
        visible.value = false;
    }

    /** Reka 的确认按钮先发 confirm 再发 update:open(false)：“关闭即拒绝”推迟一个微任务，显式批准才不会被同一次点击覆盖。 */
    function onOpenChange(open: boolean): void {
        if (!open) queueMicrotask(() => settle(false));
    }

    /** 关闭完成、焦点归还后才结算：命令表里的调用在这之前一直等待。 */
    function onClosed(): void {
        const entry = pending.value;
        if (entry === null) return;
        pending.value = null;
        entry.resolve(entry.decision === "approved");
    }

    watch(palette.open, (open) => {
        if (!open) for (const wake of paletteCloseWaiters.splice(0)) wake();
    }, {flush: "sync"});

    const releaseAudit = registry.onDidExecute((event) => {
        emitLabEvent("command", {
            id: event.id,
            requestedId: event.requestedId,
            invocation: event.invocation,
            ok: event.result.ok,
            code: event.result.ok ? null : event.result.code,
            reason: event.result.ok ? null : event.result.reason,
            durationMs: event.durationMs,
        });
        if (!event.result.ok) failure.value = `${event.id}：${event.result.reason}`;
    });

    const releasePaletteCommands = registerPaletteCommands(registry, palette, (reason) => {
        failure.value = reason;
        emitLabEvent("command-registration-error", reason);
    });

    let keymap: KeymapDispatcher | null = null;
    function onKeydown(event: KeyboardEvent): void {
        // 确认框开着时不分发：既不打开新面板，也不制造失败审计。
        if (pending.value === null) keymap?.handle(event);
    }

    onMounted(() => {
        keymap = createKeymapDispatcher(registry, currentKeyPlatform(), reportError);
        window.addEventListener("keydown", onKeydown, true);
    });

    onBeforeUnmount(() => {
        window.removeEventListener("keydown", onKeydown, true);
        keymap?.dispose();
        keymap = null;
        releaseAudit();
        releasePaletteCommands?.();
        palette.dispose();
        for (const wake of paletteCloseWaiters.splice(0)) wake();
        // 场景卸载时结算未决确认：命令表里等待的调用不能永远挂着。
        const entry = pending.value;
        pending.value = null;
        visible.value = false;
        entry?.resolve(false);
    });

    const title = computed(() => (pending.value === null ? "" : localize(pending.value.request.command.title, DISPLAY_LOCALE)));
    const args = computed(() => (pending.value === null ? "" : JSON.stringify(pending.value.request.args)));
    const destructive = computed(() => pending.value?.request.command.expose?.hints?.destructive === true);

    return {
        registry,
        palette,
        context,
        agentMode,
        activeEditor,
        failure,
        confirmation: {visible, pending, title, args, destructive, settle, onOpenChange, onClosed},
        patchContext,
    };
}

/**
 * 两条面板入口命令：open-commands 是键盘与按钮入口（不进候选），open-line 只在有行号导航时可用。
 * 产品里前者由工作台贡献、后者随编辑器插件接入；这里由场景代为登记。任何一条失败就撤掉已登记的。
 */
function registerPaletteCommands(registry: CommandRegistry, palette: PaletteHost, fail: (reason: string) => void): Release | null {
    const definitions: CommandDefinition[] = [
        {
            id: "nbook.quick-open.open-commands",
            source: SOURCE,
            declaration: {title: {"zh-CN": "命令面板", "en-US": "Command Palette"}, description: "Open the command palette.", args: NO_ARGS, effect: "read", keybinding: "Mod+Shift+P", expose: {human: false, agent: "never"}},
            run: () => {
                palette.openPalette("commands");
                return {ok: true, value: null};
            },
        },
        {
            id: "nbook.quick-open.open-line",
            source: SOURCE,
            declaration: {title: {"zh-CN": "跳转到行…", "en-US": "Go to Line…"}, description: "Switch the open command palette to line navigation.", args: NO_ARGS, effect: "read", when: {requires: ["editor-line-navigation"]}, expose: {agent: "never"}},
            run: () => {
                palette.openPalette("line");
                return {ok: true, value: null};
            },
        },
    ];
    const registered: Release[] = [];
    for (const definition of definitions) {
        const result = registry.register(definition);
        if (!result.ok) {
            fail(`面板命令登记失败：${definition.id}：${result.reason}`);
            for (const release of registered) release();
            return null;
        }
        registered.push(result.value);
    }
    return () => {
        for (const release of registered.splice(0)) release();
    };
}
