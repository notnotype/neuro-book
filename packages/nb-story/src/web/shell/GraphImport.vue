<script setup lang="ts">
import {Button, Input} from "@notnotype/nb-ui/components";
import {ref} from "vue";
import {useRouter} from "vue-router";

import {StoryCallError, useStoryClient} from "../host/client";

/** 与服务端相同的上限（`ingest/text.ts` 的 MAX_SOURCE_BYTES）。 */
const MAX_BYTES = 32 * 1024 * 1024;

const client = useStoryClient();
const router = useRouter();
const input = ref<HTMLInputElement | null>(null);
const file = ref<{name: string; bytes: number; content: string} | null>(null);
const title = ref("");
const error = ref<string | null>(null);
const busy = ref(false);

const HINT: Record<string, string> = {
    book_exists: "书架上已有同 id 的书：给一个不同的书名（书 id 由书名得到），或先在终端里 nbstory remove 删掉旧的。",
    unsupported_format: "这不是 V9 记忆图文件（nbstory 抽取或导出的 JSON）。",
};

function readBase64(chosen: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(",") + 1));
        reader.onerror = () => reject(reader.error ?? new Error("读不了文件"));
        reader.readAsDataURL(chosen);
    });
}

async function pick(event: Event): Promise<void> {
    const element = event.target as HTMLInputElement;
    const chosen = element.files?.[0];
    element.value = "";
    if (!chosen) return;
    error.value = null;
    file.value = null;
    if (chosen.size > MAX_BYTES) {
        error.value = `“${chosen.name}”超过 32 MiB 的上限。`;
        return;
    }
    file.value = {name: chosen.name, bytes: chosen.size, content: await readBase64(chosen)};
}

async function submit(): Promise<void> {
    if (!file.value) return;
    busy.value = true;
    error.value = null;
    try {
        const result = await client.call("book.importGraph", {content: file.value.content, ...(title.value.trim() === "" ? {} : {title: title.value.trim()})});
        await router.push(`/book/${encodeURIComponent(result.id)}`);
    } catch (caught) {
        if (!(caught instanceof StoryCallError)) throw caught;
        error.value = HINT[caught.code] ?? caught.message;
    } finally {
        busy.value = false;
    }
}
</script>

<template>
    <section class="flex flex-col gap-2 rounded-[var(--radius-control)] border border-[var(--divider)] px-4 py-3" data-testid="graph-import">
        <h2 class="text-[length:var(--text-md)] font-[var(--weight-strong)]">导入已经抽好的记忆图</h2>
        <p class="text-[length:var(--text-xs)] text-[var(--text-muted)]">有一份 nbstory 抽好的记忆图文件（V9，JSON 或 .json.gz）时，直接导入就能查、能问，不调用模型。</p>
        <input ref="input" type="file" accept=".json,.gz,application/json,application/gzip" class="hidden" data-testid="graph-import-file" @change="pick" />
        <div class="flex items-center gap-3">
            <span class="i-lucide-file-json text-[length:var(--text-lg)] text-[var(--text-secondary)]" />
            <span class="min-w-0 flex-1 truncate" data-testid="graph-import-name">{{ file ? file.name : "还没有选文件" }}</span>
            <Button size="sm" :variant="file ? 'secondary' : 'primary'" @click="input?.click()">{{ file ? "换一个文件" : "选择文件" }}</Button>
        </div>
        <div v-if="file" class="grid grid-cols-[72px_1fr] items-center gap-x-3 gap-y-2">
            <label class="text-[length:var(--text-sm)] text-[var(--text-secondary)]" for="graph-import-title">书名</label>
            <Input id="graph-import-title" v-model="title" placeholder="不填就用文件里的书名" data-testid="graph-import-title" />
        </div>
        <p v-if="error" class="text-[length:var(--text-sm)] text-[var(--status-danger)]" role="alert" data-testid="graph-import-error">{{ error }}</p>
        <div v-if="file"><Button variant="primary" size="sm" :disabled="busy" data-testid="graph-import-submit" @click="submit">{{ busy ? "导入中…" : "导入" }}</Button></div>
    </section>
</template>
