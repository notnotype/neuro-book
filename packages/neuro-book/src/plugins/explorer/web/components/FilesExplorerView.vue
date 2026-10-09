<script setup lang="ts">
/** 资源管理器视图的界面（同名 .md）。 */
import {IconButton, Toolbar} from "@notnotype/nb-ui/components";
import {computed, ref} from "vue";

import type {DisplayLocale} from "nbook/shared/localized-text";

import type {Notice} from "../controller";
import {explorerText} from "../messages";
import type {PreferenceProblem} from "../preferences";
import type {TreeKey} from "../tree/keys";
import type {Row} from "../tree/rows";
import type {Modifiers} from "../tree/selection";
import ExplorerFeedback from "./ExplorerFeedback.vue";
import ExplorerTree from "./ExplorerTree.vue";

type ToolbarAction = "refresh" | "collapse-all" | "toggle-manifests";

const props = defineProps<{
    locale: DisplayLocale;
    rows: ReadonlyArray<Row>;
    selected: ReadonlyArray<string>;
    focus: string | null;
    showManifests: boolean;
    ready: boolean;
    notice: Notice | null;
    problem: PreferenceProblem | null;
    handleKey: (key: TreeKey, page: number) => boolean;
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
    (event: "prefs-retry"): void;
    (event: "prefs-discard"): void;
    (event: "focus-change", focused: boolean): void;
}>();

const tree = ref<InstanceType<typeof ExplorerTree> | null>(null);

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
    {action: "refresh" as const, icon: "i-lucide-refresh-cw", label: explorerText(props.locale, "refresh"), pressed: undefined},
    {action: "collapse-all" as const, icon: "i-lucide-copy-minus", label: explorerText(props.locale, "collapseAll"), pressed: undefined},
    {action: "toggle-manifests" as const, icon: "i-lucide-file-code", label: explorerText(props.locale, "showManifests"), pressed: props.showManifests},
]);

defineExpose({focusTree: () => tree.value?.focus()});
</script>

<template>
    <div class="grid h-full min-h-0 w-full grid-rows-[auto_auto_minmax(0,1fr)_auto] text-sm" data-explorer-view>
        <Toolbar :aria-label="explorerText(locale, 'title')" class="flex items-center justify-end gap-0.5 px-2 py-1">
            <IconButton
                v-for="tool in tools"
                :key="tool.action"
                size="sm"
                :icon-class="tool.icon"
                :aria-label="tool.label"
                :title="tool.label"
                :aria-pressed="tool.pressed"
                :disabled="!ready"
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
            @row-press="(id, modifiers, part) => emit('row-press', id, modifiers, part)"
            @row-activate="(id) => emit('row-activate', id)"
            @row-context="(id, x, y) => emit('row-context', id, x, y)"
            @retry="(address) => emit('retry', address)"
            @focus-change="(focused) => emit('focus-change', focused)"
        />
        <div v-else class="px-3 py-2 text-xs text-[var(--text-muted)]" data-explorer-loading>{{ explorerText(locale, "loading") }}</div>
        <ExplorerFeedback :locale="locale" :notice="notice" @dismiss="emit('dismiss-notice')" />
    </div>
</template>
