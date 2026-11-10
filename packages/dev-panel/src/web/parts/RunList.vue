<script setup lang="ts">
import {relativeTime} from "../host/format.js";
import {isPlainClick} from "../host/routes.js";
import type {RunView} from "../host/types.js";

withDefaults(defineProps<{runs: RunView[]; showPane?: boolean}>(), {showPane: false});
const emit = defineEmits<{navigate: [href: string]}>();
const base = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const paneHref = (paneId: string) => `/live/sessions?pane=${encodeURIComponent(paneId)}`;
function follow(event: MouseEvent, href: string): void {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    emit("navigate", href);
}
</script>

<template>
    <ul class="flex flex-col gap-1 nbdev-small">
        <li v-for="run in runs" :key="run.pid" class="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <span class="i-lucide-cog size-3 shrink-0 self-center nbdev-empty" aria-hidden="true" />
            <code class="min-w-0 max-w-full flex-1 truncate" :title="run.command">{{ run.command }}</code>
            <span class="nbdev-secondary">{{ base(run.checkout) }} · {{ relativeTime(run.startedAt) }}起 · pid {{ run.pid }}<template v-if="run.descendants.length > 0"> · {{ run.descendants.length }} 个子进程</template><template v-if="run.unit"> · {{ run.unit }}</template><template v-if="showPane && run.paneId"> · <a :href="paneHref(run.paneId)" class="underline-offset-2 hover:underline" @click="follow($event, paneHref(run.paneId))">窗格 <span class="font-mono">{{ run.paneId }}</span></a></template></span>
            <span class="nbdev-warn" v-if="run.sessionAlive === false">派出它的会话已不在</span>
        </li>
    </ul>
</template>
