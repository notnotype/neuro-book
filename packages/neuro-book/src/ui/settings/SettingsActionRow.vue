<script setup lang="ts">
/**
 * 设置页里一个动作的一行（同名 .md）：标题与说明在左，调用方的按钮在右，行下是动作的状态。版式照 `SettingsRow` 的缺省排法，
 * 和配置项的行排在一组里时右缘对齐；它不对应配置项，没有层与恢复默认。
 */
import {computed, useId} from "vue";

defineOptions({name: "SettingsActionRow"});

const props = withDefaults(defineProps<{
    title: string;
    description?: string | null;
    status?: string | null;
    tone?: "info" | "success" | "danger" | "muted";
}>(), {description: null, status: null, tone: "info"});

defineSlots<{
    /** 动作；`describedby` 接进按钮的 `aria-describedby`（按钮的名字仍是它自己的文字）。 */
    default(props: {describedby: string}): unknown;
}>();

/** 图标类名写成字面量，图标才会被生成。 */
const ICON = {info: "i-lucide-info", muted: "i-lucide-info", success: "i-lucide-circle-check", danger: "i-lucide-circle-alert"} as const;

const id = useId();
const titleId = `${id}-title`;
const descriptionId = `${id}-description`;
const statusId = `${id}-status`;
const shown = computed(() => (props.status === null || props.status === "" ? null : props.status));
const describedby = computed(() => [titleId, props.description === null ? null : descriptionId, statusId].filter((item) => item !== null).join(" "));
</script>

<template>
    <div class="settings-action-row" data-settings-action-row>
        <div class="settings-action-row__main">
            <div class="settings-action-row__text">
                <div :id="titleId" class="settings-action-row__title">{{ title }}</div>
                <p v-if="description !== null" :id="descriptionId" class="settings-action-row__description">{{ description }}</p>
            </div>
            <div class="settings-action-row__control">
                <slot :describedby="describedby" />
                <span class="settings-action-row__cell" aria-hidden="true"></span>
            </div>
        </div>
        <!-- 常驻的播报区：随内容插入的区域读屏常常不播。 -->
        <p
            :id="statusId"
            class="settings-action-row__status"
            :class="shown === null ? null : `settings-action-row__status--${tone}`"
            role="status"
            aria-live="polite"
            :data-tone="shown === null ? undefined : tone"
            data-settings-action-status
        >
            <template v-if="shown !== null">
                <span :class="ICON[tone]" class="settings-action-row__icon" aria-hidden="true"></span>
                <span>{{ shown }}</span>
            </template>
        </p>
    </div>
</template>

<style scoped>
/* 尺寸同 SettingsRow：标题 20px、说明 18px、间距 2px，最右留 24px 一格，控件区最小高同中号控件。 */
.settings-action-row {
    display: flex;
    flex-direction: column;
    padding-block: var(--space-4);
}

.settings-action-row__main {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3) var(--space-7);
    min-height: var(--control-h-md);
}

.settings-action-row__text {
    user-select: text;
    display: flex;
    min-width: 0;
    flex: 1 1 200px;
    flex-direction: column;
    gap: var(--space-1);
}

.settings-action-row__title {
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    line-height: 20px;
    color: var(--text-main);
}

.settings-action-row__description {
    margin: 0;
    font-size: var(--text-xs);
    line-height: 18px;
    color: var(--text-muted);
}

.settings-action-row__control {
    display: flex;
    min-width: 0;
    max-width: 100%;
    flex: 0 1 auto;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-3);
    margin-left: auto;
}

.settings-action-row__cell {
    width: 24px;
    flex: none;
}

.settings-action-row__status {
    user-select: text;
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    margin: 0;
    font-size: var(--text-xs);
    line-height: 18px;
    overflow-wrap: anywhere;
}

/* 播报区常驻（隐藏了读屏不播）：没有状态时高 0、不留间距，有状态时才与上面隔开。 */
.settings-action-row__status[data-tone] {
    margin-top: var(--space-3);
}

.settings-action-row__status--info {
    color: var(--status-info);
}

.settings-action-row__status--success {
    color: var(--status-success);
}

.settings-action-row__status--danger {
    color: var(--status-danger);
}

.settings-action-row__status--muted {
    color: var(--text-muted);
}

.settings-action-row__icon {
    width: var(--text-sm);
    height: var(--text-sm);
    flex-shrink: 0;
    margin-top: 2px;
}
</style>
