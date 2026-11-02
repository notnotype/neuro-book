<script setup lang="ts">
/** 资源管理器视图的界面（同名 .md）。 */
import {AlertDialog, Button, ContextMenu, Dialog, Checkbox, Input} from "@notnotype/nb-ui/components";
import type {ContextMenuCloseReason, ContextMenuItem} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";
import {computed, nextTick, ref, watch} from "vue";

import type {DropAction, DropOver} from "../actions/drop";
import type {CollisionChoice} from "../actions/paste-plan";
import type {BatchAction, Dialog as ExplorerDialog, KeyOutcome, Notice, OperationReport, Unknown} from "../controller";
import {nameErrorText} from "../feedback-text";
import type {MenuEntry} from "../menu";
import {useExplorerText} from "../text";
import type {FieldProblem} from "nbook/shared/store/problem";
import type {TreeKey} from "../tree/keys";
import type {MotionNote} from "../tree/motion";
import type {Row} from "../tree/rows";
import type {Modifiers} from "../tree/selection";
import ExplorerFeedback from "./ExplorerFeedback.vue";
import ExplorerTree from "./ExplorerTree.vue";

const props = defineProps<{
    rows: ReadonlyArray<Row>;
    selected: ReadonlyArray<string>;
    focus: string | null;
    ready: boolean;
    notice: Notice | null;
    problem: FieldProblem | null;
    handleKey: (key: TreeKey, page: number) => KeyOutcome;
    /** 项目根显示的作品名（书名，没有时是目录原名）；没有绑定项目时不给。 */
    projectTitle?: string | null;
    editing?: {readonly id: string; readonly name: string; readonly error: string | null; readonly busy: boolean} | null;
    /** 打开着的右键菜单：位置与菜单项。 */
    menu?: {readonly x: number; readonly y: number; readonly entries: ReadonlyArray<MenuEntry>} | null;
    dialog?: ExplorerDialog | null;
    report?: OperationReport | null;
    running?: {readonly action: BatchAction; readonly count: number} | null;
    unknown?: Unknown | null;
    startDrag?: (id: string) => boolean;
    drag?: {readonly sources: ReadonlyArray<string>; readonly action: DropAction} | null;
    /** 最近一次提交的结构变化预告，交给树放动画。 */
    motion?: MotionNote | null;
    /** 每次变化都把焦点放回树上（编辑与确认结束后）。 */
    focusRequest?: number;
    /** 设置的缩进参考线档位；默认 `hover`。 */
    indentGuides?: "none" | "hover" | "always";
    /** 设置“隐藏 Markdown 扩展名”；默认 false。 */
    hideMarkdownExtension?: boolean;
}>();

const port = useText();
const text = useExplorerText();

const emit = defineEmits<{
    (event: "row-press", id: string, modifiers: Modifiers, part: "twisty" | "row"): void;
    (event: "row-activate", id: string): void;
    (event: "row-context", id: string, x: number, y: number): void;
    (event: "retry", address: string): void;
    (event: "reconnect", scheme: "project" | "user"): void;
    (event: "open-project"): void;
    (event: "dismiss-notice"): void;
    (event: "dismiss-report"): void;
    (event: "cancel-running"): void;
    (event: "prefs-retry"): void;
    (event: "prefs-discard"): void;
    (event: "focus-change", focused: boolean): void;
    (event: "edit-input", name: string): void;
    (event: "edit-commit"): void;
    (event: "edit-cancel"): void;
    (event: "menu-command", key: string): void;
    (event: "menu-close"): void;
    (event: "delete-confirm"): void;
    (event: "display-commit", title: string, icon: string): void;
    (event: "dialog-close"): void;
    (event: "collision", choice: CollisionChoice, all: boolean): void;
    (event: "dirty-copy", choice: "save" | "disk" | "cancel"): void;
    (event: "recheck"): void;
    (event: "abandon"): void;
    (event: "drag-hover", over: DropOver | null): void;
    (event: "drag-drop", over: DropOver | null): void;
    (event: "drag-cancel"): void;
    (event: "drag-expand", id: string): void;
}>();

const tree = ref<InstanceType<typeof ExplorerTree> | null>(null);
const focusTree = (): void => {
    void nextTick(() => tree.value?.focus());
};
watch(() => props.focusRequest, focusTree);

const roots = computed(() => props.rows.flatMap((row) => (row.kind === "root" ? [row] : [])));
const unbound = computed(() => roots.value.some((root) => root.status.kind === "unbound"));
const ended = computed(() => roots.value.flatMap((root) => (root.status.kind === "ended" ? [{scheme: root.scheme, reason: root.status.reason}] : [])));

const problemText = computed(() => {
    const problem = props.problem;
    if (problem === null) return "";
    const key = problem.kind === "unread" ? "view.prefsUnread" : problem.kind === "protected" ? "view.prefsProtected" : "view.prefsUnsaved";
    return text(key, {reason: problem.code});
});

const menuItems = computed((): ContextMenuItem[] => (props.menu?.entries ?? []).map((entry) => (entry.kind === "separator"
    ? {separator: true}
    : {
        label: entry.label,
        disabled: entry.disabled,
        tone: entry.danger ? "danger" : "neutral",
        ...(entry.shortcut === null ? {} : {shortcut: entry.shortcut}),
        ...(entry.reason === null ? {} : {title: entry.reason}),
        ...(entry.checked === null ? {} : {type: "checkbox" as const, checked: entry.checked}),
        action: () => emit("menu-command", entry.key),
    })));

const deleteDialog = computed(() => (props.dialog?.kind === "delete" ? props.dialog : null));
const displayDialog = computed(() => (props.dialog?.kind === "display" ? props.dialog : null));
const dirtyCopyDialog = computed(() => (props.dialog?.kind === "dirty-copy" ? props.dialog : null));
const displayTitle = ref("");
const displayIcon = ref("");
watch(displayDialog, (dialog) => {
    if (dialog === null) return;
    displayTitle.value = dialog.title;
    displayIcon.value = dialog.icon;
}, {immediate: true});

const collisionDialog = computed(() => (props.dialog?.kind === "collision" ? props.dialog : null));
const collisionName = ref("");
const collisionAll = ref(false);
// 每次问一项都换成它的候选名；“对其余都这样”只在本次粘贴里有效，换一项时保留勾选。
watch(() => collisionDialog.value?.source, () => {
    if (collisionDialog.value !== null) collisionName.value = collisionDialog.value.candidate;
}, {immediate: true});
watch(() => collisionDialog.value === null, (closed) => {
    if (closed) collisionAll.value = false;
});
const collisionError = computed(() => (collisionDialog.value?.error == null ? "" : nameErrorText(port, collisionDialog.value.error)));

/**
 * 菜单关闭：选择、Escape 与 Tab 让焦点回到树上（菜单项开始的内联输入或对话框随后会再拿走焦点）；外部点击时焦点已随
 * 用户落到被点的地方，不抢回。
 */
const closeMenu = (reason: ContextMenuCloseReason): void => {
    emit("menu-close");
    if (reason !== "outside") focusTree();
};

defineExpose({focusTree});
</script>

<template>
    <div class="grid h-full min-h-0 w-full grid-rows-[auto_minmax(0,1fr)_fit-content(40%)] text-sm" data-explorer-view>
        <div class="min-w-0">
            <div v-if="unbound" class="flex flex-wrap items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)]" data-explorer-unbound>
                <span>{{ text("tree.noProject") }}</span>
                <button type="button" class="nb-ui-focus-ring rounded px-1.5 py-0.5 text-[var(--accent-text)] hover:bg-[var(--bg-hover)]" @click="emit('open-project')">{{ text("view.openProject") }}</button>
            </div>
            <div v-for="root in ended" :key="root.scheme" class="flex flex-wrap items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)]" :data-explorer-ended="root.scheme" role="status">
                <span class="min-w-0 break-words">{{ text("view.ended", {reason: root.reason}) }}</span>
                <button type="button" class="nb-ui-focus-ring rounded px-1.5 py-0.5 text-[var(--accent-text)] hover:bg-[var(--bg-hover)]" @click="emit('reconnect', root.scheme)">{{ text("view.reconnect") }}</button>
            </div>
            <div v-if="problem !== null" class="flex flex-wrap items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)]" data-explorer-problem role="status">
                <span class="min-w-0 break-words">{{ problemText }}</span>
                <button v-if="problem.kind !== 'protected'" type="button" class="nb-ui-focus-ring rounded px-1.5 py-0.5 text-[var(--accent-text)] hover:bg-[var(--bg-hover)]" @click="emit('prefs-retry')">{{ text(problem.kind === "unread" ? "view.reload" : "view.retry") }}</button>
                <button v-if="problem.kind === 'unsaved'" type="button" class="nb-ui-focus-ring rounded px-1.5 py-0.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="emit('prefs-discard')">{{ text("view.discard") }}</button>
            </div>
        </div>
        <ExplorerTree
            v-if="ready"
            ref="tree"
            :rows="rows"
            :selected="selected"
            :focus="focus"
            :label="text('tree.label')"
            :handle-key="handleKey"
            :project-title="projectTitle ?? null"
            :indent-guides="indentGuides ?? 'hover'"
            :hide-markdown-extension="hideMarkdownExtension === true"
            :editing="editing ?? null"
            :start-drag="startDrag"
            :drag="drag ?? null"
            :motion="motion ?? null"
            @row-press="(id, modifiers, part) => emit('row-press', id, modifiers, part)"
            @row-activate="(id) => emit('row-activate', id)"
            @row-context="(id, x, y) => emit('row-context', id, x, y)"
            @retry="(address) => emit('retry', address)"
            @focus-change="(focused) => emit('focus-change', focused)"
            @edit-input="(name) => emit('edit-input', name)"
            @edit-commit="emit('edit-commit')"
            @edit-cancel="emit('edit-cancel')"
            @drag-hover="(over) => emit('drag-hover', over)"
            @drag-drop="(over) => emit('drag-drop', over)"
            @drag-cancel="emit('drag-cancel')"
            @drag-expand="(id) => emit('drag-expand', id)"
        />
        <div v-else role="status" aria-busy="true" class="px-3 py-2 text-xs text-[var(--text-muted)]" data-explorer-loading>{{ text("tree.loading") }}</div>
        <ExplorerFeedback
            :notice="notice"
            :report="report ?? null"
            :running="running ?? null"
            :unknown="unknown ?? null"
            @dismiss="emit('dismiss-notice')"
            @dismiss-report="emit('dismiss-report')"
            @cancel="emit('cancel-running')"
            @recheck="emit('recheck')"
            @abandon="emit('abandon')"
        />
        <ContextMenu :open="menu != null" :x="menu?.x ?? 0" :y="menu?.y ?? 0" :items="menuItems" @request-close="closeMenu" />
        <AlertDialog
            :open="deleteDialog !== null"
            :title="text('dialog.delete.title', {count: deleteDialog?.items.length ?? 0})"
            :confirm-label="text('dialog.delete.confirm')"
            :cancel-label="text('common.cancel')"
            tone="danger"
            @confirm="emit('delete-confirm')"
            @cancel="emit('dialog-close')"
            @closed="focusTree"
        >
            <template #description>
                <p>{{ text("dialog.delete.description") }}</p>
                <ul class="mt-2 max-h-[40vh] overflow-y-auto break-words text-xs" data-explorer-delete-items>
                    <li v-for="item in deleteDialog?.items ?? []" :key="item.address">{{ item.address }}</li>
                </ul>
                <template v-if="(deleteDialog?.unsaved.length ?? 0) > 0">
                    <p class="mt-3 text-[var(--status-danger)]">{{ text("dialog.delete.unsaved") }}</p>
                    <ul class="mt-1 max-h-[20vh] overflow-y-auto break-words text-xs" data-explorer-delete-unsaved>
                        <li v-for="address in deleteDialog?.unsaved ?? []" :key="address">{{ address }}</li>
                    </ul>
                </template>
            </template>
        </AlertDialog>
        <Dialog
            :open="dirtyCopyDialog !== null"
            :title="text('dialog.dirtyCopy.title')"
            size="sm"
            @request-close="emit('dirty-copy', 'cancel')"
        >
            <div class="flex flex-col gap-2 text-sm" data-explorer-dirty-copy>
                <p>{{ text(dirtyCopyDialog?.saveable === false ? "dialog.dirtyCopy.unrepresentable" : "dialog.dirtyCopy.body") }}</p>
                <ul class="max-h-[30vh] overflow-y-auto break-words text-xs">
                    <li v-for="address in dirtyCopyDialog?.documents ?? []" :key="address">{{ address }}</li>
                </ul>
            </div>
            <template #footer>
                <div class="flex flex-wrap justify-end gap-2">
                    <Button variant="ghost" size="sm" data-explorer-dirty-copy-cancel @click="emit('dirty-copy', 'cancel')">{{ text("common.cancel") }}</Button>
                    <Button variant="secondary" size="sm" data-explorer-dirty-copy-disk @click="emit('dirty-copy', 'disk')">{{ text("dialog.dirtyCopy.disk") }}</Button>
                    <Button v-if="dirtyCopyDialog?.saveable !== false" variant="primary" size="sm" data-explorer-dirty-copy-save @click="emit('dirty-copy', 'save')">{{ text("dialog.dirtyCopy.save") }}</Button>
                </div>
            </template>
        </Dialog>
        <Dialog
            :open="displayDialog !== null"
            :title="text('dialog.display.title', {name: displayDialog?.name ?? ''})"
            :busy="displayDialog?.busy === true"
            :show-cancel="true"
            :confirm-label="text('dialog.display.save')"
            :cancel-label="text('common.cancel')"
            size="sm"
            @confirm="emit('display-commit', displayTitle, displayIcon)"
            @request-close="emit('dialog-close')"
        >
            <div class="flex flex-col gap-3 text-sm" data-explorer-display>
                <label class="flex flex-col gap-1">
                    <span class="text-xs text-[var(--text-secondary)]">{{ text("dialog.display.name") }}</span>
                    <Input v-model="displayTitle" size="sm" data-explorer-display-title />
                </label>
                <label class="flex flex-col gap-1">
                    <span class="text-xs text-[var(--text-secondary)]">{{ text("dialog.display.icon") }}</span>
                    <Input v-model="displayIcon" size="sm" data-explorer-display-icon />
                </label>
                <p class="text-xs text-[var(--text-muted)]">{{ text("dialog.display.hint") }}</p>
            </div>
        </Dialog>
        <Dialog
            :open="collisionDialog !== null"
            :title="text('dialog.collision.title')"
            :cancel-label="text('dialog.collision.cancel')"
            size="sm"
            @request-close="emit('dialog-close')"
        >
            <form class="flex flex-col gap-3 text-sm" data-explorer-collision @submit.prevent="emit('collision', {kind: 'rename', name: collisionName}, collisionAll)">
                <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                    <dt class="text-[var(--text-secondary)]">{{ text("dialog.collision.source") }}</dt>
                    <dd class="break-words" data-explorer-collision-source>{{ collisionDialog?.source }}</dd>
                    <dt class="text-[var(--text-secondary)]">{{ text("dialog.collision.target") }}</dt>
                    <dd class="break-words" data-explorer-collision-target>{{ collisionDialog?.target }}</dd>
                </dl>
                <label class="flex flex-col gap-1">
                    <span class="text-xs text-[var(--text-secondary)]">{{ text("dialog.collision.name") }}</span>
                    <Input
                        v-model="collisionName"
                        size="sm"
                        :aria-invalid="collisionError ? 'true' : undefined"
                        :aria-describedby="collisionError ? 'explorer-collision-error' : undefined"
                        data-explorer-collision-name
                    />
                </label>
                <p v-if="collisionError" id="explorer-collision-error" role="alert" class="text-xs text-[var(--status-danger)]">{{ collisionError }}</p>
                <Checkbox v-model="collisionAll" :label="text('dialog.collision.all')" data-explorer-collision-all />
            </form>
            <template #footer>
                <div class="flex flex-wrap justify-end gap-2">
                    <Button variant="ghost" size="sm" data-explorer-collision-cancel @click="emit('collision', {kind: 'cancel'}, false)">{{ text("dialog.collision.cancel") }}</Button>
                    <Button variant="secondary" size="sm" data-explorer-collision-skip @click="emit('collision', {kind: 'skip'}, collisionAll)">{{ text("dialog.collision.skip") }}</Button>
                    <Button variant="primary" size="sm" data-explorer-collision-rename @click="emit('collision', {kind: 'rename', name: collisionName}, collisionAll)">{{ text("dialog.collision.rename") }}</Button>
                </div>
            </template>
        </Dialog>
    </div>
</template>
