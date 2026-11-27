<script setup lang="ts">
/**
 * 导入页 `/import`（docs/specs/story/viewer.md 输出 37、40、F6）：选一个 TXT，先在浏览器里查大小与 UTF-8（不合格就地
 * 说明、不上传），书名默认取文件名；按 `ingest.preview` 写明会做哪一种，开始后进入这本书的进度页。
 *
 * 预览与开始都把文件的字节（base64，浏览器原生的 FileReader 编，不占主线程）交给服务，服务再解码、切章。改书名会
 * 换书 id：一改就作废当前的预览（不能开始），停手 400 毫秒后重新预览；新预览开始时中止旧的，离开页面时全部停掉。
 *
 * 记不记数值与秘密（ingest.md 输出 18）：新书的选择存在 `choice`，只在开始一本新书时随 `ingest.start` 发出；预览不带它，
 * 所以书名换到一本已有的书时不会因设置不同而失败，页面改为写出那本书保存的设置（`plan.features`）。两份分开存，换书名
 * 不会互相覆盖。预览之后别处先建了同 id 的书、设置又不同时，开始得到 invalid_params，就地写明原因。
 */
import {Button, Input, Switch, Table} from "@notnotype/nb-ui/components";
import {computed, onBeforeUnmount, ref, shallowRef, watch} from "vue";
import {useRouter} from "vue-router";

import type {IngestPlanView} from "../../contract/contract";
import {StoryCallError, useStoryClient} from "../host/client";
import ThemeMenu from "../parts/ThemeMenu.vue";
import GraphImport from "./GraphImport.vue";

const client = useStoryClient();
const router = useRouter();

/** 与服务端相同的上限（ingest.md“原文与切章”）。 */
const MAX_SOURCE_BYTES = 32 * 1024 * 1024;

const fileInput = ref<HTMLInputElement | null>(null);
const file = shallowRef<{name: string; bytes: number; content: string} | null>(null);
const fileError = ref<string | null>(null);
const reading = ref(false);
const title = ref("");
const plan = shallowRef<IngestPlanView | null>(null);
const previewError = shallowRef<StoryCallError | null>(null);
const previewing = ref(false);
const starting = ref(false);
const startError = ref<string | null>(null);
const showAll = ref(false);
/** 新书记不记数值与秘密；默认都记。 */
const choice = ref({ledger: true, secrets: true});
/** 已有的书保存的设置，一句话。 */
const savedSetting = computed(() => {
    const features = plan.value?.features;
    if (!features) return "";
    const off = [...(features.ledger ? [] : ["数值"]), ...(features.secrets ? [] : ["秘密"])];
    return off.length === 0 ? "这本书记录数值与秘密（新建时定的，不能改）。" : `这本书不记${off.join("、")}（新建时定的，不能改）。`;
});

const PREVIEW_ROWS = 8;
const COLUMNS = [
    {key: "chapter" as const, label: "章", width: "64px", align: "right" as const},
    {key: "title" as const, label: "标题"},
    {key: "chars" as const, label: "字数", width: "96px", align: "right" as const},
];
const numberText = (value: number) => value.toLocaleString("zh-CN");
const charsText = (value: number) => (value >= 10_000 ? `${(value / 10_000).toFixed(value >= 1_000_000 ? 0 : 1)} 万` : numberText(value));
const shownChapters = computed(() => {
    const all = plan.value?.chapters ?? [];
    return (showAll.value ? all : all.slice(0, PREVIEW_ROWS)).map(chapter => ({...chapter, chars: numberText(chapter.chars)}));
});
const totalChars = computed(() => (plan.value?.chapters ?? []).reduce((sum, chapter) => sum + chapter.chars, 0));
const remaining = computed(() => (plan.value ? plan.value.chapters.length - plan.value.committed : 0));
const startLabel = computed(() => (plan.value?.action === "new" ? "开始抽取" : `接着抽 ${remaining.value} 章`));
const titleEmpty = computed(() => title.value.trim() === "");

function sizeText(bytes: number): string {
    return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MiB` : `${Math.max(1, Math.round(bytes / 1024))} KiB`;
}

/** 文件的 base64：FileReader 在浏览器里异步编码，几十 MB 也不卡页面。 */
function readBase64(chosen: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(",") + 1));
        reader.onerror = () => reject(reader.error ?? new Error("读不了文件"));
        reader.readAsDataURL(chosen);
    });
}

let previewController: AbortController | null = null;
let titleTimer: ReturnType<typeof setTimeout> | null = null;
/** 书名由选文件设上的：这次变化不必再预览（选文件后马上就预览）。 */
let titleFromFile = false;

async function pick(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const chosen = input.files?.[0];
    // 清掉选择：原地另存为 UTF-8 后再选同一个文件，浏览器才会再发 change。
    input.value = "";
    if (!chosen) return;
    fileError.value = null;
    file.value = null;
    plan.value = null;
    previewError.value = null;
    startError.value = null;
    if (chosen.size > MAX_SOURCE_BYTES) {
        fileError.value = `“${chosen.name}”有 ${sizeText(chosen.size)}，超过 32 MiB 的上限：分成几个文件，或先导入前一部分，之后用多出新章的文件追加。`;
        return;
    }
    reading.value = true;
    try {
        try {
            new TextDecoder("utf-8", {fatal: true}).decode(await chosen.arrayBuffer());
        } catch {
            fileError.value = `“${chosen.name}”不是 UTF-8 编码。只收 UTF-8 的 TXT：先用文本编辑器另存为 UTF-8 再选。`;
            return;
        }
        file.value = {name: chosen.name, bytes: chosen.size, content: await readBase64(chosen)};
    } finally {
        reading.value = false;
    }
    titleFromFile = true;
    title.value = chosen.name.replace(/\.[^.]+$/u, "");
    void preview();
}

async function preview(): Promise<void> {
    if (titleTimer !== null) clearTimeout(titleTimer);
    titleTimer = null;
    previewController?.abort();
    plan.value = null;
    previewError.value = null;
    if (!file.value || titleEmpty.value) {
        previewing.value = false;
        return;
    }
    const current = new AbortController();
    previewController = current;
    previewing.value = true;
    startError.value = null;
    try {
        const result = await client.call("ingest.preview", {content: file.value.content, title: title.value.trim()}, {signal: current.signal});
        if (current.signal.aborted) return;
        plan.value = result;
    } catch (caught) {
        if (current.signal.aborted) return;
        if (!(caught instanceof StoryCallError)) throw caught;
        previewError.value = caught;
    } finally {
        if (previewController === current) previewing.value = false;
    }
}

const TITLE_DEBOUNCE_MS = 400;
watch(title, (value, old) => {
    if (titleFromFile) {
        titleFromFile = false;
        return;
    }
    if (!file.value || value === old) return;
    // 书名一变，当前的预览就不对应要开始的那本了：先作废，等新的预览回来才能开始。
    previewController?.abort();
    plan.value = null;
    previewError.value = null;
    previewing.value = !titleEmpty.value;
    if (titleTimer !== null) clearTimeout(titleTimer);
    titleTimer = setTimeout(() => void preview(), TITLE_DEBOUNCE_MS);
});

onBeforeUnmount(() => {
    if (titleTimer !== null) clearTimeout(titleTimer);
    previewController?.abort();
});

const START_HINT: Record<string, string> = {
    ingest_running: "这本书正在抽取（可能在命令行里）：去它的进度页看，或在运行它的地方停下后再来。",
    qa_unconfigured: "还没有配置抽取用的模型：先在终端里运行 nbstory config init 配好模型。",
    book_exists: "书架上已有同名的书是导入数据文件得来的，不能抽取：换一个书名。",
};

async function start(): Promise<void> {
    if (!file.value || !plan.value) return;
    starting.value = true;
    startError.value = null;
    try {
        const result = await client.call("ingest.start", {content: file.value.content, title: title.value.trim(), ...(plan.value.action === "new" ? {features: {...choice.value}} : {})});
        await router.push(`/ingest/${encodeURIComponent(result.id)}`);
    } catch (caught) {
        if (!(caught instanceof StoryCallError)) throw caught;
        startError.value = START_HINT[caught.code] ?? caught.message;
    } finally {
        starting.value = false;
    }
}
</script>

<template>
    <main class="story-scroll-y h-full" data-testid="import-page">
        <div class="mx-auto flex max-w-[720px] flex-col gap-4 p-4 sm:p-6">
            <nav class="flex items-center gap-1 text-[length:var(--text-sm)] text-[var(--text-muted)]">
                <RouterLink to="/" class="flex items-center gap-1 hover:text-[var(--text-secondary)]"><span class="i-lucide-library" />书架</RouterLink>
                <span class="i-lucide-chevron-right" />导入原文
                <ThemeMenu class="ml-auto" />
            </nav>
            <h1 class="text-[length:var(--text-lg)] font-[var(--weight-strong)]">导入原文</h1>

            <input ref="fileInput" type="file" accept=".txt,text/plain" class="hidden" data-testid="import-file" @change="pick" />
            <section class="flex items-center gap-3 rounded-[var(--radius-control)] border border-dashed border-[var(--divider)] px-4 py-3">
                <span class="i-lucide-file-text text-[length:var(--text-lg)] text-[var(--text-secondary)]" />
                <div class="min-w-0 flex-1">
                    <div class="truncate font-[var(--weight-strong)]">{{ file ? file.name : reading ? "正在读取……" : "还没有选文件" }}</div>
                    <div class="text-[length:var(--text-xs)] text-[var(--text-muted)]">{{ file ? `${sizeText(file.bytes)} · UTF-8 · ` : "" }}只收 UTF-8 的 TXT，不超过 32 MiB</div>
                </div>
                <Button size="sm" :variant="file ? 'secondary' : 'primary'" :disabled="reading" @click="fileInput?.click()">{{ file ? "换一个文件" : "选择文件" }}</Button>
            </section>
            <p v-if="fileError" class="text-[length:var(--text-sm)] text-[var(--status-danger)]" role="alert" data-testid="import-file-error">{{ fileError }}</p>

            <template v-if="file">
                <section class="grid grid-cols-[72px_1fr] items-center gap-x-3 gap-y-2">
                    <label class="text-[length:var(--text-sm)] text-[var(--text-secondary)]" for="import-title">书名</label>
                    <Input id="import-title" v-model="title" data-testid="import-title" />
                    <span class="text-[length:var(--text-sm)] text-[var(--text-secondary)]">书 id</span>
                    <span class="min-w-0 truncate text-[length:var(--text-sm)] text-[var(--text-muted)]" data-testid="import-id">{{ plan ? `${plan.id}（由书名得到）` : titleEmpty ? "填一个书名" : previewing ? "正在切章……" : "—" }}</span>
                </section>

                <section v-if="previewError" class="flex flex-col gap-1 rounded-[var(--radius-control)] border border-[var(--status-danger)] px-4 py-3 text-[length:var(--text-sm)]" data-testid="import-problem" :data-code="previewError.code">
                    <div class="text-[var(--status-danger)]"><span class="i-lucide-circle-x mr-1 align-[-2px]" />{{ previewError.message }}</div>
                    <div v-if="previewError.code === 'ingest_text_changed'" class="text-[var(--text-muted)]">改稿重抽不支持：换一个书名重新抽（得到新的一本），或在终端里用 <code>nbstory remove</code> 删掉这本后重抽。</div>
                    <!-- 大小与编码已在浏览器里查过，服务端再报这个码时是切不出章。 -->
                    <div v-else-if="previewError.code === 'ingest_bad_text'" class="text-[var(--text-muted)]">检查章标题的写法：每章以“第 N 章”或“序章”“番外”这类标题单独起一行。</div>
                </section>

                <section v-if="plan" class="flex flex-col gap-1 rounded-[var(--radius-control)] bg-[var(--bg-subtle)] px-4 py-3 text-[length:var(--text-sm)]" data-testid="import-plan" :data-action="plan.action">
                    <template v-if="plan.action === 'new'">
                        <div><span class="i-lucide-sparkles mr-1 align-[-2px] text-[var(--accent-text)]" />新书：切出 <b>{{ numberText(plan.chapters.length) }}</b> 章，共 <b>{{ charsText(totalChars) }}</b>字，从第 1 章开始抽。</div>
                        <div class="text-[var(--text-muted)]">第一个章标题之前的 {{ numberText(plan.preambleChars) }} 字（书名、简介）不算正文<template v-if="plan.volumeLines">；{{ plan.volumeLines }} 个卷标题行不计入</template>。</div>
                    </template>
                    <div v-else-if="plan.action === 'append'"><span class="i-lucide-plus-circle mr-1 align-[-2px] text-[var(--accent-text)]" />已抽完 <b>{{ plan.committed }} / {{ plan.chapters.length - plan.newChapters }}</b> 章；文件多出 <b>{{ plan.newChapters }}</b> 章，接着抽第 {{ plan.committed + 1 }} 到 {{ plan.chapters.length }} 章。</div>
                    <div v-else-if="plan.action === 'resume'"><span class="i-lucide-play-circle mr-1 align-[-2px] text-[var(--accent-text)]" />这本书已抽完 <b>{{ plan.committed }} / {{ plan.chapters.length }}</b> 章，接着抽第 {{ plan.committed + 1 }} 到 {{ plan.chapters.length }} 章。</div>
                    <div v-else><span class="i-lucide-circle-check mr-1 align-[-2px] text-[var(--status-success)]" />这本书已经全部抽完（{{ plan.chapters.length }} 章）。<RouterLink :to="`/book/${encodeURIComponent(plan.id)}`" class="text-[var(--accent-text)]">打开书</RouterLink></div>
                    <div v-if="plan.action !== 'done'" class="text-[var(--text-muted)]">
                        <template v-if="plan.model">抽取模型 {{ plan.model.id }}{{ plan.model.source === "ingest.model" ? "（配置文件的 ingest.model）" : "（没有配置 ingest.model，用的是问答的模型）" }}。</template>
                        <template v-else-if="plan.modelProblem"><span class="text-[var(--status-warning)]" data-testid="import-model-problem">{{ plan.modelProblem }}</span>（在设置页的“抽取”里写）。</template>
                        <template v-else>还没有配置抽取用的模型：先在终端里运行 <code>nbstory config init</code>。</template>
                        {{ plan.action === "new" ? "每章约 4 到 5 分钟，抽完第 1 章就能打开；随时可以停下，之后接着抽。" : "每章约 4 到 5 分钟，随时可以停下，之后接着抽。" }}
                    </div>
                </section>

                <section v-if="plan" class="flex flex-col gap-2">
                    <h2 class="text-[length:var(--text-sm)] font-[var(--weight-strong)]">切章结果 <span class="font-normal text-[var(--text-muted)]">（{{ showAll || plan.chapters.length <= PREVIEW_ROWS ? `共 ${numberText(plan.chapters.length)} 章` : `前 ${PREVIEW_ROWS} 章，共 ${numberText(plan.chapters.length)} 章` }}）</span></h2>
                    <Table :columns="COLUMNS" :rows="shownChapters" row-key="chapter" density="compact" data-testid="import-chapters" />
                    <Button v-if="!showAll && plan.chapters.length > PREVIEW_ROWS" class="self-start" size="sm" variant="ghost" @click="showAll = true">展开全部 {{ numberText(plan.chapters.length) }} 章</Button>
                </section>

                <section v-if="plan && plan.action === 'new'" class="flex flex-col gap-2" data-testid="import-features">
                    <label class="flex items-center gap-3 text-[length:var(--text-sm)]">
                        <Switch v-model="choice.ledger" size="sm" aria-label="记录数值" data-testid="import-ledger" />
                        <span>记录数值<span class="ml-1 text-[var(--text-muted)]">钱、道具、任务进度</span></span>
                    </label>
                    <label class="flex items-center gap-3 text-[length:var(--text-sm)]">
                        <Switch v-model="choice.secrets" size="sm" aria-label="记录秘密" data-testid="import-secrets" />
                        <span>记录秘密<span class="ml-1 text-[var(--text-muted)]">身份秘密与谁知道</span></span>
                    </label>
                    <p class="text-[length:var(--text-xs)] text-[var(--text-muted)]">用不上的可以关掉，省一些费用；开始后不能再改。</p>
                </section>
                <p v-else-if="plan" class="text-[length:var(--text-sm)] text-[var(--text-secondary)]" data-testid="import-saved-features">{{ savedSetting }}</p>

                <p v-if="startError" class="text-[length:var(--text-sm)] text-[var(--status-danger)]" role="alert" data-testid="import-start-error">{{ startError }}</p>
                <div class="flex flex-wrap items-center gap-2">
                    <Button variant="primary" v-if="plan && plan.action !== 'done'" icon-class="i-lucide-play" :disabled="previewing || starting || titleEmpty" data-testid="import-start" @click="start">{{ startLabel }}</Button>
                    <Button variant="ghost" @click="router.push('/')">取消</Button>
                    <span v-if="plan && plan.action !== 'done'" class="text-[length:var(--text-xs)] text-[var(--text-muted)]">开始后可以离开这一页，进度在书架和进度页上</span>
                </div>
            </template>
            <GraphImport />
        </div>
    </main>
</template>
