<script setup lang="ts">
/**
 * 命令面板：`host` 状态的受控视图，行为合同见同名 `.md` 与 workbench.quick-open。
 *
 * 一次 accept 只执行一次：记下命令、参数与打开时捕获的目标，关闭面板，等 QuickPick 的 `closed`（焦点已归还）
 * 再执行。先关后执行是为了让命令自己转移的焦点（聚焦编辑器、跳到某行）不被归还焦点夺回。选择模式同理：
 * 选中的结果由宿主在 `closed` 之后才交给发起选择的命令。
 */
import {QuickPick} from "@notnotype/nb-ui/components";
import {computed, onBeforeUnmount, ref, watch} from "vue";

import {currentKeyPlatform, formatKeybinding, runsWithoutArgs} from "nbook/plugins/commands/shared/contracts";
import type {CommandMetadata} from "nbook/plugins/commands/shared/contracts";
import {useText} from "@notnotype/nb-ui/text-port";
import type {TextParams} from "@notnotype/nb-ui/text";

import {otherTexts, parseCommandQuery, parseLineNumber, searchCommands, searchPickItems} from "../../shared/command-query";
import type {PaletteItem} from "../../shared/command-query";

import {sameDocument} from "../commands/palette-host";
import type {DocumentTarget, PaletteHost} from "../commands/palette-host";
import {workbenchText} from "../../shared/text";
import type {WorkbenchTextKey} from "../../shared/text";

/** 快捷键的写法按平台；一次页面里不会变。 */
const KEY_PLATFORM = currentKeyPlatform();

const props = defineProps<{host: PaletteHost}>();

/** 行号模式下的合成候选：不是命令 id，accept 时翻译成 go-to-line 的参数。 */
const LINE_ITEM_ID = "quick-open:line";
const GO_TO_LINE_ID = "nbook.editor.go-to-line";
const OPEN_LINE_ID = "nbook.quick-open.open-line";
const OPEN_COMMANDS_ID = "nbook.quick-open.open-commands";
/** 选择模式里“提交输入的文字”这一项：不是请求里的候选 id。 */
const PICK_TEXT_ID = "quick-pick:text";

const host = props.host;
const resolver = useText();
const activeId = ref<string | null>(null);

/** 面板文案经窗口的翻译端口取：语言变化时打开中的面板随之换文字，输入与选中项不变。 */
function paletteText(key: WorkbenchTextKey, params?: TextParams): string {
    return resolver.t(workbenchText(key, params));
}

interface PendingSelection {
    readonly id: string;
    readonly args: unknown;
    /** 打开面板时捕获的目标；关闭期间换代就作废这次选择。 */
    readonly target: DocumentTarget | null;
}

let pending: PendingSelection | null = null;

const parsedQuery = computed(() => parseCommandQuery(host.query.value));


/** 候选：人类可见、当前可用、不带参数能执行的 canonical 命令（面板不收集参数，docs/specs/workbench/quick-open.md 的“排序”）。可用性读的上下文若是响应式的，变化时这里随之重算。 */
const visibleCommands = computed<readonly CommandMetadata[]>(() => {
    void host.revision.value;
    return host.commands.list().filter((command) => command.expose?.human !== false && runsWithoutArgs(command.args) && host.commands.isEnabled(command.id).ok);
});

interface LineState {
    readonly target: DocumentTarget | null;
    readonly line: number | null;
    readonly message: string;
}

const lineState = computed<LineState>(() => {
    void host.editorRevision.value;
    const captured = host.target.value;
    if (captured === null) return {target: null, line: null, message: paletteText("palette.noEditor")};
    const editor = host.editor.value;
    if (editor === null || !sameDocument(captured, editor.target)) return {target: captured, line: null, message: paletteText("palette.editorGone")};
    if (editor.lineCount === null) return {target: captured, line: null, message: paletteText("palette.lineUnsupported")};
    const total = editor.lineCount();
    if (total === null) return {target: captured, line: null, message: paletteText("palette.editorNotReady")};
    const input = parsedQuery.value.text;
    if (input === "") return {target: captured, line: null, message: paletteText("palette.linePrompt", {max: total})};
    const line = parseLineNumber(input);
    if (line === null) return {target: captured, line: null, message: paletteText("palette.lineInvalid", {text: input})};
    if (line > total) return {target: captured, line: null, message: paletteText("palette.lineOutOfRange", {line, total})};
    return {target: captured, line, message: ""};
});

const items = computed<readonly PaletteItem[]>(() => {
    if (!host.open.value) return [];
    const picking = host.pick.value;
    if (picking !== null) {
        // 选择模式不做前缀路由：输入的就是要匹配或提交的文字。
        const text = host.query.value.trim();
        const shown = picking.items.map((item) => ({
            id: item.id,
            label: resolver.t(item.label),
            ...(item.detail === undefined ? {} : {detail: resolver.t(item.detail)}),
            alternates: [...otherTexts(item.label, resolver), ...(item.detail === undefined ? [] : otherTexts(item.detail, resolver))],
        }));
        const found = searchPickItems(shown, text);
        return picking.text === undefined || text === "" ? found : [...found, {id: PICK_TEXT_ID, label: resolver.t(picking.text.label(text))}];
    }
    if (parsedQuery.value.mode === "line") {
        const state = lineState.value;
        return state.line === null ? [] : [{id: LINE_ITEM_ID, label: paletteText("palette.goToLine", {line: state.line})}];
    }
    return searchCommands(visibleCommands.value, parsedQuery.value.text, host.recent.value, resolver)
        .map((item) => (item.shortcut === undefined ? item : {...item, shortcut: formatKeybinding(item.shortcut, KEY_PLATFORM)}));
});

const emptyText = computed(() => {
    const picking = host.pick.value;
    if (picking !== null) return picking.empty === undefined ? paletteText("palette.pickEmpty") : resolver.t(picking.empty);
    return parsedQuery.value.mode === "line" ? lineState.value.message : paletteText("palette.empty");
});

// 列表变化时保留仍然有效的选中项，失效就选第一项，空列表给 null。
watch(items, (next) => {
    if (activeId.value !== null && next.some((item) => item.id === activeId.value)) return;
    activeId.value = next[0]?.id ?? null;
}, {immediate: true});

function onUpdateOpen(open: boolean): void {
    if (!open) host.closePalette();
}

/** 成功执行的面板选中项进会话 MRU；行号动作与面板入口本身不是“用过的命令”。失败交给宿主告诉用户。 */
async function run(id: string, args: unknown): Promise<void> {
    const result = await host.commands.execute(id, args, {source: "user"});
    if (!result.ok) {
        host.failed(id, result);
        return;
    }
    if (id !== GO_TO_LINE_ID && id !== OPEN_COMMANDS_ID) host.remember(id);
}

function onAccept(id: string): void {
    if (pending !== null) return;
    if (host.pick.value !== null) {
        host.choosePick(id === PICK_TEXT_ID ? {kind: "text", text: host.query.value.trim()} : {kind: "item", id});
        return;
    }
    if (id === LINE_ITEM_ID) {
        const state = lineState.value;
        if (state.target === null || state.line === null) return;
        pending = {id: GO_TO_LINE_ID, args: {target: state.target, line: state.line}, target: state.target};
        host.closePalette();
        return;
    }
    if (id === OPEN_LINE_ID) {
        void run(OPEN_LINE_ID, {});
        return;
    }
    if (!host.commands.get(id).ok) return;
    pending = {id, args: {}, target: host.target.value};
    host.closePalette();
}

function onClosed(): void {
    host.closed();
    const selection = pending;
    pending = null;
    if (selection === null) return;
    // 关闭期间文档换代：这次选择作废，不能拿它去操作后来的编辑器。
    if (selection.target !== null && !sameDocument(selection.target, host.editor.value?.target ?? null)) return;
    void run(selection.id, selection.args);
}

onBeforeUnmount(() => {
    pending = null;
});
</script>

<template>
    <QuickPick
        :open="host.open.value"
        :query="host.query.value"
        :items="items"
        :active-id="activeId"
        :title="host.pick.value === null ? paletteText('palette.title') : resolver.t(host.pick.value.title)"
        :placeholder="host.pick.value === null ? paletteText('palette.placeholder') : resolver.t(host.pick.value.placeholder)"
        :empty-text="emptyText"
        :focus-request="host.focusRequest.value"
        :restore-focus="true"
        @update:open="onUpdateOpen"
        @update:query="(value: string) => { host.query.value = value; }"
        @update:active-id="(value: string | null) => { activeId = value; }"
        @accept="onAccept"
        @closed="onClosed"
    />
</template>
