<script setup lang="ts">
/**
 * 命令面板：`host` 状态的受控视图，行为合同见同名 `.md` 与 workbench.quick-open。
 *
 * 一次 accept 只执行一次：记下命令、参数与打开时捕获的目标，关闭面板，等 QuickInput 的 `closed`（焦点已归还）
 * 再执行。先关后执行是为了让命令自己转移的焦点（聚焦编辑器、跳到某行）不被归还焦点夺回。选择模式同理：
 * 选中的结果由宿主在 `closed` 之后才交给发起选择的命令。
 */
import {QuickInput} from "@notnotype/nb-ui/components";
import {computed, onBeforeUnmount, ref, watch} from "vue";

import type {CommandMetadata} from "nbook/plugins/commands/shared/contracts";
import {textOf} from "nbook/shared/localized-text";

import {otherTexts, parseCommandQuery, parseLineNumber, searchCommands, searchPickItems} from "../commands/command-query";
import type {PaletteItem} from "../commands/command-query";
import {sameDocument} from "../commands/palette-host";
import type {DocumentTarget, PaletteHost} from "../commands/palette-host";
import {paletteText as messageOf} from "../commands/palette-messages";
import type {PaletteMessage} from "../commands/palette-messages";

const props = defineProps<{host: PaletteHost}>();

/** 行号模式下的合成候选：不是命令 id，accept 时翻译成 go-to-line 的参数。 */
const LINE_ITEM_ID = "quick-open:line";
const GO_TO_LINE_ID = "nbook.editor.go-to-line";
const OPEN_LINE_ID = "nbook.quick-open.open-line";
const OPEN_COMMANDS_ID = "nbook.quick-open.open-commands";
/** 选择模式里“提交输入的文字”这一项：不是请求里的候选 id。 */
const PICK_TEXT_ID = "quick-pick:text";

const host = props.host;
const activeId = ref<string | null>(null);

/** 面板文案按宿主给的显示语言取：语言变化时打开中的面板随之换文字，输入与选中项不变。 */
function paletteText(key: PaletteMessage, params: Readonly<Record<string, string | number>> = {}): string {
    return messageOf(host.locale.value, key, params);
}

interface PendingSelection {
    readonly id: string;
    readonly args: unknown;
    /** 打开面板时捕获的目标；关闭期间换代就作废这次选择。 */
    readonly target: DocumentTarget | null;
}

let pending: PendingSelection | null = null;

const parsedQuery = computed(() => parseCommandQuery(host.query.value));

/** 候选：人类可见且当前可用的 canonical 命令。可用性读的上下文若是响应式的，变化时这里随之重算。 */
const visibleCommands = computed<readonly CommandMetadata[]>(() => {
    void host.revision.value;
    return host.commands.list().filter((command) => command.expose?.human !== false && host.commands.isEnabled(command.id).ok);
});

interface LineState {
    readonly target: DocumentTarget | null;
    readonly line: number | null;
    readonly message: string;
}

const lineState = computed<LineState>(() => {
    void host.editorRevision.value;
    const captured = host.target.value;
    if (captured === null) return {target: null, line: null, message: paletteText("noEditor")};
    const editor = host.editor.value;
    if (editor === null || !sameDocument(captured, editor.target)) return {target: captured, line: null, message: paletteText("editorGone")};
    if (editor.lineCount === null) return {target: captured, line: null, message: paletteText("lineUnsupported")};
    const total = editor.lineCount();
    if (total === null) return {target: captured, line: null, message: paletteText("editorNotReady")};
    const input = parsedQuery.value.text;
    if (input === "") return {target: captured, line: null, message: paletteText("linePrompt", {max: total})};
    const line = parseLineNumber(input);
    if (line === null) return {target: captured, line: null, message: paletteText("lineInvalid", {text: input})};
    if (line > total) return {target: captured, line: null, message: paletteText("lineOutOfRange", {line, total})};
    return {target: captured, line, message: ""};
});

const items = computed<readonly PaletteItem[]>(() => {
    if (!host.open.value) return [];
    const picking = host.pick.value;
    if (picking !== null) {
        // 选择模式不做前缀路由：输入的就是要匹配或提交的文字。
        const text = host.query.value.trim();
        const locale = host.locale.value;
        const shown = picking.items.map((item) => ({
            id: item.id,
            label: textOf(item.label, locale),
            ...(item.detail === undefined ? {} : {detail: textOf(item.detail, locale)}),
            alternates: [...otherTexts(item.label, locale), ...(item.detail === undefined ? [] : otherTexts(item.detail, locale))],
        }));
        const found = searchPickItems(shown, text);
        return picking.text === undefined || text === "" ? found : [...found, {id: PICK_TEXT_ID, label: textOf(picking.text.label(text), locale)}];
    }
    if (parsedQuery.value.mode === "line") {
        const state = lineState.value;
        return state.line === null ? [] : [{id: LINE_ITEM_ID, label: paletteText("goToLine", {line: state.line})}];
    }
    return searchCommands(visibleCommands.value, parsedQuery.value.text, host.recent.value, host.locale.value);
});

const emptyText = computed(() => {
    const picking = host.pick.value;
    if (picking !== null) return picking.empty === undefined ? paletteText("pickEmpty") : textOf(picking.empty, host.locale.value);
    return parsedQuery.value.mode === "line" ? lineState.value.message : paletteText("empty");
});

// 列表变化时保留仍然有效的选中项，失效就选第一项，空列表给 null。
watch(items, (next) => {
    if (activeId.value !== null && next.some((item) => item.id === activeId.value)) return;
    activeId.value = next[0]?.id ?? null;
}, {immediate: true});

function onUpdateOpen(open: boolean): void {
    if (!open) host.closePalette();
}

/** 成功执行的面板选中项进会话 MRU；行号动作与面板入口本身不是“用过的命令”。 */
async function run(id: string, args: unknown): Promise<void> {
    const result = await host.commands.execute(id, args, {source: "user"});
    if (result.ok && id !== GO_TO_LINE_ID && id !== OPEN_COMMANDS_ID) host.remember(id);
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
    <QuickInput
        :open="host.open.value"
        :query="host.query.value"
        :items="items"
        :active-id="activeId"
        :title="host.pick.value === null ? paletteText('title') : textOf(host.pick.value.title, host.locale.value)"
        :placeholder="host.pick.value === null ? paletteText('placeholder') : textOf(host.pick.value.placeholder, host.locale.value)"
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
