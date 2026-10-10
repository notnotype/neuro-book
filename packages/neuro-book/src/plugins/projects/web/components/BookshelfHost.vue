<script setup lang="ts">
/**
 * 书架页的宿主（同名 .md）：把页面模型的状态交给 BookshelfPage，处理作品信息对话框、移出书架的确认、页面可见性与
 * 窗口焦点带来的刷新。模型由 `bookshelf-home.ts` 按挂载创建。
 */
import {AlertDialog} from "@notnotype/nb-ui/components";
import {computed, nextTick, onBeforeUnmount, onMounted, ref} from "vue";

import {formatText, localize} from "nbook/shared/localized-text";
import type {DisplayLocale, LocalizedText} from "nbook/shared/localized-text";

import {projectDisplayName} from "../../shared/shelf";
import type {ShelfItem} from "../../shared/shelf";
import type {CreateTarget, ProjectInfoValues, ShelfPage} from "../shelf-page";
import BookshelfPage from "./BookshelfPage.vue";
import ProjectInfoDialog from "./ProjectInfoDialog.vue";

defineOptions({name: "BookshelfHost"});

const props = defineProps<{
    page: ShelfPage;
    locale: DisplayLocale;
}>();

const TEXT = {
    removeTitle: {"zh-CN": "从书架移除《{title}》？", "en-US": "Remove “{title}” from the shelf?"},
    removeDescription: {"zh-CN": "只取消登记，不删除作品目录与其中的文件；以后可以再加入书架。", "en-US": "Only the registration is removed; the folder and its files stay. You can add it back later."},
    remove: {"zh-CN": "移除", "en-US": "Remove"},
    cancel: {"zh-CN": "取消", "en-US": "Cancel"},
} satisfies Record<string, LocalizedText>;

const text = (value: LocalizedText): string => localize(value, props.locale);

const shelf = ref<InstanceType<typeof BookshelfPage> | null>(null);
type DialogState = {readonly mode: "create"; readonly target: CreateTarget} | {readonly mode: "edit"; readonly id: string; readonly initial: ProjectInfoValues};
const dialog = ref<DialogState | null>(null);
const dialogBusy = ref(false);
const dialogError = ref("");
const removing = ref<ShelfItem | null>(null);
/** 本组件自己的提示（移出被拒）；在时盖过模型的提示。 */
const localNotice = ref<string | null>(null);

const notice = computed(() => {
    if (localNotice.value !== null) return {text: localNotice.value, retry: false};
    const current = props.page.notice.value;
    return current === null ? null : {text: current.text, retry: current.retry};
});

const item = (id: string): ShelfItem | null => props.page.items.value.find((entry) => entry.id === id) ?? null;

const onVisibility = (): void => props.page.setVisible(document.visibilityState === "visible");
const onFocus = (): void => props.page.focused();

onMounted(() => {
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    onVisibility();
});

onBeforeUnmount(() => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("focus", onFocus);
    props.page.setVisible(false);
});

async function startCreate(): Promise<void> {
    const target = await props.page.createTarget();
    if (target === null) return;
    dialogError.value = "";
    dialog.value = {mode: "create", target};
}

function startEdit(id: string): void {
    const current = item(id);
    if (current === null) return;
    dialogError.value = "";
    dialog.value = {mode: "edit", id, initial: {title: current.title ?? "", description: current.description ?? "", color: current.color}};
}

async function submit(values: ProjectInfoValues): Promise<void> {
    const current = dialog.value;
    if (current === null || dialogBusy.value) return;
    dialogBusy.value = true;
    try {
        const outcome = current.mode === "create" ? await props.page.create(values, current.target) : await props.page.update(current.id, values);
        if (outcome.ok) dialog.value = null;
        else dialogError.value = outcome.message;
    } finally {
        dialogBusy.value = false;
    }
}

function askRemove(id: string): void {
    removing.value = item(id);
}

async function confirmRemove(): Promise<void> {
    const target = removing.value;
    removing.value = null;
    if (target === null) return;
    const outcome = await props.page.remove(target.id);
    if (outcome.ok) {
        localNotice.value = null;
        await nextTick();
        shelf.value?.focusShelf();
    } else {
        localNotice.value = outcome.message;
    }
}

function dismissNotice(): void {
    localNotice.value = null;
    props.page.dismissNotice();
}
</script>

<template>
    <BookshelfPage
        ref="shelf"
        :locale="locale"
        :status="page.status.value"
        :error="page.error.value"
        :items="page.items.value"
        :now="page.now.value"
        :view="page.view.value"
        :sort="page.sort.value"
        :active-id="page.activeId.value"
        :notice="notice"
        @update:view="page.setView"
        @update:sort="page.setSort"
        @update:active-id="page.select"
        @continue="page.continueWriting"
        @open="page.open"
        @open-new-window="page.openInNewWindow"
        @edit="startEdit"
        @remove="askRemove"
        @create="startCreate"
        @add-existing="page.addExisting"
        @enter-workbench="page.enterWorkbench"
        @retry="page.refresh(true)"
        @dismiss-notice="dismissNotice"
    />
    <ProjectInfoDialog
        :locale="locale"
        :open="dialog !== null"
        :mode="dialog?.mode ?? 'create'"
        :initial="dialog?.mode === 'edit' ? dialog.initial : undefined"
        :busy="dialogBusy"
        :error="dialogError"
        @submit="submit"
        @cancel="dialog = null"
    />
    <AlertDialog
        :open="removing !== null"
        :title="text(formatText(TEXT.removeTitle, {title: removing === null ? '' : projectDisplayName(removing)}))"
        :description="text(TEXT.removeDescription)"
        :confirm-text="text(TEXT.remove)"
        :cancel-text="text(TEXT.cancel)"
        tone="danger"
        @confirm="confirmRemove"
        @cancel="removing = null"
        @update:open="(open: boolean) => { if (!open) removing = null; }"
    />
</template>
