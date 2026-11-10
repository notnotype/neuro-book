<script setup lang="ts">
/** 源码编辑器正文的右键菜单（同名 .md）。 */
import {ContextMenu} from "@notnotype/nb-ui/components";
import type {ContextMenuItem} from "@notnotype/nb-ui/components";
import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import {computed, inject, onBeforeUnmount, ref, shallowRef, watch} from "vue";

import {EDITOR_CODE_CONTEXT_POINT, editorMenusKey} from "../../shared/contracts";
import {codeMenuSections, codeMenuSnapshot, runCodeMenuItem} from "../code/context-menu";
import type {CodeMenuItem, CodeMenuSnapshot} from "../code/context-menu";
import type {MonacoApi} from "../code/load-monaco";

const props = defineProps<{
    monaco: MonacoApi | null;
    editor: Monaco.editor.IStandaloneCodeEditor | null;
    host: HTMLElement | null;
    readonly: boolean;
    binding: string | null;
    visible: boolean;
}>();

/** 编辑器区给的菜单；Lab 与组件测试里直接挂控件时没有，这时不出菜单（同 Markdown 控件）。 */
const menus = inject(editorMenusKey, null);

const open = ref(false);
const at = ref({x: 0, y: 0});
/** 打开那一刻的状态；菜单开着期间不重算（有的条件含“文字区有焦点”，菜单开着时为假）。 */
const snapshot = shallowRef<CodeMenuSnapshot | null>(null);

function show(editor: Monaco.editor.IStandaloneCodeEditor, x: number, y: number): void {
    snapshot.value = codeMenuSnapshot(editor, props.readonly);
    at.value = {x, y};
    open.value = true;
}

/** 在光标处打开（键盘）：光标可能滚出了可见区，先滚回来、让 Monaco 画完这一帧，位置才量得到。 */
function showAtCursor(editor: Monaco.editor.IStandaloneCodeEditor): void {
    const position = editor.getPosition();
    const node = editor.getDomNode();
    if (position === null || node === null) return;
    editor.focus();
    editor.revealPosition(position, 1 satisfies Monaco.editor.ScrollType.Immediate);
    editor.render();
    const spot = editor.getScrolledVisiblePosition(position);
    if (spot === null) return;
    const box = node.getBoundingClientRect();
    show(editor, box.left + spot.left, box.top + spot.top + spot.height);
}

/**
 * 捕获阶段处理，并在处理过的事件上 `stopPropagation`：关掉自带菜单之后 Monaco 仍留着一段处理，它只看主选区（会把多选区
 * 收成一个光标），不分点在哪（右击滚动条、查找框也移光标、抢焦点）。
 */
const onContextMenu = (event: MouseEvent): void => {
    const {editor, monaco} = props;
    if (editor === null || monaco === null || menus === null) return;
    // 不是鼠标右键：菜单键在有的平台上只发这个事件。焦点在文字区才归这里（在查找框里按菜单键是浏览器的事）。
    if (event.button !== 2) {
        if (!editor.hasTextFocus()) return;
        event.preventDefault();
        event.stopPropagation();
        showAtCursor(editor);
        return;
    }
    const target = editor.getTargetAtClientPoint(event.clientX, event.clientY);
    const kinds = monaco.editor.MouseTargetType;
    if (target === null) return;
    // Monaco 自己的浮层（查找与替换的输入框）：留给浏览器，输入框里要能粘贴。仍要拦住 Monaco 那段处理，否则它把焦点
    // 从输入框抢回正文。
    if (target.type === kinds.OVERLAY_WIDGET || target.type === kinds.CONTENT_WIDGET) {
        event.stopPropagation();
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (target.type === kinds.SCROLLBAR || target.type === kinds.OVERVIEW_RULER) return;
    // 聚焦让这一组成为活动组：贡献项的“当前文件”按活动组的活动标签取。
    editor.focus();
    const position = target.position;
    if (position !== null && !(editor.getSelections() ?? []).some((selection) => selection.containsPosition(position))) editor.setPosition(position);
    show(editor, event.clientX, event.clientY);
};

let detachHost: (() => void) | null = null;
watch(() => props.host, (host) => {
    detachHost?.();
    detachHost = null;
    if (host === null) return;
    host.addEventListener("contextmenu", onContextMenu, true);
    detachHost = () => host.removeEventListener("contextmenu", onContextMenu, true);
}, {immediate: true});

let detachEditor: (() => void) | null = null;
watch(() => [props.editor, props.monaco] as const, ([editor, monaco]) => {
    detachEditor?.();
    detachEditor = null;
    if (editor === null || monaco === null || menus === null) return;
    const keys = monaco.KeyCode;
    const listeners = [
        // 这里的监听先于 Monaco 的键位分发：拦下之后它绑在 Shift+F10 上的“显示菜单”不再吃这次按键。
        editor.onKeyDown((event) => {
            if (event.keyCode !== keys.ContextMenu && !(event.shiftKey && event.keyCode === keys.F10)) return;
            event.preventDefault();
            event.stopPropagation();
            showAtCursor(editor);
        }),
        // 菜单的位置是打开时量的：正文一滚它就指着别处了。
        editor.onDidScrollChange(() => {
            open.value = false;
        }),
    ];
    detachEditor = () => {
        for (const listener of listeners) listener.dispose();
    };
}, {immediate: true});

onBeforeUnmount(() => {
    detachHost?.();
    detachEditor?.();
});
watch(() => [props.binding, props.visible] as const, () => {
    open.value = false;
});

function run(item: CodeMenuItem): void {
    const editor = props.editor;
    if (editor === null) return;
    void runCodeMenuItem(editor, item.run, navigator.clipboard).then((failure) => {
        if (failure !== null) menus?.notify(failure);
    }).catch((error: unknown) => menus?.reportError(error));
}

const items = computed<ContextMenuItem[]>(() => {
    const state = snapshot.value;
    if (state === null || menus === null) return [];
    const builtin = codeMenuSections(state).map((section) => section.map((item): ContextMenuItem => ({
        label: menus.label(item.id),
        ...(item.icon === undefined ? {} : {iconClass: item.icon}),
        ...(item.keybinding === undefined ? {} : {shortcut: menus.keyLabel(item.keybinding)}),
        action: () => run(item),
    })));
    const contributed = state.readonly ? [] : menus.contributed(EDITOR_CODE_CONTEXT_POINT).map((section) => section.map((entry): ContextMenuItem => ({
        label: entry.label,
        ...(entry.icon === null ? {} : {iconClass: entry.icon}),
        disabled: !entry.enabled,
        action: () => menus.runContributed(EDITOR_CODE_CONTEXT_POINT, entry.id),
    })));
    return [...builtin, ...contributed].flatMap((section, index): ContextMenuItem[] => (index === 0 ? section : [{separator: true}, ...section]));
});

function onRequestClose(reason: string): void {
    // 选了一项或按 Esc：焦点回正文。点外面时焦点已随用户落到别处，不抢回。
    if (reason !== "outside") props.editor?.focus();
}
</script>

<template>
    <ContextMenu :open="open" :x="at.x" :y="at.y" :items="items" @update:open="(next: boolean) => { open = next; }" @request-close="onRequestClose" />
</template>
