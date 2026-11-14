<script setup lang="ts">
/**
 * 关闭前询问的“正在关闭”层与宿主自己的询问（docs/specs/runtime/browser-host.md 输出 10）。状态与挡输入的做法在
 * `host/close-ui.ts`；这里只按状态画两个模态对话框：层在下，询问在上（后打开的模态叠在先打开的上面）。
 */
import {computed} from "vue";

import {Button, Dialog} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";

import type {CloseUi} from "./host/close-ui";
import {hostText} from "./host-text";

const props = defineProps<{ui: CloseUi}>();
const {t} = useText();

const layerOpen = computed(() => props.ui.state.value.layer);
const prompt = computed(() => props.ui.state.value.prompt);
const title = computed(() => {
    switch (prompt.value?.kind) {
        case "participant-failed":
            return t(hostText("close.participantFailed.title"));
        case "rescued-lost":
            return t(hostText("close.rescuedLost.title"));
        case "work":
            return t(hostText("close.work.title"));
        default:
            return "";
    }
});
</script>

<template>
    <Dialog
        :open="layerOpen"
        :title="t(hostText('close.layer.title'))"
        size="sm"
        :show-footer="false"
        :close-on-esc="false"
        :close-on-overlay="false"
        :close-on-request="false"
        data-close-layer
        @closed="ui.restoreFocus()"
    >
        <p class="text-sm text-[var(--text-muted)]">{{ t(hostText("close.layer.hint")) }}</p>
    </Dialog>
    <Dialog
        :open="prompt !== null"
        :title="title"
        size="sm"
        initial-focus="[data-close-cancel]"
        data-close-prompt
        @request-close="ui.answer('cancel')"
    >
        <template v-if="prompt?.kind === 'participant-failed'">
            <p class="text-sm">{{ t(hostText("close.participantFailed.body")) }}</p>
            <p class="mt-2 text-sm text-[var(--text-muted)]" data-close-reason>{{ prompt.reason }}</p>
        </template>
        <template v-else-if="prompt?.kind === 'rescued-lost'">
            <p class="text-sm">{{ t(hostText("close.rescuedLost.body")) }}</p>
            <ul class="mt-2 text-sm" data-close-items>
                <li v-for="path in prompt.paths" :key="path" class="truncate">{{ path }}</li>
            </ul>
        </template>
        <template v-else-if="prompt?.kind === 'work'">
            <p v-if="prompt.items.length > 0" class="text-sm">{{ t(hostText("close.work.body")) }}</p>
            <ul v-if="prompt.items.length > 0" class="mt-2 text-sm" data-close-items>
                <li v-for="(item, index) in prompt.items" :key="index">{{ t(item.text) }}</li>
            </ul>
            <p v-if="prompt.uncertain" class="mt-2 text-sm text-[var(--text-muted)]" data-close-uncertain>{{ t(hostText("close.work.uncertain")) }}</p>
        </template>
        <template #footer>
            <div class="flex flex-wrap justify-end gap-2">
                <Button variant="secondary" size="sm" data-close-cancel @click="ui.answer('cancel')">{{ t(hostText("close.cancel")) }}</Button>
                <Button variant="danger" size="sm" data-close-confirm @click="ui.answer('close')">{{ t(hostText("close.confirm")) }}</Button>
            </div>
        </template>
    </Dialog>
</template>
