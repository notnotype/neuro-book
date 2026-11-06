<script setup lang="ts">
/**
 * 书架页的宿主（同名 .md）：把页面模型的状态交给 BookshelfPage，处理作品信息窗口、目录选择器、移出书架的确认、页面可见性与
 * 窗口焦点带来的刷新。模型由 `bookshelf-home.ts` 按挂载创建。
 */
import {AlertDialog} from "@notnotype/nb-ui/components";
import {computed, nextTick, onBeforeUnmount, onMounted, ref} from "vue";

import {TOGGLE_SETTINGS_COMMAND} from "nbook/plugins/settings/shared/contracts";

import {projectCoverUrl} from "../../shared/cover";
import {projectDisplayName} from "../../shared/shelf";
import type {ShelfItem} from "../../shared/shelf";
import {useProjectsText} from "../text";
import type {LibraryInfo, ProjectInfoField, ShelfPage} from "../shelf-page";
import BookshelfPage from "./BookshelfPage.vue";
import PathPickerDialog from "./PathPickerDialog.vue";
import type {PathPickerSource} from "./PathPickerDialog.vue";
import ProjectInfoDialog from "./ProjectInfoDialog.vue";
import type {ProjectInfoSubmit} from "./ProjectInfoDialog.vue";

defineOptions({name: "BookshelfHost"});

const props = defineProps<{
    page: ShelfPage;
    /** 本页的设置窗口开着：书架右上角的齿轮画成按下。 */
    settingsOpen: boolean;
}>();

const text = useProjectsText();

const shelf = ref<InstanceType<typeof BookshelfPage> | null>(null);
/** 最近一次取到的作品目录：空书架的卡上写它，新建窗口从它开始。 */
const library = ref<LibraryInfo | null>(null);

type InfoState = {readonly mode: "create"} | {readonly mode: "edit"; readonly id: string};
const info = ref<InfoState | null>(null);
const infoBusy = ref(false);
const infoLocation = ref("");
const fieldErrors = ref<Partial<Record<ProjectInfoField, string>>>({});
const editing = computed(() => (info.value?.mode === "edit" ? item(info.value.id) : null));
const infoInitial = computed(() => {
    const current = editing.value;
    if (current === null) return {title: "", description: "", color: null, coverSrc: null};
    return {id: current.id, title: current.title ?? "", description: current.description ?? "", color: current.color, coverSrc: coverSrc(current)};
});

type PickerState = {readonly mode: "project"} | {readonly mode: "directory"; readonly initialPath: string | null};
const picker = ref<PickerState | null>(null);
const pickerBusy = ref(false);
const pickerError = ref("");
const pickerSource: PathPickerSource = {list: (path) => props.page.browse(path)};

/** 问到的那部作品：确认框关闭（Reka 先发 `update:open`，再发 `confirm`）时还要用它，所以不随关闭清空。 */
const removing = ref<ShelfItem | null>(null);
const confirmOpen = ref(false);

const item = (id: string): ShelfItem | null => props.page.items.value.find((entry) => entry.id === id) ?? null;
const coverSrc = (entry: ShelfItem): string | null => (entry.cover === null ? null : projectCoverUrl(entry.id, entry.cover.version));

const onVisibility = (): void => props.page.setVisible(document.visibilityState === "visible");
const onFocus = (): void => props.page.focused();

onMounted(() => {
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    onVisibility();
    void loadLibrary();
});

onBeforeUnmount(() => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("focus", onFocus);
    props.page.setVisible(false);
});

async function loadLibrary(): Promise<LibraryInfo | null> {
    const current = await props.page.library();
    if (current !== null) library.value = current;
    return current;
}

async function startCreate(): Promise<void> {
    const current = await loadLibrary();
    infoLocation.value = current?.path ?? library.value?.path ?? "";
    fieldErrors.value = {};
    info.value = {mode: "create"};
}

function startEdit(id: string): void {
    if (item(id) === null) return;
    fieldErrors.value = {};
    info.value = {mode: "edit", id};
}

async function submitInfo(values: ProjectInfoSubmit): Promise<void> {
    const current = info.value;
    if (current === null || infoBusy.value) return;
    infoBusy.value = true;
    fieldErrors.value = {};
    try {
        const outcome = current.mode === "create" ? await props.page.create(values, values.parent ?? "") : await props.page.update(current.id, values);
        if (!outcome.ok) {
            if (outcome.field !== null) fieldErrors.value = {[outcome.field]: outcome.message};
            return;
        }
        info.value = null;
        // 封面与作品目录在作品建好之后再写：它们失败不影响作品本身，各自发通知。
        let settled = values.cover.kind === "keep" || await props.page.setCover(outcome.id, values.cover);
        if (current.mode === "create" && values.parent !== null && values.parent !== library.value?.path) {
            settled = await props.page.rememberLibrary(values.parent) && settled;
            await loadLibrary();
        }
        // 新建的作品直接打开（docs/specs/workbench/bookshelf.md 输出 11）。打开是整页离开：封面或作品目录没写成时留在书架上，
        // 不然它们的失败通知随页面一起没了，用户看不到。
        if (current.mode === "create" && settled) props.page.open(outcome.id);
    } finally {
        infoBusy.value = false;
    }
}

function browseLocation(): void {
    picker.value = {mode: "directory", initialPath: infoLocation.value};
    pickerError.value = "";
}

function startAddExisting(): void {
    picker.value = {mode: "project"};
    pickerError.value = "";
}

async function onPick(path: string): Promise<void> {
    const current = picker.value;
    if (current === null) return;
    // 选目录只从新建窗口的“浏览…”打开（作品目录在设置的“作品”分区里改）：选定的目录填回新建窗口的位置。
    if (current.mode === "directory") {
        picker.value = null;
        infoLocation.value = path;
        return;
    }
    pickerBusy.value = true;
    try {
        const outcome = await props.page.addExisting(path);
        if (outcome.ok) picker.value = null;
        else pickerError.value = outcome.message;
    } finally {
        pickerBusy.value = false;
    }
}

function askRemove(id: string): void {
    const target = item(id);
    if (target === null) return;
    removing.value = target;
    confirmOpen.value = true;
}

async function confirmRemove(): Promise<void> {
    const target = removing.value;
    confirmOpen.value = false;
    if (target === null) return;
    const outcome = await props.page.remove(target.id);
    if (outcome.ok) {
        await nextTick();
        shelf.value?.focusShelf();
    }
}
</script>

<template>
    <BookshelfPage
        ref="shelf"
        :status="page.status.value"
        :error="page.error.value"
        :items="page.items.value"
        :now="page.now.value"
        :view="page.view.value"
        :sort="page.sort.value"
        :active-id="page.activeId.value"
        :library="library?.path ?? ''"
        :cover-src="coverSrc"
        :settings-open="settingsOpen"
        @update:view="page.setView"
        @update:sort="page.setSort"
        @update:active-id="page.select"
        @continue="page.continueWriting"
        @open="page.open"
        @open-new-window="page.openInNewWindow"
        @edit="startEdit"
        @remove="askRemove"
        @create="startCreate"
        @add-existing="startAddExisting"
        @retry="page.refresh(true)"
        @open-settings="page.runCommand(TOGGLE_SETTINGS_COMMAND)"
    />
    <ProjectInfoDialog
        v-model:location="infoLocation"
        :open="info !== null"
        :mode="info?.mode ?? 'create'"
        :initial="infoInitial"
        :busy="infoBusy"
        :field-errors="fieldErrors"
        @submit="submitInfo"
        @cancel="info = null"
        @browse-location="browseLocation"
    />
    <PathPickerDialog
        :open="picker !== null"
        :mode="picker?.mode ?? 'project'"
        :source="pickerSource"
        :initial-path="picker?.mode === 'directory' ? picker.initialPath : null"
        :error="pickerError"
        :busy="pickerBusy"
        @pick="onPick"
        @cancel="picker = null"
    />
    <AlertDialog
        :open="confirmOpen"
        :title="text('bookshelfHost.removeTitle', {title: removing === null ? '' : projectDisplayName(removing)})"
        :description="text('bookshelfHost.removeDescription')"
        :confirm-label="text('bookshelfHost.remove')"
        :cancel-label="text('bookshelfHost.cancel')"
        tone="danger"
        @confirm="confirmRemove"
        @cancel="confirmOpen = false"
        @update:open="(open: boolean) => { if (!open) confirmOpen = false; }"
    />
</template>
