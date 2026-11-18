<script setup lang="ts">
/** 插图卡片（同名 .md）：在光标下方列出存放目录里的图、按名字找图、插入网址的图、上传本机的图。 */
import {AnchoredPopover, IconButton, Input, Spinner} from "@notnotype/nb-ui/components";
import {computed, nextTick, onBeforeUnmount, ref, useId, useTemplateRef, watch} from "vue";

import type {EditorMenus} from "nbook/plugins/editor/shared/contracts";

import type {MarkdownMedia, MediaImage} from "../../media";
import {imageFailureNotice, maybeStored} from "../../view-images";
import {altOfName, truncateMiddle, truncateStart} from "./image-card-text";
import type {PopoverAnchor} from "./selection-anchor";

/** `session`：宿主每打开一次就加一（同注音卡片）；`media` 为 null 是宿主没有提供插图能力（只能插入网址的图）。 */
const props = defineProps<{open: boolean; session: number; anchor: PopoverAnchor | null; menus: EditorMenus; media: MarkdownMedia | null; current: string | null}>();
const emit = defineEmits<{
    /** 选定了一张图：`address` 是作品里的资源地址，`url` 是网址；`name` 是文件名，说明由宿主取。 */
    (event: "insert", image: {readonly address: string | null; readonly url: string | null; readonly name: string}): void;
    (event: "cancel"): void;
    (event: "dismiss"): void;
}>();

/** 输入停手这么久才去找（毫秒）；空输入立即列出存放目录里的图。 */
const SEARCH_DELAY_MS = 150;
const NAME_MAX = 30;
const DIRECTORY_MAX = 28;
/** 只列出 PNG、JPEG、GIF、WebP（输出 54）：别的格式服务端不收。 */
const ACCEPT = "image/png,image/jpeg,image/gif,image/webp";
const URL_PATTERN = /^https?:\/\/\S+$/iu;

const query = ref("");
const items = ref<readonly MediaImage[]>([]);
const status = ref<"idle" | "loading" | "ready" | "error">("idle");
const truncated = ref(false);
const failure = ref("");
const activeIndex = ref(0);
const uploading = ref(false);
/** 系统的选文件框开着：窗口失焦不是“用户走开了”，卡片不收（输出 54）。 */
const choosing = ref(false);
/** 加载失败的缩略图：画占位图标。 */
const broken = ref<ReadonlySet<string>>(new Set());

const box = useTemplateRef<HTMLElement>("box");
const fileInput = useTemplateRef<HTMLInputElement>("fileInput");
const listId = `markdown-image-list-${useId()}`;
const rowId = (index: number): string => `${listId}-${String(index)}`;

const text = computed(() => query.value.trim());
const urlMode = computed(() => URL_PATTERN.test(text.value));
/** 能存进作品：绑定了作品、当前文件在作品里。 */
const canUpload = computed(() => props.media !== null && props.media.bound && props.media.destination(props.current, "a.png") !== null);
/** 能选的行数：网址模式只有一行。 */
const rowCount = computed(() => (urlMode.value ? 1 : items.value.length));

let searchTimer: ReturnType<typeof setTimeout> | null = null;
let loading: AbortController | null = null;
let uploadingNow: AbortController | null = null;
/** 每次请求加一：迟到的结果（输入又变了、卡片关了再开）丢弃。 */
let sequence = 0;

/** 放弃在途的读取：序号加一，被中止的请求返回的 `cancelled`（真实的远程调用中止后立刻回来）也算迟到的结果，丢掉。 */
function stopSearch(): void {
    if (searchTimer !== null) clearTimeout(searchTimer);
    searchTimer = null;
    loading?.abort();
    loading = null;
    sequence += 1;
}

async function refresh(): Promise<void> {
    const media = props.media;
    stopSearch();
    const mine = sequence;
    if (media === null || urlMode.value) {
        items.value = [];
        status.value = media === null ? "idle" : "ready";
        truncated.value = false;
        return;
    }
    status.value = "loading";
    const controller = new AbortController();
    loading = controller;
    const result = text.value === "" ? await media.recent(props.current, {signal: controller.signal}) : await media.find(text.value, {signal: controller.signal});
    if (mine !== sequence) return;
    loading = null;
    if (!result.ok) {
        items.value = [];
        failure.value = result.detail;
        status.value = "error";
        return;
    }
    items.value = result.images;
    truncated.value = result.truncated;
    activeIndex.value = 0;
    status.value = "ready";
}

// 打开一次重来：清空输入、列出存放目录里的图、焦点进输入框。
watch(() => [props.open, props.session] as const, async ([open]) => {
    if (!open) {
        stopSearch();
        uploadingNow?.abort();
        return;
    }
    query.value = "";
    items.value = [];
    failure.value = "";
    activeIndex.value = 0;
    broken.value = new Set();
    uploading.value = false;
    choosing.value = false;
    void refresh();
    await nextTick();
    box.value?.querySelector<HTMLInputElement>("input[data-markdown-image-query]")?.focus({preventScroll: true});
}, {flush: "post"});

watch(query, () => {
    if (!props.open) return;
    activeIndex.value = 0;
    stopSearch();
    if (text.value === "" || urlMode.value) void refresh();
    else searchTimer = setTimeout(() => void refresh(), SEARCH_DELAY_MS);
});

onBeforeUnmount(() => {
    stopSearch();
    uploadingNow?.abort();
});

function pick(index: number): void {
    if (urlMode.value) {
        if (index === 0) emit("insert", {address: null, url: text.value, name: ""});
        return;
    }
    const image = items.value[index];
    if (image !== undefined) emit("insert", {address: image.address, url: null, name: image.name});
}

function move(step: number): void {
    const count = rowCount.value;
    if (count === 0) return;
    activeIndex.value = (activeIndex.value + step + count) % count;
}

/** 组字中的方向键、回车与 Esc 归输入法。回车只在输入框里算选定：焦点在“上传”按钮上时回车是按钮的动作。 */
function onKeydown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    if (event.key === "Escape") {
        event.preventDefault();
        emit("cancel");
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        move(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter" && event.target instanceof HTMLInputElement && event.target.type === "text") {
        event.preventDefault();
        // 没有选中项（读取中、没有结果）时 `pick` 找不到行，什么也不做。
        pick(activeIndex.value);
    }
}

/** 焦点离开就收起；选文件框开着、上传在途时不算离开（窗口失焦也不算）。 */
function onFocusOut(event: FocusEvent): void {
    if (!props.open || choosing.value || uploading.value) return;
    if (!document.hasFocus()) return;
    if (!box.value?.contains(event.relatedTarget as Node | null)) emit("dismiss");
}

function chooseFile(): void {
    if (!canUpload.value || uploading.value) return;
    choosing.value = true;
    fileInput.value?.click();
}

/** 选文件框关闭（选了或取消）：窗口重新获得焦点，焦点回输入框。 */
function filePickerClosed(): void {
    choosing.value = false;
    box.value?.querySelector<HTMLInputElement>("input[data-markdown-image-query]")?.focus({preventScroll: true});
}

async function onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    const media = props.media;
    if (file === undefined || media === null) {
        filePickerClosed();
        return;
    }
    const name = media.localName(file);
    const address = media.destination(props.current, name);
    const fail = (code: string, detail: string): void => {
        const notice = imageFailureNotice({file: file.name, code, detail, stored: maybeStored(code)});
        props.menus.notify(notice.key, notice.params);
    };
    if (address === null) {
        fail("unavailable", "没有打开作品，不能保存图片");
        filePickerClosed();
        return;
    }
    const controller = new AbortController();
    uploadingNow = controller;
    uploading.value = true;
    const mine = props.session;
    const result = await media.upload(address, file, controller.signal);
    uploading.value = false;
    uploadingNow = null;
    // 卡片已经关了（Esc、换文档）：结果不再插入；图在作品里时给通知。
    if (!props.open || mine !== props.session) {
        if (!result.ok && maybeStored(result.code)) fail(result.code, result.detail);
        else if (result.ok) fail("not-inserted", result.address);
        return;
    }
    if (!result.ok) {
        fail(result.code, result.detail);
        filePickerClosed();
        return;
    }
    emit("insert", {address: result.address, url: null, name: result.address.slice(result.address.lastIndexOf("/") + 1)});
}

const thumbnailOf = (image: MediaImage): string | null => (broken.value.has(image.address) ? null : props.media?.thumbnail(image.address) ?? null);
function markBroken(address: string): void {
    broken.value = new Set([...broken.value, address]);
}
</script>

<template>
    <AnchoredPopover :open="props.open" :anchor="props.anchor" side="bottom" align="start">
        <div ref="box" class="markdown-image-card" data-markdown-menu-layer data-markdown-image-card @keydown="onKeydown" @focusout="onFocusOut">
            <div class="markdown-image-card__head">
                <Input
                    v-model="query"
                    variant="bare"
                    size="sm"
                    class="min-w-0 flex-1"
                    data-markdown-image-query
                    role="combobox"
                    aria-autocomplete="list"
                    :aria-expanded="rowCount > 0"
                    :aria-controls="listId"
                    :aria-activedescendant="rowCount > 0 ? rowId(activeIndex) : undefined"
                    :aria-label="props.menus.label('imageCardLabel')"
                    :placeholder="props.menus.label('imageCardPlaceholder')"
                />
                <IconButton
                    size="xs"
                    :icon-class="uploading ? 'i-lucide-loader-circle' : 'i-lucide-upload'"
                    :title="props.menus.label(uploading ? 'imageCardUploading' : 'imageCardUpload')"
                    :aria-label="props.menus.label('imageCardUpload')"
                    :disabled="!canUpload || uploading"
                    data-markdown-image-upload
                    @click="chooseFile"
                />
                <input ref="fileInput" type="file" class="hidden" :accept="ACCEPT" tabindex="-1" aria-hidden="true" data-markdown-image-file @change="onFile" @cancel="filePickerClosed" />
            </div>
            <div :id="listId" class="markdown-image-card__list" role="listbox" :aria-label="props.menus.label('imageCardLabel')" :aria-busy="status === 'loading'">
                <button v-if="urlMode" :id="rowId(0)" type="button" class="markdown-image-card__row" role="option" aria-selected="true" data-highlighted data-markdown-image-url @click="pick(0)">
                    <span class="markdown-image-card__thumb markdown-image-card__thumb--icon"><span class="i-lucide-link h-4 w-4" aria-hidden="true" /></span>
                    <span class="markdown-image-card__text">
                        <span class="markdown-image-card__name">{{ props.menus.label("imageCardUrl") }}</span>
                        <span class="markdown-image-card__directory">{{ truncateMiddle(text, DIRECTORY_MAX + NAME_MAX) }}</span>
                    </span>
                </button>
                <template v-else>
                    <button
                        v-for="(image, index) in items"
                        :id="rowId(index)"
                        :key="image.address"
                        type="button"
                        class="markdown-image-card__row"
                        role="option"
                        :aria-selected="index === activeIndex"
                        :data-highlighted="index === activeIndex ? '' : undefined"
                        data-markdown-image-row
                        :title="image.address"
                        @mousemove="activeIndex = index"
                        @click="pick(index)"
                    >
                        <span class="markdown-image-card__thumb">
                            <img v-if="thumbnailOf(image) !== null" :src="thumbnailOf(image) ?? undefined" :alt="altOfName(image.name)" width="32" height="32" loading="lazy" decoding="async" @error="markBroken(image.address)" />
                            <span v-else class="markdown-image-card__thumb--icon" :title="props.menus.label('imageCardNoPreview')"><span class="i-lucide-image-off h-4 w-4" aria-hidden="true" /></span>
                        </span>
                        <span class="markdown-image-card__text">
                            <span class="markdown-image-card__name">{{ truncateMiddle(image.name, NAME_MAX) }}</span>
                            <span class="markdown-image-card__directory">{{ truncateStart(image.directory, DIRECTORY_MAX) }}</span>
                        </span>
                    </button>
                </template>
            </div>
            <template v-if="!urlMode">
                <p v-if="status === 'loading' && items.length === 0" class="markdown-image-card__note" role="status"><Spinner size="sm" /> {{ props.menus.label("imageCardLoading") }}</p>
                <p v-else-if="status === 'error'" class="markdown-image-card__note markdown-image-card__note--error" role="status">{{ props.menus.label("imageCardFailed", {detail: failure}) }}</p>
                <p v-else-if="status === 'idle'" class="markdown-image-card__note" role="status">{{ props.menus.label("imageCardUrlOnly") }}</p>
                <p v-else-if="status === 'ready' && items.length === 0" class="markdown-image-card__note" role="status">{{ props.menus.label("imageCardEmpty") }}</p>
                <p v-if="status === 'ready' && truncated" class="markdown-image-card__note" role="status">{{ props.menus.label("imageCardMore") }}</p>
            </template>
        </div>
    </AnchoredPopover>
</template>

<style scoped>
.markdown-image-card {
    display: flex;
    flex-direction: column;
    width: min(30rem, calc(100vw - 32px));
}

/* 顶上一行：输入与“上传”，样子同注音卡片的一行。 */
.markdown-image-card__head {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px 4px 2px 10px;
}

.markdown-image-card__list {
    display: flex;
    flex-direction: column;
    max-height: 18rem;
    padding: 4px;
    overflow-y: auto;
    border-top: var(--border-w, 1px) solid var(--divider);
}

/* 没有行（读取中、没有结果、读不了）时列表没有内容：不画分隔线与内边距，状态说明紧接在输入下面。 */
.markdown-image-card__list:empty {
    display: none;
}

.markdown-image-card__row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 8px;
    border-radius: var(--radius-control);
    color: var(--text-main);
    text-align: start;
    transition: background-color var(--motion-fast) var(--ease-layout);
}

.markdown-image-card__row[data-highlighted] {
    background: var(--bg-hover);
}

.markdown-image-card__thumb {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    overflow: hidden;
    border-radius: var(--radius-control);
    background: var(--bg-hover);
}

.markdown-image-card__thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.markdown-image-card__thumb--icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: var(--text-muted);
}

.markdown-image-card__text {
    display: flex;
    min-width: 0;
    flex-direction: column;
}

.markdown-image-card__name {
    overflow: hidden;
    font-size: var(--text-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.markdown-image-card__directory {
    overflow: hidden;
    color: var(--text-muted);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.markdown-image-card__note {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    padding: 6px 8px;
    color: var(--text-muted);
    font-size: var(--text-sm);
}

.markdown-image-card__note--error {
    color: var(--status-danger);
}
</style>
