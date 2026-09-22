/**
 * Workbench 命令宿主：一个 app 实例里的命令注册表 + 上下文键 + 面板状态。
 *
 * 生命周期与 `useWorkbenchChrome` 同形：宿主在 setup 里 provide，子组件 inject。
 * 这里只建立通道与状态，命令由各域自己注册——核心不内置任何业务命令。
 */
import {
    inject,
    onBeforeUnmount,
    provide,
    ref,
    shallowRef,
    watch,
    type InjectionKey,
    type Ref,
    type ShallowRef,
} from "vue";
import {createCommandRegistry, type CommandRegistry, type CommandRegistryOptions} from "nbook/app/utils/workbench/commands";
import type {ContextValues} from "nbook/app/utils/workbench/context-keys";
import type {CommandEditorBinding, EditorDocumentTarget} from "nbook/app/components/editor-workbench/editor-view.types";

export type WorkbenchCommandsHost = Readonly<{
    registry: CommandRegistry;
    /** 宿主事实快照；编辑器能力键由 `activeEditor` 派生，`editor-focus` 由编辑器事件更新。 */
    context: ShallowRef<ContextValues>;
    agentMode: Ref<"normal" | "discuss" | "plan">;
    /** 注册/释放计数：命令列表只在这一事件上重算，不做定时轮询。 */
    revision: Ref<number>;
    activeEditor: ShallowRef<CommandEditorBinding | null>;
    /** 正文变更计数（真实输入与同 identity 的外部更新各自递增）：面板据此重算行数。 */
    editorRevision: Ref<number>;
    recentCommandIds: ShallowRef<readonly string[]>;
    palette: Readonly<{
        open: Ref<boolean>;
        query: Ref<string>;
        target: ShallowRef<EditorDocumentTarget | null>;
        focusRequest: Ref<number>;
    }>;
    allocateEditorGeneration: () => number;
    openPalette: (mode: "commands" | "line") => void;
    closePalette: () => void;
}>;

const WORKBENCH_COMMANDS_KEY: InjectionKey<WorkbenchCommandsHost> = Symbol("nbook.workbench-commands");

export function provideWorkbenchCommands(options: {
    development: boolean;
    report: (error: Error) => void;
    confirm?: CommandRegistryOptions["confirm"];
}): WorkbenchCommandsHost {
    const context = shallowRef<ContextValues>({});
    const agentMode = ref<"normal" | "discuss" | "plan">("normal");
    const revision = ref(0);
    const activeEditor = shallowRef<CommandEditorBinding | null>(null);
    const editorRevision = ref(0);
    const recentCommandIds = shallowRef<readonly string[]>([]);
    const palette = {
        open: ref(false),
        query: ref(""),
        target: shallowRef<EditorDocumentTarget | null>(null),
        focusRequest: ref(0),
    };

    const registry = createCommandRegistry({
        context: () => context.value,
        agentMode: () => agentMode.value,
        development: options.development,
        report: options.report,
        confirm: options.confirm,
    });
    const releaseRevision = registry.onDidChange(() => {
        revision.value += 1;
    });

    const patchContext = (patch: ContextValues): void => {
        context.value = {...context.value, ...patch};
    };

    // 同步 flush：命令可用性马上要读到派生键，不能等到下一轮渲染才更新。
    watch(activeEditor, (binding) => {
        patchContext({
            "editor-active": binding !== null,
            "editor-writable": binding !== null && !binding.readonly,
            "editor-line-navigation": binding?.handle.navigation !== undefined,
        });
    }, {immediate: true, flush: "sync"});

    let lastEditorGeneration = 0;

    const host: WorkbenchCommandsHost = {
        registry,
        context,
        agentMode,
        revision,
        activeEditor,
        editorRevision,
        recentCommandIds,
        palette,
        allocateEditorGeneration(): number {
            lastEditorGeneration += 1;
            return lastEditorGeneration;
        },
        openPalette(mode): void {
            if (!palette.open.value) {
                // 第一次打开才捕获目标值副本：面板打开期间切换文档不改变已捕获的指向。
                palette.target.value = activeEditor.value === null ? null : {...activeEditor.value.target};
                palette.query.value = mode === "line" ? ":" : ">";
                palette.open.value = true;
            } else if (mode === "line") {
                palette.query.value = ":";
            } else {
                palette.focusRequest.value += 1;
            }
            patchContext({"quick-open-visible": true});
        },
        closePalette(): void {
            palette.open.value = false;
            palette.query.value = "";
            palette.target.value = null;
            patchContext({"quick-open-visible": false});
        },
    };

    provide(WORKBENCH_COMMANDS_KEY, host);
    onBeforeUnmount(() => {
        releaseRevision();
        activeEditor.value = null;
        host.closePalette();
    });
    return host;
}

export function useWorkbenchCommands(): WorkbenchCommandsHost {
    const host = inject(WORKBENCH_COMMANDS_KEY);
    if (!host) {
        throw new Error("Workbench Commands 尚未由宿主提供。");
    }
    return host;
}
