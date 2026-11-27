<script setup lang="ts">
/**
 * 模块分页的“原始视图”（同名 .md，docs/specs/canon/author-ui.md 输出 54）：初值里这个模块的原样与改过它的剧情变更。读取、
 * 按命名空间裁剪由宿主做，这里只显示；不跟“在看”走。
 */
import {Button} from "@notnotype/nb-ui/components";
import JsonViewer from "nbook/ui/JsonViewer.vue";

import {useCanonText} from "../../text";

const props = defineProps<{
    /** 初值里这个模块的数据；不给（undefined）是初值里没有这个模块。 */
    initial?: unknown;
    changes: readonly unknown[];
    total: number;
    remaining: number;
    initialLoading: boolean;
    changesLoading: boolean;
    failed: string | null;
}>();

const emit = defineEmits<{
    (event: "more"): void;
    (event: "retry"): void;
}>();

const text = useCanonText();
const PAGE = 20;
</script>

<template>
    <div class="flex flex-col gap-5" data-raw-view>
        <p class="m-0 text-[length:var(--text-xs)] text-[var(--text-muted)]" data-raw-head>{{ text("entry.views.rawHead") }}</p>
        <p v-if="props.failed !== null" role="alert" class="flex items-center gap-2 text-[length:var(--text-sm)] text-[var(--status-warning)]">
            <span>{{ text("entry.views.failed", {reason: props.failed}) }}</span>
            <Button size="sm" variant="ghost" @click="emit('retry')">{{ text("entry.views.retry") }}</Button>
        </p>
        <section data-raw-initial>
            <h3 class="component-raw-view__title">{{ text("entry.views.initial") }}</h3>
            <p v-if="props.initialLoading && props.initial === undefined" class="component-raw-view__note">{{ text("entries.loading") }}</p>
            <p v-else-if="props.initial === undefined" class="component-raw-view__note">{{ text("entry.views.initialNone") }}</p>
            <JsonViewer v-else :value="props.initial" :max-height="320" />
        </section>
        <section data-raw-changes>
            <h3 class="component-raw-view__title">{{ text("entry.views.changes", {count: props.total}) }}</h3>
            <p v-if="props.changesLoading && props.changes.length === 0" class="component-raw-view__note">{{ text("entries.loading") }}</p>
            <p v-else-if="props.changes.length === 0" class="component-raw-view__note">{{ text("entry.views.changesNone") }}</p>
            <JsonViewer v-else :value="props.changes" :max-height="480" />
            <Button v-if="props.remaining > 0" class="mt-2" size="sm" variant="ghost" :loading="props.changesLoading" data-raw-more @click="emit('more')">{{ text("entry.views.more", {count: Math.min(PAGE, props.remaining)}) }}</Button>
        </section>
    </div>
</template>

<style scoped>
.component-raw-view__title {
    margin: 0 0 8px;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    font-weight: 500;
}
.component-raw-view__note {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
}
</style>
