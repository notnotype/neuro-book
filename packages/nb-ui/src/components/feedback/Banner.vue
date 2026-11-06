<script setup lang="ts">
// 常驻横幅：区域或页面顶部一条满宽的状态带，平铺无投影；与 Notification 的区别是它不进队列、不自动消失，由宿主决定何时出现与收起。
import {computed} from "vue";

import {useUiText} from "../../text-port";
import type {Tone} from "../shared-types";

export type BannerTone = Extract<Tone, "info" | "success" | "warning" | "danger">;

const props = withDefaults(defineProps<{
    tone?: BannerTone;
    title?: string;
    message?: string;
    iconClass?: string;
    dismissible?: boolean;
    closeLabel?: string;
}>(), {
    tone: "info",
    title: "",
    message: "",
    iconClass: "",
    dismissible: false,
});

const emit = defineEmits<{
    (e: "dismiss"): void;
}>();

const text = useUiText();
const closeText = computed(() => props.closeLabel ?? text("banner.close"));
const toneClass = computed(() => `nb-banner--${props.tone}`);
// 错误用 alert：出现时读屏立刻播报；其余是 status，等当前朗读完再播。
const role = computed(() => (props.tone === "danger" ? "alert" : "status"));
const toneIcon = computed(() => {
    if (props.iconClass !== "") return props.iconClass;
    if (props.tone === "success") return "i-lucide-check-circle-2";
    if (props.tone === "warning") return "i-lucide-alert-triangle";
    if (props.tone === "danger") return "i-lucide-circle-x";
    return "i-lucide-info";
});
</script>

<template>
    <div :role="role" class="nb-banner flex w-full flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1.5 text-xs" :class="toneClass">
        <!-- 文字至少留 12em：放不下文字加按钮时，按钮整组换到下一行，而不是把文字挤成一列；
             换到下一行仍放不下（窄编辑组、英文长按钮）时，动作区不超出横幅，按钮在区内再换行。 -->
        <span class="flex min-w-[min(12em,100%)] flex-1 items-start gap-2">
            <span class="nb-banner__icon mt-px h-3.5 w-3.5 shrink-0" :class="toneIcon" aria-hidden="true"></span>
            <span class="min-w-0 break-words">
                <span v-if="$slots.title || props.title" class="mr-2 font-medium">
                    <slot name="title">{{ props.title }}</slot>
                </span>
                <span class="text-[var(--text-secondary)]">
                    <slot>{{ props.message }}</slot>
                </span>
            </span>
        </span>
        <span v-if="$slots.actions" class="flex min-w-0 max-w-full flex-wrap items-center gap-2">
            <slot name="actions" />
        </span>
        <button v-if="props.dismissible" type="button" class="nb-ui-focus-ring -mr-1 shrink-0 rounded-[calc(var(--radius-control)*0.75)] p-0.5 text-[var(--text-muted)] hover:bg-[color-mix(in_srgb,var(--text-main)_10%,transparent)] hover:text-[var(--text-main)] cursor-pointer" :aria-label="closeText" :title="closeText" @click="emit('dismiss')">
            <span class="i-lucide-x h-3.5 w-3.5" aria-hidden="true"></span>
        </button>
    </div>
</template>

<style scoped>
.nb-banner {
    --nb-banner-tone: var(--accent-main);
    border-color: color-mix(in srgb, var(--nb-banner-tone) 25%, transparent);
    background: color-mix(in srgb, var(--nb-banner-tone) 9%, var(--bg-panel));
    color: var(--text-main);
}

.nb-banner__icon {
    color: var(--nb-banner-tone);
}

.nb-banner--success {
    --nb-banner-tone: var(--status-success);
}

.nb-banner--warning {
    --nb-banner-tone: var(--status-warning);
}

.nb-banner--danger {
    --nb-banner-tone: var(--status-danger);
}
</style>
