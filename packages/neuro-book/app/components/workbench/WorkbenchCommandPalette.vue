<script setup lang="ts">
/**
 * S4 全局命令面板：`host.palette` 状态的受控视图。
 *
 * 它是触发面本身——候选从哪来、查询的含义、执行时机都归宿主；组件只把 QuickInput 的请求
 * 翻译成宿主调用。面板自身不建注册表、不碰 Storage、不读场景。
 *
 * 一次 accept 只执行一次：捕获 id / 参数 / 打开时目标 → 关闭面板 → 等 QuickInput 的 `closed`
 * 到来（焦点已归还）才执行；等待期间重复 accept 忽略，目标换代则作废这次选择。
 */
import {QuickInput} from "@notnotype/nb-ui/components";
import type {QuickInputItem} from "@notnotype/nb-ui/components";
import {computed, onBeforeUnmount, ref, watch} from "vue";
import {matchesEditorDocument, type EditorDocumentTarget} from "nbook/app/components/editor-workbench/editor-view.types";
import type {WorkbenchCommandsHost} from "nbook/app/composables/useWorkbenchCommands";
import type {CommandMetadata} from "nbook/app/utils/workbench/commands";
import {parseCommandQuery, parseLineNumber, searchCommands} from "nbook/app/utils/workbench/command-query";

const props = defineProps<{
    host: WorkbenchCommandsHost;
    /**
     * i18n 解析入口：命令标题与面板文案都走它。带可选 params 以支持「跳转到第 {line} 行」
     * 这类参数化文案；宿主传 `(key) => string` 同样合法（参数会被忽略）。
     */
    titleOf: (key: string, params?: Record<string, unknown>) => string;
}>();

/** 行号模式下的合成候选项：不是命令 id，accept 时翻译成 go-to-line 的参数。 */
const LINE_ITEM_ID = "quick-open:line";
const GO_TO_LINE_ID = "nbook.editor.go-to-line";
const OPEN_LINE_ID = "nbook.quick-open.open-line";
const OPEN_COMMANDS_ID = "nbook.quick-open.open-commands";
/** 会话 MRU 上限：刷新即清空，只影响空查询时的排序 */
const RECENT_LIMIT = 30;

const host = props.host;
const activeId = ref<string | null>(null);

type PendingSelection = Readonly<{
    id: string;
    args: unknown;
    /** 打开面板时捕获的目标；关闭期间换代就作废这次选择 */
    target: EditorDocumentTarget | null;
}>;

const pendingSelection = ref<PendingSelection | null>(null);

function text(key: string, params?: Record<string, unknown>): string {
    return props.titleOf(key, params);
}

const parsedQuery = computed(() => parseCommandQuery(host.palette.query.value));

/** 候选＝human!=false 且当前 when 满足的 canonical 命令；registry / context 变化才重算。 */
const visibleCommands = computed<readonly CommandMetadata[]>(() => {
    void host.revision.value;
    const commands: CommandMetadata[] = [];
    for (const command of host.registry.getAllCommands()) {
        if (command.expose?.human === false) {
            continue;
        }
        const enabled = host.registry.isCommandEnabled(command.id);
        if (!enabled.ok || enabled.value !== true) {
            continue;
        }
        commands.push(command);
    }
    return commands;
});

type LineState = Readonly<{target: EditorDocumentTarget | null; line: number | null; message: string}>;

/** 行号模式的状态：每个正文变更、上下文变化与查询更新都重读一次 getLineCount。 */
const lineState = computed<LineState>(() => {
    void host.editorRevision.value;
    const captured = host.palette.target.value;
    if (captured === null) {
        return {target: null, line: null, message: text("workbenchCommands.palette.noEditor")};
    }
    const binding = host.activeEditor.value;
    if (binding === null || !matchesEditorDocument(captured, binding.target)) {
        return {target: captured, line: null, message: text("workbenchCommands.palette.editorGone")};
    }
    const navigation = binding.handle.navigation;
    if (!navigation) {
        return {target: captured, line: null, message: text("workbenchCommands.palette.lineUnsupported")};
    }
    const total = navigation.getLineCount();
    if (total === null) {
        return {target: captured, line: null, message: text("workbenchCommands.palette.editorNotReady")};
    }
    const input = parsedQuery.value.text;
    if (input === "") {
        return {target: captured, line: null, message: text("workbenchCommands.palette.linePrompt", {max: total})};
    }
    const line = parseLineNumber(input);
    if (line === null) {
        return {target: captured, line: null, message: text("workbenchCommands.palette.lineInvalid", {text: input})};
    }
    if (line > total) {
        return {target: captured, line: null, message: text("workbenchCommands.palette.lineOutOfRange", {line, total})};
    }
    return {target: captured, line, message: ""};
});

const items = computed<readonly QuickInputItem[]>(() => {
    if (!host.palette.open.value) {
        return [];
    }
    const parsed = parsedQuery.value;
    if (parsed.mode === "line") {
        const state = lineState.value;
        if (state.target === null || state.line === null) {
            return [];
        }
        return [{id: LINE_ITEM_ID, label: text("workbenchCommands.palette.goToLine", {line: state.line})}];
    }
    return searchCommands(visibleCommands.value, parsed.text, (key) => props.titleOf(key), host.recentCommandIds.value);
});

const emptyText = computed(() => parsedQuery.value.mode === "line"
    ? lineState.value.message
    : text("workbenchCommands.palette.empty"));

// 列表变化先保留仍然有效的 activeId，失效就选第一个 enabled，空列表给 null
watch(items, (next) => {
    if (activeId.value !== null && next.some((item) => item.id === activeId.value)) {
        return;
    }
    activeId.value = next.find((item) => item.disabled !== true)?.id ?? null;
}, {immediate: true});

function onUpdateOpen(open: boolean): void {
    if (!open) {
        host.closePalette();
    }
}

function onUpdateActiveId(value: string | null): void {
    activeId.value = value;
}

/** 成功执行的面板选中项进会话 MRU；行号动作与面板入口本身不是「用过的命令」。 */
async function runSelection(id: string, args: unknown): Promise<void> {
    const result = await host.registry.executeCommand(id, args);
    if (!result.ok || id === GO_TO_LINE_ID || id === OPEN_COMMANDS_ID) {
        return;
    }
    host.recentCommandIds.value = [id, ...host.recentCommandIds.value.filter((entry) => entry !== id)]
        .slice(0, RECENT_LIMIT);
}

function onAccept(id: string): void {
    if (pendingSelection.value !== null) {
        return;
    }
    if (id === LINE_ITEM_ID) {
        const state = lineState.value;
        if (state.target === null || state.line === null) {
            return;
        }
        pendingSelection.value = {id: GO_TO_LINE_ID, args: {target: state.target, line: state.line}, target: state.target};
        host.closePalette();
        return;
    }
    if (id === OPEN_LINE_ID) {
        // 同层模式切换：面板不关，执行后 query 原位改成「:」，打开时捕获的 target 保留
        void runSelection(OPEN_LINE_ID, {});
        return;
    }
    if (!host.registry.getCommand(id).ok) {
        return;
    }
    pendingSelection.value = {id, args: {}, target: host.palette.target.value};
    host.closePalette();
}

function onClosed(): void {
    const selection = pendingSelection.value;
    pendingSelection.value = null;
    if (selection === null) {
        return;
    }
    // 关闭期间场景/文档换代：这次选择作废，不能拿它去操作后来的编辑器
    if (selection.target !== null && !matchesEditorDocument(selection.target, host.activeEditor.value?.target ?? null)) {
        return;
    }
    void runSelection(selection.id, selection.args);
}

onBeforeUnmount(() => {
    pendingSelection.value = null;
});
</script>

<template>
    <QuickInput
        :open="host.palette.open.value"
        :query="host.palette.query.value"
        :items="items"
        :active-id="activeId"
        :title="text('workbenchCommands.palette.title')"
        :placeholder="text('workbenchCommands.palette.placeholder')"
        :empty-text="emptyText"
        :focus-request="host.palette.focusRequest.value"
        :restore-focus="true"
        @update:open="onUpdateOpen"
        @update:query="(value) => { host.palette.query.value = value; }"
        @update:active-id="onUpdateActiveId"
        @accept="onAccept"
        @closed="onClosed"
    />
</template>
