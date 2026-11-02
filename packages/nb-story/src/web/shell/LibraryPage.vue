<script setup lang="ts">
/**
 * 书架（docs/specs/story/viewer.md 输出 35、36）：列出书库里的书与有抽取记录的书 id。登录后落到这里、书库里只有
 * 一本且没有在抽的书时直接打开它；从书里点“回到书架”过来（应用内导航，history.state.back 有值）时照常列出。地址里
 * 的书不在了时，书的外壳会带着 `missing` 回到这里（viewer F2）。
 *
 * 一直每 3 秒查一次书与抽取进度（别处开始的抽取也看得到，输出 36 要求 5 秒内跟上）；第 1 章还没提交的书只在
 * 抽取进度里，置灰、点不开。
 */
import {AlertDialog, Button, IconButton, Progress} from "@notnotype/nb-ui/components";
import {computed, onBeforeUnmount, onMounted, ref, shallowRef} from "vue";
import {useRoute, useRouter} from "vue-router";

import type {IngestStatusView, StoryResult} from "../../contract/contract";
import {StoryCallError, useStoryClient} from "../host/client";
import {STEP_LABELS, stopText} from "../host/ingest";
import IngestBadge from "../parts/IngestBadge.vue";
import ThemeMenu from "../parts/ThemeMenu.vue";

type Book = StoryResult<"books.list">["books"][number];
interface Row {
    id: string;
    title: string;
    book: Book | null;
    ingest: IngestStatusView | null;
}

const client = useStoryClient();
const route = useRoute();
const router = useRouter();
const books = shallowRef<Book[] | null>(null);
const ingests = shallowRef<IngestStatusView[]>([]);
const error = ref<string | null>(null);
const missing = typeof route.query.missing === "string" ? route.query.missing : null;

const rows = computed<Row[]>(() => {
    const byId = new Map<string, Row>();
    for (const book of books.value ?? []) byId.set(book.id, {id: book.id, title: book.title, book, ingest: null});
    for (const status of ingests.value) {
        const row = byId.get(status.id);
        if (row) row.ingest = status;
        else byId.set(status.id, {id: status.id, title: status.title, book: null, ingest: status});
    }
    return [...byId.values()];
});
const unfinished = computed(() => ingests.value.some(status => status.state !== "done"));

function note(status: IngestStatusView): string | null {
    if (status.state === "running" && status.current?.chapter) return `第 ${status.current.chapter} 章${status.current.step ? ` · ${STEP_LABELS[status.current.step]}` : ""}`;
    return stopText(status);
}

async function load(): Promise<void> {
    const [list, statuses] = await Promise.all([client.call("books.list", {}), client.call("ingest.status", {})]);
    books.value = list.books;
    ingests.value = statuses.books;
}

let timer: ReturnType<typeof setInterval> | null = null;
let disposed = false;
const POLL_MS = 3000;
onMounted(async () => {
    try {
        await load();
        // 第一次加载期间就离开了：不再自动打开书，也不起轮询。
        if (disposed) return;
        const fromApp = typeof (window.history.state as {back?: unknown} | null)?.back === "string";
        if (books.value!.length === 1 && !unfinished.value && !missing && !fromApp) {
            await router.replace(`/book/${encodeURIComponent(books.value![0]!.id)}`);
            return;
        }
    } catch (caught) {
        if (!(caught instanceof StoryCallError)) throw caught;
        error.value = caught.message;
        return;
    }
    timer = setInterval(() => {
        load().catch((caught: unknown) => {
            // 一次没查到不影响书架，下一轮再查。
            console.warn({error: caught}, "刷新书架失败");
        });
    }, POLL_MS);
});
// ---- 删除一本书（t29，命令行 `nbstory remove` 的网页版）：先确认；这本书在抽取或正在被问答占用时报原因 ----
const removing = ref<{id: string; title: string} | null>(null);
const removeOpen = ref(false);
const removeError = ref<string | null>(null);
function askRemove(row: {id: string; title: string}): void {
    removing.value = {id: row.id, title: row.title};
    removeError.value = null;
    removeOpen.value = true;
}
async function confirmRemove(): Promise<void> {
    const target = removing.value;
    if (target === null) return;
    try {
        await client.call("book.remove", {book: target.id});
        removing.value = null;
        await load();
    } catch (caught) {
        if (!(caught instanceof StoryCallError)) throw caught;
        removeError.value = caught.code === "ingest_running" ? `《${target.title}》正在抽取（可能在命令行里），先停下它再删。` : caught.message;
        removing.value = null;
    }
}

onBeforeUnmount(() => {
    disposed = true;
    if (timer !== null) clearInterval(timer);
});
</script>

<template>
    <main class="story-scroll-y h-full" data-testid="library">
        <div class="mx-auto flex max-w-[720px] flex-col gap-4 p-4 sm:p-6">
            <div class="flex items-center gap-2">
                <h1 class="flex items-center gap-2 text-[length:var(--text-lg)] font-[var(--weight-strong)]"><span class="i-lucide-library text-[var(--accent-text)]" />书架</h1>
                <Button class="ml-auto" size="sm" icon-class="i-lucide-file-plus" data-testid="go-import" @click="router.push('/import')">导入原文</Button>
                <Button size="sm" variant="secondary" icon-class="i-lucide-settings" data-testid="go-settings" @click="router.push('/settings')">设置</Button>
                <ThemeMenu />
            </div>
            <p v-if="missing" class="text-[var(--text-secondary)]" data-testid="book-missing">书“{{ missing }}”不在书库里了。</p>
            <p v-if="error" class="text-[var(--status-danger)]">{{ error }}</p>
            <p v-if="removeError" class="text-[var(--status-danger)]" role="alert" data-testid="shelf-remove-error">{{ removeError }}</p>
            <p v-else-if="books && rows.length === 0">书库里还没有书。点“导入原文”选一个 TXT，或在终端里用 <code>nbstory ingest &lt;原文.txt&gt;</code> 导入。</p>
            <ul v-else-if="books" class="flex flex-col gap-1">
                <li v-for="row in rows" :key="row.id" data-testid="shelf-row" :data-book="row.id">
                    <!-- 能打开的行整行可点：书名链接的 ::after 铺满整行，“进度”链接浮在它上面。 -->
                    <div class="relative flex flex-col gap-1.5 rounded-[var(--radius-control)] px-3 py-2" :class="row.book ? 'shelf-item' : ''">
                        <div class="flex items-baseline gap-3">
                            <span class="i-lucide-book self-center text-[var(--text-secondary)]" />
                            <RouterLink v-if="row.book" :to="`/book/${encodeURIComponent(row.id)}`" class="shelf-open min-w-0 truncate font-[var(--weight-strong)]" data-testid="shelf-open">{{ row.title }}</RouterLink>
                            <b v-else class="min-w-0 truncate text-[var(--text-secondary)]" title="抽完第 1 章后可以打开">{{ row.title }}</b>
                            <IngestBadge v-if="row.ingest" :status="row.ingest" class="self-center" />
                            <span class="ml-auto shrink-0 text-[length:var(--text-sm)] text-[var(--text-muted)]">
                                <template v-if="row.ingest && row.ingest.state !== 'done'">抽完 {{ row.ingest.committed }} / {{ row.ingest.total }} 章</template>
                                <template v-else-if="row.book">{{ row.book.chapters }} 章 · 抽取到 {{ row.book.extractedThrough.chapter }}.{{ row.book.extractedThrough.paragraph }}</template>
                            </span>
                            <RouterLink v-if="row.ingest && row.ingest.state !== 'done'" :to="`/ingest/${encodeURIComponent(row.id)}`" class="relative z-10 shrink-0 text-[length:var(--text-sm)] text-[var(--accent-text)]" data-testid="shelf-progress">进度</RouterLink>
                            <IconButton v-if="row.book" class="relative z-10 shrink-0" size="xs" icon-class="i-lucide-trash-2" :aria-label="`删除《${row.title}》`" :title="`删除《${row.title}》`" data-testid="shelf-remove" @click="askRemove(row)" />
                        </div>
                        <template v-if="row.ingest && row.ingest.state !== 'done'">
                            <Progress :model-value="row.ingest.committed" :max="row.ingest.total" size="sm" :tone="row.ingest.stopReason?.kind === 'failed' ? 'danger' : 'accent'" class="ml-7" />
                            <div class="ml-7 flex flex-wrap items-center gap-x-2 text-[length:var(--text-xs)] text-[var(--text-muted)]">
                                <span :class="row.ingest.stopReason?.kind === 'failed' ? 'text-[var(--status-danger)]' : ''">{{ note(row.ingest) }}</span>
                                <span v-if="!row.book">· 抽完第 1 章后可以打开</span>
                            </div>
                        </template>
                    </div>
                </li>
            </ul>
            <p class="text-[length:var(--text-xs)] text-[var(--text-muted)]">也可以在终端里用 <code>nbstory ingest &lt;原文.txt&gt;</code> 导入；导入现成的记忆图数据可以在导入页的第二块，或用 <code>nbstory import</code>。同时看几本书时各开一个浏览器标签。</p>
        </div>
        <AlertDialog
            v-model:open="removeOpen"
            :title="`删除《${removing?.title ?? ''}》`"
            description="这本书的数据、抽取记录与问答记录都会删掉，不能恢复。"
            confirm-label="删除"
            tone="danger"
            @confirm="confirmRemove"
        />
    </main>
</template>

<style scoped>
.shelf-item:hover {
    background: var(--bg-hover);
}
/* 盖住整行（进度条也是定位元素，所以要有层级），只让“进度”链接（z-10）露在上面。 */
.shelf-open::after {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 1;
}
</style>
