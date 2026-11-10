<script setup lang="ts">
import type {HTMLAttributes} from "vue";
import {computed, useSlots} from "vue";
import {useUiText} from "../../text-port";
import Progress from "../display/Progress.vue";
import type {NotificationTone} from "../../composables/useNotification";


const props = withDefaults(defineProps<{
    tone?: NotificationTone;
    title?: string;
    message?: string;
    dismissible?: boolean;
    actionLabel?: string;
    closeLabel?: string;
    /** 进度（0 到 100）：画一条进度条；null 为不确定进度（来回滑动的条）；不给就没有。 */
    progress?: number | null;
    hasDetail?: boolean;
    detailLabel?: string;
} & /* @vue-ignore */ HTMLAttributes>(), {
    tone: "info",
    title: "",
    message: "",
    dismissible: false,
    actionLabel: "",
    progress: undefined,
    hasDetail: false,
    detailLabel: undefined,
});

const emit = defineEmits<{
    (e: "dismiss"): void;
    (e: "action"): void;
    (e: "detail", trigger: HTMLButtonElement): void;
}>();

const slots = useSlots();
const text = useUiText();
const closeText = computed(() => props.closeLabel ?? text("notification.close"));
const detailText = computed(() => props.detailLabel ?? text("notification.detail"));
const hasAction = computed(() => slots.action !== undefined || props.actionLabel !== "");

const toneClass = computed(() => `nb-notification--${props.tone}`);
const iconClass = computed(() => {
    if (props.tone === "success") {
        return "i-lucide-check-circle-2";
    }
    if (props.tone === "warning") {
        return "i-lucide-alert-triangle";
    }
    if (props.tone === "danger") {
        return "i-lucide-circle-x";
    }
    return "i-lucide-info";
});
const progressTone = computed(() => {
    if (props.tone === "success") return "success";
    if (props.tone === "warning") return "warning";
    if (props.tone === "danger") return "danger";
    return "accent";
});
</script>

<template>
    <div role="status" class="nb-notification flex w-full items-start gap-3 rounded-[var(--radius-panel)] border px-4 py-3 text-sm shadow-lg transition-[transform,opacity] [transition-duration:var(--motion-base)] [transition-timing-function:var(--ease-layout)] select-none" :class="toneClass">
        <span class="mt-0.5 h-4 w-4 shrink-0" :class="iconClass"></span>
        <span class="min-w-0 flex-1">
            <span v-if="$slots.title || props.title" class="mb-1 block font-medium text-[var(--text-main)]">
                <slot name="title">{{ props.title }}</slot>
            </span>
            <span class="block leading-relaxed text-[var(--text-secondary)] [text-wrap:pretty]">
                <slot>{{ props.message }}</slot>
            </span>
            <!-- 进度在正文下：确定进度用 Progress；不确定进度是一条自己滑动的短条，减少动画时停在左边。 -->
            <span v-if="props.progress !== undefined" class="mt-2 block" data-notification-progress>
                <Progress v-if="props.progress !== null" :model-value="props.progress" size="sm" :tone="progressTone" />
                <span v-else class="nb-notification__indeterminate block h-1.5 w-full overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--text-main)_10%,transparent)]" role="progressbar" :aria-valuetext="text('notification.inProgress')">
                    <span class="nb-ui-indeterminate-runner block h-full rounded-full bg-[var(--nb-notification-tone)]"></span>
                </span>
            </span>
            <!-- 动作行：在正文下面单独一行、左对齐，不占正文右侧那一列（Notification.md 的“布局与状态”）。 -->
            <span v-if="hasAction || props.hasDetail" class="mt-1.5 -ml-1.5 flex flex-wrap items-center gap-1" data-notification-actions>
                <button v-if="hasAction" type="button" class="nb-notification__act nb-ui-focus-ring font-medium text-[var(--nb-notification-tone)]" data-notification-action @click="emit('action')">
                    <slot name="action">{{ props.actionLabel }}</slot>
                </button>
                <button v-if="props.hasDetail" type="button" class="nb-notification__act nb-notification__detail nb-ui-focus-ring text-[var(--text-secondary)]" data-notification-detail @click="emit('detail', $event.currentTarget as HTMLButtonElement)">
                    {{ detailText }}
                </button>
            </span>
        </span>
        <button v-if="props.dismissible" type="button" class="nb-ui-focus-ring -mr-1 shrink-0 rounded-[calc(var(--radius-control)*0.75)] p-0.5 text-[var(--text-muted)] transition-[background-color,color,transform] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-layout)] hover:bg-[color-mix(in_srgb,var(--text-main)_10%,transparent)] hover:text-[var(--text-main)] not-disabled:active:scale-[0.92] cursor-pointer" :aria-label="closeText" :title="closeText" @click="emit('dismiss')">
            <span class="i-lucide-x h-4 w-4"></span>
        </button>
    </div>
</template>

<style scoped>
.nb-notification {
    --nb-notification-tone: var(--accent-main);
    border-color: color-mix(in srgb, var(--nb-notification-tone) 28%, transparent);
    background: color-mix(in srgb, var(--nb-notification-tone) 10%, var(--bg-panel));
    color: var(--text-main);
}

/* 动作与“详情”：可见高 24px；点击区用伪元素上下各撑 4px 到 32px，左右不撑，相邻两颗不重叠。 */
.nb-notification__act {
    position: relative;
    display: inline-flex;
    align-items: center;
    height: 24px;
    padding: 0 6px;
    border-radius: calc(var(--radius-control) * 0.75);
    font-size: var(--text-sm);
    cursor: pointer;
    transition: background-color var(--motion-fast) var(--ease-layout), color var(--motion-fast) var(--ease-layout);
}

.nb-notification__act::before {
    content: "";
    position: absolute;
    inset: -4px 0;
}

.nb-notification__act:hover {
    background: color-mix(in srgb, var(--nb-notification-tone) 12%, transparent);
}

.nb-notification__detail {
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, currentColor 45%, transparent);
    text-underline-offset: 3px;
}

.nb-notification__detail:hover {
    color: var(--text-main);
    background: color-mix(in srgb, var(--text-main) 8%, transparent);
}

.nb-notification__detail:active {
    background: color-mix(in srgb, var(--text-main) 12%, transparent);
}

.nb-notification--success {
    --nb-notification-tone: var(--status-success);
}

.nb-notification--warning {
    --nb-notification-tone: var(--status-warning);
}

.nb-notification--danger {
    --nb-notification-tone: var(--status-danger);
}

.nb-notification--info {
    --nb-notification-tone: var(--accent-main);
}
</style>
