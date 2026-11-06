<script setup lang="ts">
import {Notification, type NotificationTone} from "@notnotype/nb-ui/components";
import {ref, watch} from "vue";
import type {Notice, NoticeOutcome} from "../host/writes.js";

/** 一次写入的结果：结果的颜色只由结果决定，附注（警告）缩进折叠在下面。契约见同名 .md。 */
const props = defineProps<{notice: Notice}>();
const emit = defineEmits<{dismiss: []; retry: []}>();
const TONE: Record<NoticeOutcome, NotificationTone> = {success: "success", failure: "danger", conflict: "warning", unknown: "warning", info: "info"};
const notesOpen = ref(false);
watch(() => props.notice, () => {
    notesOpen.value = false;
});
</script>

<template>
    <Notification :tone="TONE[notice.outcome]" :title="notice.title" dismissible :action-label="notice.retry ? '重试' : ''" @dismiss="emit('dismiss')" @action="emit('retry')">
        <p v-if="notice.message">{{ notice.message }}</p>
        <ul v-if="notice.items.length > 0" class="nbdev-small mt-1 flex list-disc flex-col gap-0.5 pl-4">
            <li v-for="(item, index) in notice.items" :key="index">{{ item }}</li>
        </ul>
        <div v-if="notice.notes.length > 0" class="nbdev-note mt-1.5">
            <button type="button" class="inline-flex items-center gap-1 rounded-[var(--radius-control)] hover:text-[var(--text-main)]" :aria-expanded="notesOpen" @click="notesOpen = !notesOpen">
                <span :class="notesOpen ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-3.5" aria-hidden="true" />附注 {{ notice.notes.length }} 条
            </button>
            <ul v-if="notesOpen" class="mt-1 flex list-disc flex-col gap-0.5 pl-8">
                <li v-for="(note, index) in notice.notes" :key="index">{{ note }}</li>
            </ul>
        </div>
    </Notification>
</template>
