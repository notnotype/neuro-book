<script setup lang="ts">
/** 资源管理器视图的界面（同名 .md）。 */
import {AlertDialog, Button, ContextMenu, Dialog, FormCheckbox, FormInput, IconButton, Toolbar} from "@notnotype/nb-ui/components";
import type {ContextMenuCloseReason, ContextMenuItem} from "@notnotype/nb-ui/components";
import {computed, nextTick, ref, watch} from "vue";

import type {DisplayLocale} from "nbook/shared/localized-text";

import type {DropAction, DropZone} from "../actions/drop";
import type {CollisionChoice} from "../actions/paste-plan";
import type {BatchAction, Dialog as ExplorerDialog, KeyOutcome, Notice, OperationReport, Unknown} from "../controller";
import {nameErrorText} from "../feedback-text";
import type {MenuEntry} from "../menu";
import {explorerText} from "../messages";
import type {PreferenceProblem} from "../preferences";
import type {TreeKey} from "../tree/keys";
import type {Row} from "../tree/rows";
import type {Modifiers} from "../tree/selection";
import ExplorerFeedback from "./ExplorerFeedback.vue";
import ExplorerTree from "./ExplorerTree.vue";

type ToolbarAction = "new-file" | "new-folder" | "refresh" | "collapse-all" | "toggle-manifests";

const props = defineProps<{
    locale: DisplayLocale;
    rows: ReadonlyArray<Row>;
    selected: ReadonlyArray<string>;
    focus: string | null;
    showManifests: boolean;
    ready: boolean;
    notice: Notice | null;
    problem: PreferenceProblem | null;
    handleKey: (key: TreeKey, page: number) => KeyOutcome;
    /** 新建工具按钮是否可用；默认 false。 */
    canCreate?: boolean;
    editing?: {readonly id: string; readonly name: string; readonly error: string | null; readonly busy: boolean} | null;
    /** 打开着的右键菜单：位置与菜单项。 */
    menu?: {readonly x: number; readonly y: number; readonly entries: ReadonlyArray<MenuEntry>} | null;
    dialog?: ExplorerDialog | null;
    report?: OperationReport | null;
    running?: {readonly action: BatchAction; readonly count: number} | null;
    unknown?: Unknown | null;
    startDrag?: (id: string) => boolean;
    drag?: {readonly action: DropAction} | null;
    /** 每次变化都把焦点放回树上（编辑与确认结束后）。 */
    focusRequest?: number;
}>();

const emit = defineEmits<{
    (event: "toolbar", action: ToolbarAction): void;
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
    (event: "menu-command", command: string): void;
    (event: "menu-close"): void;
    (event: "delete-confirm"): void;
    (event: "display-commit", title: string, icon: string): void;
    (event: "dialog-close"): void;
    (event: "collision", choice: CollisionChoice, all: boolean): void;
    (event: "dirty-copy", choice: "save" | "disk" | "cancel"): void;
    (event: "recheck"): void;
    (event: "abandon"): void;
    (event: "drag-hover", over: {readonly id: string; readonly zone: DropZone} | null): void;
    (event: "drag-drop", over: {readonly id: string; readonly zone: DropZone} | null): void;
    (event: "drag-cancel"): void;
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
    const key = problem.kind === "unread" ? "prefsUnread" : problem.kind === "protected" ? "prefsProtected" : "prefsUnsaved";
    return explorerText(props.locale, key, {reason: problem.code});
});

const tools = computed(() => [
    {action: "new-file" as const, icon: "i-lucide-file-plus", label: explorerText(props.locale, "newFile"), pressed: undefined, enabled: props.canCreate === true},
    {action: "new-folder" as const, icon: "i-lucide-folder-plus", label: explorerText(props.locale, "newFolder"), pressed: undefined, enabled: props.canCreate === true},
    {action: "refresh" as const, icon: "i-lucide-refresh-cw", label: explorerText(props.locale, "refresh"), pressed: undefined, enabled: true},
    {action: "collapse-all" as const, icon: "i-lucide-copy-minus", label: explorerText(props.locale, "collapseAll"), pressed: undefined, enabled: true},
    {action: "toggle-manifests" as const, icon: "i-lucide-file-code", label: explorerText(props.locale, "showManifests"), pressed: props.showManifests, enabled: true},
]);

const menuItems = computed((): ContextMenuItem[] => (props.menu?.entries ?? []).map((entry) => (entry.kind === "separator"
    ? {separator: true}
    : {label: entry.label, disabled: entry.disabled, tone: entry.danger ? "danger" : "default", ...(entry.shortcut === null ? {} : {shortcut: entry.shortcut}), action: () => emit("menu-command", entry.command)})));

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
const collisionError = computed(() => (collisionDialog.value?.error == null ? "" : nameErrorText(props.locale, collisionDialog.value.error)));

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
    <div class="grid h-full min-h-0 w-full grid-rows-[auto_auto_minmax(0,1fr)_fit-content(40%)] text-sm" data-explorer-view>
        <Toolbar :aria-label="explorerText(locale, 'title')" class="flex items-center justify-end gap-0.5 px-2 py-1">
            <IconButton
                v-for="tool in tools"
                :key="tool.action"
                size="sm"
                :icon-class="tool.icon"
                :aria-label="tool.label"
                :title="tool.label"
                :aria-pressed="tool.pressed"
                :disabled="!ready || !tool.enabled"
                :data-explorer-tool="tool.action"
                @click="emit('toolbar', tool.action)"
            />
        </Toolbar>
        <div class="min-w-0">
            <div v-if="unbound" class="flex flex-wrap items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)]" data-explorer-unbound>
                <span>{{ explorerText(locale, "noProject") }}</span>
                <button type="button" class="nb-ui-focus-ring rounded px-1.5 py-0.5 text-[var(--accent-text)] hover:bg-[var(--bg-hover)]" @click="emit('open-project')">{{ explorerText(locale, "openProject") }}</button>
            </div>
            <div v-for="root in ended" :key="root.scheme" class="flex flex-wrap items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)]" :data-explorer-ended="root.scheme" role="status">
                <span class="min-w-0 break-words">{{ explorerText(locale, "ended", {reason: root.reason}) }}</span>
                <button type="button" class="nb-ui-focus-ring rounded px-1.5 py-0.5 text-[var(--accent-text)] hover:bg-[var(--bg-hover)]" @click="emit('reconnect', root.scheme)">{{ explorerText(locale, "reconnect") }}</button>
            </div>
            <div v-if="problem !== null" class="flex flex-wrap items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)]" data-explorer-problem role="status">
                <span class="min-w-0 break-words">{{ problemText }}</span>
                <button v-if="problem.kind !== 'protected'" type="button" class="nb-ui-focus-ring rounded px-1.5 py-0.5 text-[var(--accent-text)] hover:bg-[var(--bg-hover)]" @click="emit('prefs-retry')">{{ explorerText(locale, problem.kind === "unread" ? "reload" : "retry") }}</button>
                <button v-if="problem.kind === 'unsaved'" type="button" class="nb-ui-focus-ring rounded px-1.5 py-0.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" @click="emit('prefs-discard')">{{ explorerText(locale, "discard") }}</button>
            </div>
        </div>
        <ExplorerTree
            v-if="ready"
            ref="tree"
            :rows="rows"
            :selected="selected"
            :focus="focus"
            :locale="locale"
            :label="explorerText(locale, 'tree')"
            :handle-key="handleKey"
            :editing="editing ?? null"
            :start-drag="startDrag"
            :drag="drag ?? null"
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
        />
        <div v-else role="status" aria-busy="true" class="px-3 py-2 text-xs text-[var(--text-muted)]" data-explorer-loading>{{ explorerText(locale, "loading") }}</div>
        <ExplorerFeedback
            :locale="locale"
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
        <ContextMenu :visible="menu != null" :x="menu?.x ?? 0" :y="menu?.y ?? 0" :items="menuItems" @close="closeMenu" />
        <AlertDialog
            :open="deleteDialog !== null"
            :title="explorerText(locale, 'deleteTitle', {count: deleteDialog?.items.length ?? 0})"
            :confirm-text="explorerText(locale, 'delete')"
            :cancel-text="explorerText(locale, 'cancel')"
            tone="danger"
            @confirm="emit('delete-confirm')"
            @cancel="emit('dialog-close')"
            @closed="focusTree"
        >
            <template #description>
                <p>{{ explorerText(locale, "deleteDescription") }}</p>
                <ul class="mt-2 max-h-[40vh] overflow-y-auto break-words text-xs" data-explorer-delete-items>
                    <li v-for="item in deleteDialog?.items ?? []" :key="item.address">{{ item.address }}</li>
                </ul>
                <template v-if="(deleteDialog?.unsaved.length ?? 0) > 0">
                    <p class="mt-3 text-[var(--status-danger)]">{{ explorerText(locale, "deleteUnsaved") }}</p>
                    <ul class="mt-1 max-h-[20vh] overflow-y-auto break-words text-xs" data-explorer-delete-unsaved>
                        <li v-for="address in deleteDialog?.unsaved ?? []" :key="address">{{ address }}</li>
                    </ul>
                </template>
            </template>
        </AlertDialog>
        <Dialog
            :model-value="dirtyCopyDialog !== null"
            :title="explorerText(locale, 'dirtyCopyTitle')"
            size="sm"
            @request-close="emit('dirty-copy', 'cancel')"
        >
            <div class="flex flex-col gap-2 text-sm" data-explorer-dirty-copy>
                <p>{{ explorerText(locale, "dirtyCopyBody") }}</p>
                <ul class="max-h-[30vh] overflow-y-auto break-words text-xs">
                    <li v-for="address in dirtyCopyDialog?.documents ?? []" :key="address">{{ address }}</li>
                </ul>
            </div>
            <template #footer>
                <div class="flex flex-wrap justify-end gap-2">
                    <Button variant="ghost" size="sm" data-explorer-dirty-copy-cancel @click="emit('dirty-copy', 'cancel')">{{ explorerText(locale, "cancel") }}</Button>
                    <Button variant="secondary" size="sm" data-explorer-dirty-copy-disk @click="emit('dirty-copy', 'disk')">{{ explorerText(locale, "dirtyCopyDisk") }}</Button>
                    <Button variant="primary" size="sm" data-explorer-dirty-copy-save @click="emit('dirty-copy', 'save')">{{ explorerText(locale, "dirtyCopySave") }}</Button>
                </div>
            </template>
        </Dialog>
        <Dialog
            :model-value="displayDialog !== null"
            :title="explorerText(locale, 'displayTitle', {name: displayDialog?.name ?? ''})"
            :busy="displayDialog?.busy === true"
            :show-cancel="true"
            :confirm-label="explorerText(locale, 'save')"
            :cancel-label="explorerText(locale, 'cancel')"
            size="sm"
            @confirm="emit('display-commit', displayTitle, displayIcon)"
            @request-close="emit('dialog-close')"
        >
            <div class="flex flex-col gap-3 text-sm" data-explorer-display>
                <label class="flex flex-col gap-1">
                    <span class="text-xs text-[var(--text-secondary)]">{{ explorerText(locale, "displayName") }}</span>
                    <FormInput v-model="displayTitle" size="sm" data-explorer-display-title />
                </label>
                <label class="flex flex-col gap-1">
                    <span class="text-xs text-[var(--text-secondary)]">{{ explorerText(locale, "displayIcon") }}</span>
                    <FormInput v-model="displayIcon" size="sm" data-explorer-display-icon />
                </label>
                <p class="text-xs text-[var(--text-muted)]">{{ explorerText(locale, "displayHint") }}</p>
            </div>
        </Dialog>
        <Dialog
            :model-value="collisionDialog !== null"
            :title="explorerText(locale, 'collisionTitle')"
            :cancel-label="explorerText(locale, 'collisionCancel')"
            size="sm"
            @request-close="emit('dialog-close')"
        >
            <form class="flex flex-col gap-3 text-sm" data-explorer-collision @submit.prevent="emit('collision', {kind: 'rename', name: collisionName}, collisionAll)">
                <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                    <dt class="text-[var(--text-secondary)]">{{ explorerText(locale, "collisionSource") }}</dt>
                    <dd class="break-words" data-explorer-collision-source>{{ collisionDialog?.source }}</dd>
                    <dt class="text-[var(--text-secondary)]">{{ explorerText(locale, "collisionTarget") }}</dt>
                    <dd class="break-words" data-explorer-collision-target>{{ collisionDialog?.target }}</dd>
                </dl>
                <label class="flex flex-col gap-1">
                    <span class="text-xs text-[var(--text-secondary)]">{{ explorerText(locale, "collisionName") }}</span>
                    <FormInput
                        v-model="collisionName"
                        size="sm"
                        :aria-invalid="collisionError ? 'true' : undefined"
                        :aria-describedby="collisionError ? 'explorer-collision-error' : undefined"
                        data-explorer-collision-name
                    />
                </label>
                <p v-if="collisionError" id="explorer-collision-error" role="alert" class="text-xs text-[var(--status-danger)]">{{ collisionError }}</p>
                <FormCheckbox v-model="collisionAll" :label="explorerText(locale, 'collisionAll')" data-explorer-collision-all />
            </form>
            <template #footer>
                <div class="flex flex-wrap justify-end gap-2">
                    <Button variant="ghost" size="sm" data-explorer-collision-cancel @click="emit('collision', {kind: 'cancel'}, false)">{{ explorerText(locale, "collisionCancel") }}</Button>
                    <Button variant="secondary" size="sm" data-explorer-collision-skip @click="emit('collision', {kind: 'skip'}, collisionAll)">{{ explorerText(locale, "collisionSkip") }}</Button>
                    <Button variant="primary" size="sm" data-explorer-collision-rename @click="emit('collision', {kind: 'rename', name: collisionName}, collisionAll)">{{ explorerText(locale, "collisionRename") }}</Button>
                </div>
            </template>
        </Dialog>
    </div>
</template>
