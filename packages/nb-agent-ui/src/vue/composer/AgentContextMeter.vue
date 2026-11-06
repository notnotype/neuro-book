<script setup lang="ts">
import {computed} from "vue";
import {Tooltip} from "@notnotype/nb-ui/components";
import {useAgentText} from "../host";

const props = defineProps<{
    used: number;
    limit: number;
    /** 能点：点了发出 `inspect`。 */
    interactive?: boolean;
}>();

const emit = defineEmits<{(e: "inspect"): void}>();

const {t, locale} = useAgentText();

const RADIUS = 7;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const ratio = computed(() => props.used / props.limit);
const percent = computed(() => Math.round(ratio.value * 100));
/** 用了但不到 0.5% 时写“<1%”：写 0% 像是没有用量。 */
const percentText = computed(() => (props.used > 0 && percent.value === 0 ? "<1%" : `${percent.value}%`));
const tone = computed(() => (ratio.value >= 0.9 ? "danger" : ratio.value >= 0.7 ? "warning" : "normal"));
// 超过窗口时满格；描边从 12 点钟方向顺时针画。
const dash = computed(() => `${Math.min(ratio.value, 1) * CIRCUMFERENCE} ${CIRCUMFERENCE}`);
const label = computed(() => {
    const format = new Intl.NumberFormat(locale.value);
    return t("composer.context", {used: format.format(props.used), limit: format.format(props.limit), percent: percentText.value});
});
</script>

<template>
    <Tooltip :text="label" side="top">
        <component :is="props.interactive ? 'button' : 'span'" v-bind="props.interactive ? {type: 'button', 'aria-haspopup': 'dialog'} : {role: 'img', tabindex: 0}" class="acv-context-meter" :class="[`is-${tone}`, {'is-interactive': props.interactive}]" :aria-label="label" @click="props.interactive && emit('inspect')" data-context-meter :data-tone="tone">
            <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
                <circle class="acv-context-meter__track" cx="9" cy="9" :r="RADIUS" />
                <circle class="acv-context-meter__fill" cx="9" cy="9" :r="RADIUS" :stroke-dasharray="dash" transform="rotate(-90 9 9)" />
            </svg>
            <!-- 只有圆环时像加载中的转圈：旁边写出百分比。 -->
            <span class="acv-context-meter__percent" aria-hidden="true">{{ percentText }}</span>
        </component>
    </Tooltip>
</template>

<style scoped>
.acv-context-meter.is-interactive {
    border-radius: 3px;
    cursor: pointer;
}

.acv-context-meter.is-interactive:hover {
    background: var(--bg-hover);
}

.acv-context-meter.is-interactive:focus-visible {
    outline: 2px solid var(--focus-outline);
    outline-offset: 1px;
}

.acv-context-meter {
    display: inline-flex;
    flex: none;
    height: 26px;
    align-items: center;
    gap: 3px;
    padding: 0 4px;
    border-radius: var(--radius-control);
    color: var(--text-secondary);
}

/* 固定宽度：数字从 9% 变到 100% 时不推动相邻控件。 */
.acv-context-meter__percent {
    min-width: 4ch;
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
}

.acv-context-meter:focus-visible {
    outline: 2px solid var(--focus-outline);
    outline-offset: 1px;
}

.acv-context-meter.is-warning {
    color: var(--status-warning);
}

.acv-context-meter.is-danger {
    color: var(--status-danger);
}

.acv-context-meter__track {
    fill: none;
    stroke: var(--divider);
    stroke-width: 2.5;
}

.acv-context-meter__fill {
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-width: 2.5;
    transition: stroke-dasharray var(--motion-fast) var(--ease-standard);
}
</style>
