<script setup lang="ts">
import {Button, Dialog} from "@notnotype/nb-ui/components";

/** 打字或按键之前的第二步：先看屏幕末尾再确认；契约见同名 .md。 */
withDefaults(defineProps<{open: boolean; title: string; message: string; screen: string | null; confirmLabel: string; tone?: "danger" | "primary"; pending?: boolean}>(), {tone: "danger", pending: false});
const emit = defineEmits<{confirm: []; cancel: []}>();
</script>

<template>
    <Dialog :open="open" :title="title" size="md" :busy="pending" @request-close="emit('cancel')">
        <div class="flex flex-col gap-3">
            <p>{{ message }}</p>
            <pre v-if="screen !== null" class="max-h-80 overflow-auto rounded-[var(--radius-control)] p-2 nbdev-pre" aria-label="会话屏幕末尾">{{ screen }}</pre>
            <p class="nbdev-empty" v-else>读不到屏幕</p>
        </div>
        <template #footer>
            <div class="flex justify-end gap-2">
                <Button variant="ghost" :disabled="pending" @click="emit('cancel')">取消</Button>
                <Button :variant="tone" :loading="pending" @click="emit('confirm')">{{ confirmLabel }}</Button>
            </div>
        </template>
    </Dialog>
</template>
