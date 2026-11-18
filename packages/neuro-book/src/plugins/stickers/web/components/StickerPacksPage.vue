<script setup lang="ts">
import {AlertDialog, Button, DropdownMenu, EmptyState, IconButton, Select, Spinner} from "@notnotype/nb-ui/components";
import {computed, nextTick, onBeforeUnmount, onMounted, ref, watch} from "vue";

import {dragHasFiles} from "nbook/ui/dropped-folder";

import type {StickerPackDetail, StickerPackSummary} from "../../shared/contracts";
import {gridGroups, railGroups} from "../pack-view";
import type {GridItem} from "../pack-view";
import type {ImportChoice, ImportConflictInfo} from "../packs-page";
import {useStickersPageText} from "../text";
import type {UploadItem} from "../upload-queue";
import ImportConflictDialog from "./ImportConflictDialog.vue";
import PackFields from "./PackFields.vue";
import StickerFields from "./StickerFields.vue";
import StickerGrid from "./StickerGrid.vue";
import StickerPackNameDialog from "./StickerPackNameDialog.vue";
import StickerPackRail from "./StickerPackRail.vue";

/** 设置窗口的“表情包”分区（同名 .md）：只管选中、对话框与布局，取数与写入在 `packs-page.ts`。 */
type Failure = {readonly reason: string};
type Target = {readonly file: string; readonly name: string | null};
type Preview = {readonly title: string | null; readonly count: number | null; readonly items: ReadonlyArray<{readonly url: string; readonly label: string}>};

const props = withDefaults(defineProps<{
    state: "loading" | "ready" | {failed: string};
    packs: readonly StickerPackSummary[];
    selected: string | null;
    detail: StickerPackDetail | null;
    uploads?: readonly UploadItem[];
    createPack?: (folder: string, title: string) => Promise<{readonly id: string} | Failure>;
    renamePack?: (id: string, folder: string) => Promise<{readonly id: string} | Failure>;
    copyPack?: (id: string) => Promise<{readonly id: string} | Failure>;
    importZip?: (file: File, choice?: ImportChoice) => Promise<{readonly id: string} | {readonly conflict: ImportConflictInfo} | Failure>;
    updatePack?: (id: string, change: {title?: string | null; description?: string | null}) => Promise<Failure | null>;
    updateSticker?: (id: string, target: Target, change: {name?: string | null; description?: string | null; common?: boolean}) => Promise<Failure | null>;
    deletePack?: (id: string) => Promise<Failure | null>;
    deleteSticker?: (id: string, target: Target) => Promise<Failure | null>;
    deleteFile?: (id: string, file: string) => Promise<Failure | null>;
    listFiles?: (id: string, files: readonly string[] | "all") => Promise<Failure | null>;
    allowlistUsage?: (id: string) => Promise<readonly string[] | null>;
    previewZip?: (file: File) => Promise<Preview>;
    /** 一开始选中的格子（`stickerKey`、`extraKey`）；Lab 场景摆出选中的样子用。 */
    initialSticker?: string | null;
}>(), {
    initialSticker: null,
    uploads: () => [],
    createPack: async () => ({reason: ""}),
    renamePack: async () => ({reason: ""}),
    copyPack: async () => ({reason: ""}),
    importZip: async () => ({reason: ""}),
    updatePack: async () => null,
    updateSticker: async () => null,
    deletePack: async () => null,
    deleteSticker: async () => null,
    deleteFile: async () => null,
    listFiles: async () => null,
    allowlistUsage: async () => null,
    previewZip: async () => ({title: null, count: null, items: []}),
});

const emit = defineEmits<{
    (e: "select", id: string): void;
    (e: "add-images", id: string, files: File[]): void;
    (e: "export", id: string): void;
    (e: "reveal", id: string): void;
    (e: "retry"): void;
}>();

const text = useStickersPageText();
const page = ref<HTMLElement | null>(null);
const grid = ref<InstanceType<typeof StickerGrid> | null>(null);
const zipInput = ref<HTMLInputElement | null>(null);

const groups = computed(() => railGroups(props.packs));
const current = computed(() => props.packs.find((pack) => pack.id === props.selected) ?? null);
const pluginPack = computed(() => current.value?.source === "plugin");
const invalid = computed(() => current.value?.status === "invalid");
/** 名字当不了表情名的图在页面里的 key 集合：选中它们时属性栏要求先改名。 */
const gridItems = computed<readonly GridItem[]>(() => (props.detail === null ? [] : gridGroups(props.detail).flatMap((group) => group.items)));

// ---- 选中的格子 ----
const selectedKey = ref<string | null>(props.initialSticker);
const selectedItem = computed(() => gridItems.value.find((item) => item.key === selectedKey.value) ?? null);
watch(() => props.selected, () => {
    selectedKey.value = null;
});
// 选中的格子没了（删了、别处改了）：回到表情包。
watch(gridItems, (items) => {
    if (selectedKey.value !== null && !items.some((item) => item.key === selectedKey.value)) selectedKey.value = null;
});
const problemKeys = computed(() => new Set(props.detail === null ? [] : props.detail.extras.filter((extra) => extra.reason === "name").map((extra) => `e:${extra.file}`)));
const isProblem = (item: GridItem): boolean => problemKeys.value.has(item.key);
const isUnlisted = (item: GridItem): boolean => item.kind === "extra" && !isProblem(item);

function selectCell(key: string | null): void {
    selectedKey.value = key;
    if (key !== null) void nextTick(() => page.value?.querySelector("[data-sticker-panel]")?.scrollIntoView?.({block: "nearest"}));
}

const targetOf = (item: GridItem): Target => ({file: item.file, name: item.name});
const reasonOrNull = (result: Failure | null): string | null => (result === null ? null : result.reason);

// ---- 新建与改包名 ----
const nameDialog = ref({open: false, mode: "create" as "create" | "rename", busy: false, status: "", usage: undefined as readonly string[] | null | undefined});
function openCreate(): void {
    nameDialog.value = {open: true, mode: "create", busy: false, status: "", usage: undefined};
}
function openRename(): void {
    const id = props.selected;
    if (id === null) return;
    nameDialog.value = {open: true, mode: "rename", busy: false, status: "", usage: undefined};
    void props.allowlistUsage(id).then((names) => {
        if (nameDialog.value.open && props.selected === id) nameDialog.value = {...nameDialog.value, usage: names};
    });
}
async function submitName(value: {folder: string; title: string}): Promise<void> {
    nameDialog.value = {...nameDialog.value, busy: true, status: ""};
    const id = props.selected;
    const result = nameDialog.value.mode === "create" ? await props.createPack(value.folder, value.title) : id === null ? {reason: ""} : await props.renamePack(id, value.folder);
    if ("reason" in result) {
        nameDialog.value = {...nameDialog.value, busy: false, status: result.reason};
        return;
    }
    nameDialog.value = {...nameDialog.value, open: false, busy: false};
}

// ---- 删除 ----
const removePack = ref(false);
const removeSticker = ref<{open: boolean; key: string | null}>({open: false, key: null});
/** 打开确认框时定下删谁：确认框不跟着当前选中挂载，删掉之后选中变了它还要发 `closed`。 */
const removing = ref<{id: string; name: string; count: number} | null>(null);
const removingItem = ref<GridItem | null>(null);
/** 确认之后的删除：关闭动画先结束，移焦点要等它做完。 */
let pendingFocus: (() => Promise<void>) | null = null;

function askRemovePack(): void {
    if (current.value === null) return;
    removing.value = {id: current.value.id, name: current.value.title, count: current.value.count};
    removePack.value = true;
}
function confirmRemovePack(): void {
    const target = removing.value;
    if (target === null) return;
    pendingFocus = async () => {
        const failure = await props.deletePack(target.id);
        if (failure !== null) return;
        await nextTick();
        const next = page.value?.querySelector<HTMLElement>("[data-sticker-rail-item][aria-current='page']") ?? page.value?.querySelector<HTMLElement>("[data-sticker-picker]");
        next?.focus();
    };
}
function askRemoveItem(key: string): void {
    const item = gridItems.value.find((candidate) => candidate.key === key);
    if (item === undefined) return;
    removingItem.value = item;
    removeSticker.value = {open: true, key};
}
function confirmRemoveItem(): void {
    const item = removingItem.value;
    const id = props.selected;
    if (item === null || id === null) return;
    const next = grid.value?.afterRemoval(item.key) ?? null;
    pendingFocus = async () => {
        const failure = isUnlisted(item) ? await props.deleteFile(id, item.file) : await props.deleteSticker(id, targetOf(item));
        if (failure !== null) return;
        selectedKey.value = next;
        await nextTick();
        if (next !== null) grid.value?.focusKey(next);
        else page.value?.querySelector<HTMLElement>("[data-sticker-add]")?.focus();
    };
}
async function onRemoveClosed(): Promise<void> {
    const run = pendingFocus;
    pendingFocus = null;
    if (run !== null) await run();
}

// ---- 导入 ----
const importFile = ref<File | null>(null);
const conflict = ref<{open: boolean; busy: boolean; status: string; info: ImportConflictInfo | null; preview: Preview; name: string}>({open: false, busy: false, status: "", info: null, preview: {title: null, count: null, items: []}, name: ""});
function chooseZip(): void {
    zipInput.value?.click();
}
async function zipChosen(event: Event): Promise<void> {
    const element = event.target as HTMLInputElement;
    const file = element.files?.[0];
    element.value = "";
    if (file === undefined) return;
    importFile.value = file;
    const result = await props.importZip(file);
    if (!("conflict" in result)) return;
    const preview = await props.previewZip(file).catch((): Preview => ({title: null, count: null, items: []}));
    conflict.value = {open: true, busy: false, status: "", info: result.conflict, preview, name: result.conflict.existing.id.slice(result.conflict.existing.id.indexOf(".") + 1)};
}
async function chooseConflict(mode: "copy" | "replace"): Promise<void> {
    const file = importFile.value;
    const info = conflict.value.info;
    if (file === null || info === null) return;
    if (mode === "replace" && info.existing.token === null) return;
    conflict.value = {...conflict.value, busy: true, status: ""};
    const result = await props.importZip(file, mode === "copy" ? {mode: "copy"} : {mode: "replace", token: info.existing.token as string});
    if ("reason" in result) {
        conflict.value = {...conflict.value, busy: false, status: result.reason};
        return;
    }
    if ("conflict" in result) {
        conflict.value = {...conflict.value, busy: false, info: result.conflict};
        return;
    }
    conflict.value = {...conflict.value, open: false, busy: false};
}
const existingPreview = computed(() => (conflict.value.info?.existing.files ?? []).map((file) => ({url: `/api/nbook.stickers/image/${encodeURIComponent(conflict.value.info?.existing.id ?? "")}/${encodeURIComponent(file)}`, label: file})));

async function copyToMine(): Promise<void> {
    if (props.selected !== null) await props.copyPack(props.selected);
}

// ---- 拖放 ----
const dragging = ref(false);
const dragCount = ref(0);
/** 设置窗口里的任何位置都显示落点提示；只有落在网格上才收。 */
function inWindow(target: EventTarget | null): boolean {
    const region = page.value?.closest("[data-settings-window]") ?? page.value;
    return target instanceof Node && region?.contains(target) === true;
}
function onDropzone(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest("[data-sticker-dropzone]:not([data-readonly])") !== null && props.detail !== null && props.selected !== null;
}
function onWindowDragOver(event: DragEvent): void {
    if (!dragHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    const accepting = onDropzone(event.target);
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = accepting ? "copy" : "none";
    dragging.value = inWindow(event.target) && props.detail !== null && !pluginPack.value;
    dragCount.value = event.dataTransfer?.items.length ?? 0;
}
function onWindowDragLeave(event: DragEvent): void {
    if (event.relatedTarget === null) dragging.value = false;
}
function onWindowDrop(event: DragEvent): void {
    if (!dragHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragging.value = false;
    const id = props.selected;
    if (id === null || !onDropzone(event.target)) return;
    const files = [...(event.dataTransfer?.files ?? [])];
    if (files.length > 0) emit("add-images", id, files);
}
onMounted(() => {
    window.addEventListener("dragover", onWindowDragOver);
    window.addEventListener("dragleave", onWindowDragLeave);
    window.addEventListener("drop", onWindowDrop);
});
onBeforeUnmount(() => {
    window.removeEventListener("dragover", onWindowDragOver);
    window.removeEventListener("dragleave", onWindowDragLeave);
    window.removeEventListener("drop", onWindowDrop);
});

// ---- 头部菜单 ----
const menuItems = computed(() => {
    const items = [{id: "reveal", label: text("menu.reveal"), iconClass: "i-lucide-folder-open"}];
    if (pluginPack.value) return items;
    if (current.value?.status === "ok" || current.value?.problem === "folder-name") items.push({id: "rename", label: text("menu.rename"), iconClass: "i-lucide-text-cursor-input"});
    return [...items, {id: "sep", label: "", iconClass: "", separator: true} as never, {id: "delete", label: text("menu.delete"), iconClass: "i-lucide-trash-2", tone: "danger"} as never];
});
function onMenu(id: string): void {
    if (props.selected === null) return;
    if (id === "reveal") emit("reveal", props.selected);
    else if (id === "rename") openRename();
    else if (id === "delete") askRemovePack();
}
const pickerOptions = computed(() => props.packs.map((pack) => ({value: pack.id, label: pack.title, description: String(pack.count)})));
const uploadsHere = computed(() => props.uploads.filter((upload) => upload.packId === props.selected));
</script>

<template>
    <div ref="page" class="sticker-page" data-sticker-packs-page>
        <div v-if="state === 'loading'" class="sticker-page__state" role="status" aria-busy="true" data-sticker-loading>
            <Spinner />
            <p>{{ text("page.loading") }}</p>
        </div>
        <div v-else-if="state !== 'ready'" class="sticker-page__state" role="alert" data-sticker-load-failed>
            <span class="i-lucide-circle-alert sticker-page__state-icon" aria-hidden="true" />
            <p>{{ text("page.loadFailed", {code: state.failed}) }}</p>
            <Button size="sm" variant="secondary" data-sticker-retry @click="emit('retry')">{{ text("page.retry") }}</Button>
        </div>
        <template v-else>
            <EmptyState v-if="packs.length === 0" class="sticker-page__empty" icon-class="i-lucide-sticker" :title="text('page.emptyTitle')" data-sticker-empty-page>
                <div class="sticker-page__empty-actions">
                    <Button size="sm" icon-class="i-lucide-plus" data-sticker-create @click="openCreate">{{ text("rail.new") }}</Button>
                    <Button size="sm" variant="secondary" icon-class="i-lucide-file-up" data-sticker-import @click="chooseZip">{{ text("rail.import") }}</Button>
                </div>
            </EmptyState>
            <div v-else class="sticker-page__split">
                <StickerPackRail class="sticker-page__rail" :groups="groups" :current="selected" @select="(id: string) => emit('select', id)" @create="openCreate" @import="chooseZip" />
                <div class="sticker-main">
                    <div class="sticker-main__picker">
                        <Select :model-value="selected ?? ''" :options="pickerOptions" size="sm" :aria-label="text('rail.label')" data-sticker-picker @update:model-value="(id: string) => emit('select', id)" />
                        <IconButton size="sm" icon-class="i-lucide-plus" :title="text('rail.new')" :aria-label="text('rail.new')" @click="openCreate" />
                        <IconButton size="sm" icon-class="i-lucide-file-up" :title="text('rail.import')" :aria-label="text('rail.import')" @click="chooseZip" />
                    </div>
                    <template v-if="current !== null">
                        <header class="sticker-head">
                            <div class="sticker-head__text">
                                <h2 class="sticker-head__title">{{ current.title }}</h2>
                                <p v-if="current.description" class="sticker-head__description">{{ current.description }}</p>
                            </div>
                            <div class="sticker-head__actions">
                                <Button v-if="pluginPack" size="sm" icon-class="i-lucide-copy-plus" data-sticker-copy @click="copyToMine">{{ text("head.copy") }}</Button>
                                <Button v-if="!invalid" size="sm" variant="secondary" icon-class="i-lucide-download" data-sticker-export @click="emit('export', current.id)">{{ text("head.export") }}</Button>
                                <DropdownMenu :items="menuItems" align="end" @select="onMenu">
                                    <IconButton size="sm" icon-class="i-lucide-ellipsis" :title="text('head.more')" :aria-label="text('head.more')" data-sticker-more />
                                </DropdownMenu>
                            </div>
                        </header>
                        <div v-if="invalid" class="sticker-page__invalid" data-sticker-invalid>
                            <PackFields v-if="detail !== null" :detail="detail" :readonly="true" :commit="async () => null" @rename="openRename" />
                            <p v-else>{{ text("rail.invalid") }}{{ current.problem === undefined ? "" : `（${current.problem}）` }}</p>
                        </div>
                        <div v-else class="sticker-body">
                            <div v-if="detail === null" class="sticker-body__loading" role="status"><Spinner /></div>
                            <StickerGrid v-else ref="grid" :detail="detail" :selected="selectedKey" :uploads="uploadsHere" :readonly="pluginPack" :dragging="dragging" :drag-count="dragCount" @select="selectCell" @delete="askRemoveItem" @add-images="(files: File[]) => emit('add-images', current!.id, files)" @list-files="(files: 'all') => void props.listFiles(current!.id, files)" />
                            <aside class="sticker-panel" :aria-label="text('panel.label')" data-sticker-panel>
                                <template v-if="detail !== null">
                                    <StickerFields
                                        v-if="selectedItem !== null"
                                        :key="selectedItem.key"
                                        :item="selectedItem"
                                        :folder="current.folder"
                                        :problem="isProblem(selectedItem)"
                                        :unlisted="isUnlisted(selectedItem)"
                                        :readonly="pluginPack"
                                        :commit="async (change) => reasonOrNull(await props.updateSticker(current!.id, targetOf(selectedItem!), change))"
                                        @delete="askRemoveItem(selectedItem.key)"
                                        @list="void props.listFiles(current!.id, [selectedItem.file])"
                                        @back="selectedKey = null"
                                    />
                                    <PackFields v-else :key="detail.summary.id" :detail="detail" :readonly="pluginPack" :commit="async (change) => reasonOrNull(await props.updatePack(current!.id, change))" @rename="openRename" />
                                </template>
                            </aside>
                        </div>
                    </template>
                </div>
            </div>
        </template>

        <input ref="zipInput" class="sticker-page__file" type="file" accept=".zip,application/zip" tabindex="-1" aria-hidden="true" data-sticker-zip @change="zipChosen" />
        <StickerPackNameDialog
            v-model:open="nameDialog.open"
            :mode="nameDialog.mode"
            :current="current?.folder ?? ''"
            :busy="nameDialog.busy"
            :status="nameDialog.status"
            :usage="nameDialog.usage"
            @submit="submitName"
            @edit="nameDialog.status = ''"
        />
        <ImportConflictDialog
            v-if="conflict.info !== null"
            v-model:open="conflict.open"
            :name="conflict.name"
            :existing="{title: conflict.info.existing.title, count: conflict.info.existing.count, items: existingPreview}"
            :incoming="{title: conflict.preview.title ?? conflict.name, count: conflict.preview.count, items: conflict.preview.items}"
            :copy-as="conflict.info.copyAs"
            :busy="conflict.busy"
            :status="conflict.status"
            @choose="chooseConflict"
        />
        <AlertDialog
            v-if="removing !== null"
            v-model:open="removePack"
            :title="text('dialog.deletePack.title', {name: removing.name})"
            :description="text('dialog.deletePack.description', {count: String(removing.count)})"
            :confirm-label="text('dialog.deletePack.confirm')"
            data-sticker-remove-pack
            @confirm="confirmRemovePack"
            @closed="onRemoveClosed"
        />
        <AlertDialog
            v-if="removingItem !== null"
            v-model:open="removeSticker.open"
            :title="text('dialog.deleteSticker.title', {name: removingItem.label})"
            :description="text('dialog.deleteSticker.description')"
            :confirm-label="text('dialog.deleteSticker.confirm')"
            data-sticker-remove-sticker
            @confirm="confirmRemoveItem"
            @closed="onRemoveClosed"
        />
    </div>
</template>

<style scoped>
.sticker-page {
    height: 100%;
    min-height: 0;
    container-type: inline-size;
    font-size: var(--text-sm);
    color: var(--text-main);
}

.sticker-page__state {
    display: flex;
    height: 100%;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    color: var(--text-muted);
}

.sticker-page__state p {
    margin: 0;
}

.sticker-page__state-icon {
    width: 20px;
    height: 20px;
    color: var(--status-danger);
}

.sticker-page__empty {
    height: 100%;
}

.sticker-page__empty-actions {
    display: flex;
    justify-content: center;
    gap: var(--space-2);
}

.sticker-page__file {
    display: none;
}

.sticker-page__split {
    display: flex;
    height: 100%;
    min-height: 0;
    gap: var(--space-5);
}

.sticker-main {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    gap: var(--space-4);
    overflow-y: auto;
    padding: var(--space-1) var(--space-2) var(--space-5);
}

.sticker-main__picker {
    display: none;
    gap: var(--space-1);
}

.sticker-main__picker > :first-child {
    min-width: 0;
    flex: 1;
}

.sticker-head {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
}

.sticker-head__text {
    min-width: 0;
    flex: 1;
}

.sticker-head__title {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 600;
    line-height: 28px;
}

.sticker-head__description {
    margin: 0;
    line-height: 20px;
    color: var(--text-muted);
}

.sticker-head__actions {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: var(--space-1);
}

.sticker-body {
    display: flex;
    align-items: flex-start;
    gap: var(--space-5);
}

.sticker-body__loading {
    display: flex;
    flex: 1;
    justify-content: center;
    padding: var(--space-6);
}

.sticker-page__invalid {
    max-width: 480px;
    color: var(--status-danger);
}

.sticker-panel {
    position: sticky;
    top: 0;
    width: 232px;
    flex-shrink: 0;
    padding-left: var(--space-5);
    border-left: var(--border-w) solid var(--divider);
}

/* 页面不到 600px：左栏收成顶上的下拉加“新建”“导入”，属性栏排到网格下面。 */
@container (max-width: 600px) {
    .sticker-page__rail {
        display: none;
    }

    .sticker-main__picker {
        display: flex;
    }

    .sticker-body {
        flex-direction: column;
        align-items: stretch;
    }

    .sticker-panel {
        position: static;
        width: auto;
        padding: var(--space-4) 0 0;
        border-top: var(--border-w) solid var(--divider);
        border-left: 0;
    }
}
</style>
