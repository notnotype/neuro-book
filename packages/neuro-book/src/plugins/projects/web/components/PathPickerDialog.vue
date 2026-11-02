<script setup lang="ts">
/**
 * 目录选择器（同名 .md）：模态 `Dialog` 包 `FileBrowser`，数据从 `source.list` 取（产品里是远程 `browse`）。
 * 从作品信息对话框里打开时叠在它上面（模态按打开顺序叠放），Esc 与点遮罩只关这一层。
 * 选作品（打开已有作品）或选目录（更改作品目录）两种用途，区别只在哪些条目能选、确认按钮叫什么。
 */
import {Button, Dialog, Input, IconButton, InfoTip, Tooltip} from "@notnotype/nb-ui/components";

import {computed, nextTick, ref, useId, watch} from "vue";

import type {BrowseEntry} from "../../shared/contracts";
import {useProjectsText} from "../text";
import {autoBookColor} from "../shelf-format";
import FileBrowser from "./FileBrowser.vue";
import type {FileBrowserEntry, FileBrowserSegment} from "./FileBrowser.vue";

defineOptions({name: "PathPickerDialog", inheritAttrs: false});

export interface PathPickerListing {
    readonly path: string;
    readonly parent: string | null;
    readonly entries: ReadonlyArray<BrowseEntry>;
}

export type PathPickerOutcome = {readonly ok: true; readonly value: PathPickerListing} | {readonly ok: false; readonly message: string};

export interface PathPickerSource {
    /** 列一个目录；`null` 为缺省起点（作品目录）。 */
    list(path: string | null): Promise<PathPickerOutcome>;
}

const props = withDefaults(defineProps<{
    open: boolean;
    /** `project`：选一部作品（作品目录或普通目录都能选，已在书架上的不能）；`directory`：选一个目录。 */
    mode: "project" | "directory";
    source: PathPickerSource;
    /** 打开时从哪个目录开始；null 为作品目录。 */
    initialPath?: string | null;
    /** 宿主在确认后给出的失败原因（登记失败这类），显示在底部；输入保留。 */
    error?: string;
    busy?: boolean;
}>(), {initialPath: null, error: "", busy: false});

const emit = defineEmits<{
    (event: "pick", path: string): void;
    (event: "cancel"): void;
}>();

const text = useProjectsText();

const listing = ref<PathPickerListing | null>(null);
const loading = ref(false);
const loadError = ref("");
const selectedId = ref<string | null>(null);
const typing = ref(false);
const typed = ref("");
const inputId = useId();
let loadSequence = 0;

async function load(path: string | null): Promise<void> {
    loadSequence += 1;
    const sequence = loadSequence;
    loading.value = true;
    loadError.value = "";
    const outcome = await props.source.list(path);
    if (sequence !== loadSequence) return;
    loading.value = false;
    if (outcome.ok) {
        listing.value = outcome.value;
        selectedId.value = null;
        // 列表加载完才出现：对话框打开时初始焦点先落在面板上，列好了再交给列表（别落在说明图标上，它一聚焦就弹提示）。
        await nextTick();
        if (props.open) document.querySelector<HTMLElement>("[data-path-picker] [role='listbox']")?.focus({preventScroll: true});
    } else {
        loadError.value = outcome.message;
    }
}

watch(() => props.open, (open) => {
    if (!open) return;
    listing.value = null;
    typing.value = false;
    typed.value = "";
    void load(props.initialPath);
}, {immediate: true});

/** 面包屑的段：按分隔符切开当前路径，每段的路径是到它为止的前缀；根（`/` 或盘符）是第一段。 */
const segments = computed<FileBrowserSegment[]>(() => {
    const path = listing.value?.path ?? "";
    if (path === "") return [];
    const separator = path.includes("\\") ? "\\" : "/";
    const parts = path.split(separator);
    const result: FileBrowserSegment[] = [];
    let prefix = "";
    for (const [index, part] of parts.entries()) {
        if (index === 0) {
            prefix = part === "" ? separator : part + separator;
            result.push({label: part === "" ? separator : part, path: prefix});
            continue;
        }
        if (part === "") continue;
        prefix = prefix.endsWith(separator) ? prefix + part : prefix + separator + part;
        result.push({label: part, path: prefix});
    }
    return result;
});

const entries = computed<FileBrowserEntry[]>(() => (listing.value?.entries ?? []).map((entry) => ({
    id: entry.path,
    name: entry.name,
    kind: "directory",
    ...(entry.kind === "registered" ? {badge: text("pathPicker.registered"), disabled: props.mode === "project"} : {}),
    ...(entry.kind === "project" ? {badge: entry.title === null ? text("pathPicker.project") : text("pathPicker.projectTitled", {title: entry.title}), badgeTone: "accent" as const, swatch: autoBookColor(entry.path)} : {}),
})));

const selectedEntry = computed(() => listing.value?.entries.find((entry) => entry.path === selectedId.value) ?? null);
/** 确认时交出的路径：选了条目是它，没选就是当前目录（选目录模式下“就用这一层”）。 */
const chosenPath = computed(() => selectedEntry.value?.path ?? (props.mode === "directory" ? listing.value?.path ?? null : null));
const summary = computed(() => {
    const entry = selectedEntry.value;
    if (entry !== null) return entry.kind === "project" && entry.title !== null ? text("pathPicker.selectedProject", {name: entry.name, title: entry.title}) : text("pathPicker.selected", {name: entry.name});
    if (props.mode === "directory" && listing.value !== null) return text("pathPicker.current", {path: listing.value.path});
    return text("pathPicker.none");
});

function navigate(path: string): void {
    void load(path);
}

function up(): void {
    const parent = listing.value?.parent;
    if (parent !== null && parent !== undefined) void load(parent);
}

async function startTyping(): Promise<void> {
    typed.value = listing.value?.path ?? "";
    typing.value = true;
    await nextTick();
    // 按 id 找：Input 带前后缀时根是外框、不带时根就是 input，id 总落在真正的 input 上。
    document.getElementById(inputId)?.focus();
}

function submitTyped(): void {
    const value = typed.value.trim();
    if (value === "") return;
    typing.value = false;
    void load(value);
}

function confirm(): void {
    if (props.busy || chosenPath.value === null) return;
    emit("pick", chosenPath.value);
}

/** 在选中的作品目录上双击或回车：选作品模式下就是确认；普通目录进入。 */
function activate(path: string): void {
    const entry = listing.value?.entries.find((candidate) => candidate.path === path);
    if (props.mode === "project" && entry?.kind === "project") {
        selectedId.value = path;
        confirm();
        return;
    }
    navigate(path);
}
</script>

<template>
    <Dialog
        :open="open"
        :title="text(mode === 'project' ? 'pathPicker.projectTitle' : 'pathPicker.directoryTitle')"
        size="md"
        :width="640"
        :busy="busy"
        :status="error"
        initial-focus="[data-path-picker] [role='listbox']"
        @request-close="emit('cancel')"
    >
        <template #header-extra>
            <InfoTip :text="text(mode === 'project' ? 'pathPicker.projectHint' : 'pathPicker.directoryHint')" :label="text('pathPicker.info')" side="bottom" data-path-picker-info />
        </template>
        <div class="path-picker" data-path-picker>
            <div v-if="typing" class="path-picker__typing">
                <Input :id="inputId" v-model="typed" size="sm" :placeholder="text('pathPicker.pathPlaceholder')" data-path-picker-input @keydown.enter.prevent="submitTyped" @keydown.esc.prevent="typing = false" />
                <Button size="sm" variant="secondary" @click="submitTyped">{{ text('pathPicker.typePath') }}</Button>
            </div>
            <FileBrowser
                v-model:selected-id="selectedId"
                :segments="segments"
                :entries="entries"
                :loading="loading"
                :error="loadError"
                :empty-text="text('pathPicker.empty')"
                :up-label="text('pathPicker.up')"
                :label="text(mode === 'project' ? 'pathPicker.projectTitle' : 'pathPicker.directoryTitle')"
                class="path-picker__browser"
                @navigate="activate"
                @up="up"
            />
        </div>
        <!-- 登记失败的原因（宿主给的 error）写在页脚状态行，替下“已选 …”：不在浏览器下面插字，选择器不重排。 -->
        <template #status>
            <span data-path-picker-summary>{{ summary }}</span>
        </template>
        <template #footer>
            <Tooltip :text="text('pathPicker.typePath')" side="top">
                <IconButton size="sm" icon-class="i-lucide-keyboard" :aria-label="text('pathPicker.typePath')" data-path-picker-type @click="startTyping" />
            </Tooltip>
            <Button variant="secondary" :disabled="busy" @click="emit('cancel')">{{ text('pathPicker.cancel') }}</Button>
            <Button variant="primary" :disabled="chosenPath === null" :loading="busy" data-path-picker-confirm @click="confirm">{{ text(mode === "project" ? 'pathPicker.add' : 'pathPicker.choose') }}</Button>
        </template>
    </Dialog>
</template>

<style scoped>
.path-picker {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.path-picker__typing {
    display: flex;
    gap: var(--space-2);
}

.path-picker__typing > :first-child {
    flex: 1;
}

.path-picker__browser {
    --nb-file-browser-max-height: 280px;
}
</style>
