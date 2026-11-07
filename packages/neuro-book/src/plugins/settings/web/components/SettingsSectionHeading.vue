<script setup lang="ts">
/**
 * 设置窗口里分区的标题区（同名 .md，docs/specs/settings/settings-window.md 输出 3、13、19）：左边标题与跟在后面的说明，
 * 右边从右往左是页面级操作的挂载点与层的警告。column 与 fill 两种画法共用：column 里它随内容列一起滚动，fill 里它固定在
 * 页面上方。
 */
import {Tooltip} from "@notnotype/nb-ui/components";
import {onBeforeUnmount, onMounted, ref} from "vue";

import {usePageChrome} from "nbook/ui/settings/page-chrome";
import SettingsNotice from "nbook/ui/settings/SettingsNotice.vue";

/** 层的警告（输出 13）：`invalid` 是可点的按钮，`unavailable` 与 `fixing` 只是文字。 */
export type SettingsSectionNotice =
    | {
          readonly kind: "invalid";
          /** 按钮左边的字：“设置文件格式有误”。 */
          readonly text: string;
          /** 按钮右边的字：“打开”。 */
          readonly action: string;
          /** 悬停提示，逐行：位置与原因、“修复前……无法保存”、文件路径（有才有）。 */
          readonly lines: ReadonlyArray<string>;
      }
    | {readonly kind: "unavailable" | "fixing"; readonly text: string};

/** 页面登记的标题替换（输出 19）：标题区写“‹ {backLabel}”与 `title`。 */
export interface SettingsSectionReplacement {
    readonly title: string;
    readonly backLabel: string;
    /** 返回按钮的可访问名称，例如“返回 模型服务”：只念分区标题会和左栏的同名分区分不开。 */
    readonly backName: string;
}

defineProps<{
    title: string;
    description: string | null;
    notice: SettingsSectionNotice | null;
    replacement: SettingsSectionReplacement | null;
}>();

const emit = defineEmits<{
    (event: "open-file"): void;
    (event: "back"): void;
}>();

defineOptions({name: "SettingsSectionHeading"});

const chrome = usePageChrome();
const actions = ref<HTMLElement | null>(null);
let detach: (() => void) | null = null;

// 页面里的操作 Teleport 到这个挂载点；挂载后才拿得到元素，见 `page-chrome.ts` 的时序一段。
onMounted(() => {
    if (chrome !== null && actions.value !== null) detach = chrome.attachActions(actions.value);
});
onBeforeUnmount(() => detach?.());
</script>

<template>
    <!-- 设置窗口没有标题栏：标题区的空白处与文字是拖动窗口的地方（按钮除外），见 nb-ui Dialog 的拖动区域。 -->
    <header class="settings-section-heading" data-settings-heading data-dialog-drag>
        <div class="settings-section-heading__text">
            <button v-if="replacement !== null" type="button" class="settings-section-heading__back nb-ui-focus-ring" data-settings-heading-back :aria-label="replacement.backName" @click="emit('back')">
                <span class="i-lucide-chevron-left settings-section-heading__back-icon" aria-hidden="true"></span>
                <span>{{ replacement.backLabel }}</span>
            </button>
            <div class="settings-section-heading__line">
                <h2 class="settings-section-heading__title">{{ replacement === null ? title : replacement.title }}</h2>
                <!-- 说明放不下时截断、悬停显示全文；标题被替换时没有说明（说明属于分区）。 -->
                <Tooltip v-if="replacement === null && description !== null" :text="description" side="bottom">
                    <p class="settings-section-heading__description" data-settings-heading-description>{{ description }}</p>
                </Tooltip>
            </div>
        </div>
        <div class="settings-section-heading__side">
            <Tooltip v-if="notice?.kind === 'invalid'" side="bottom">
                <SettingsNotice as="button" class="settings-section-heading__warning" data-settings-layer-notice="invalid" data-settings-open-file @click="emit('open-file')">
                    {{ notice.text }}
                    <template #action>
                        <span class="settings-section-heading__warning-action">
                            <span>{{ notice.action }}</span>
                            <span class="i-lucide-arrow-right" aria-hidden="true"></span>
                        </span>
                    </template>
                </SettingsNotice>
                <template #content>
                    <span v-for="(line, index) in notice.lines" :key="index" class="settings-section-heading__tip-line">{{ line }}</span>
                </template>
            </Tooltip>
            <SettingsNotice v-else-if="notice !== null" class="settings-section-heading__warning" :data-settings-layer-notice="notice.kind" role="status">{{ notice.text }}</SettingsNotice>
            <div ref="actions" class="settings-section-heading__actions" data-settings-heading-actions></div>
        </div>
    </header>
</template>

<style scoped>
.settings-section-heading {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-6);
    margin-bottom: var(--space-7);
}

.settings-section-heading__text {
    display: flex;
    min-width: 0;
    flex: 1 1 auto;
    flex-direction: column;
    gap: var(--space-2);
}

/*
 * 说明先收、标题后收，都以省略号结尾：被替换的标题是用户给的名字（例如服务商名），可能很长，不能压到右边的操作上。
 * 基线对齐：大字标题与小字说明的字脚在一条线上。
 */
.settings-section-heading__line {
    display: flex;
    min-width: 0;
    align-items: baseline;
    gap: var(--space-5);
}

.settings-section-heading__title {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    flex: 0 1 auto;
    text-overflow: ellipsis;
    /* 界面字体的最大一档加粗（输出 3）。行高取 28px 偶数：旁边 28px、34px 高的按钮在这一行里居中时不落在半像素上。 */
    font-size: var(--text-xl);
    font-weight: var(--weight-strong);
    line-height: 28px;
    white-space: nowrap;
    color: var(--text-main);
}

.settings-section-heading__description {
    margin: 0;
    min-width: 0;
    /* 基准宽度为 0、只吃标题剩下的宽度：收缩按比例分摊，标题与说明一起收时标题也会少一两个像素、平白出省略号。 */
    flex: 1 1 0;
    overflow: hidden;
    font-size: var(--text-sm);
    line-height: var(--leading-ui);
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-muted);
}

.settings-section-heading__back {
    display: inline-flex;
    align-items: center;
    align-self: flex-start;
    gap: var(--space-2);
    padding: 0;
    border: 0;
    border-radius: var(--radius-control);
    background: none;
    color: var(--accent-text);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
}

.settings-section-heading__back-icon {
    width: 1.15em;
    height: 1.15em;
}

/* 右侧：警告在左，页面级操作在右；放不下时让位给左边的标题，自己不缩。 */
.settings-section-heading__side {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: var(--space-3);
}

.settings-section-heading__actions {
    display: flex;
    align-items: center;
}

/* 没有页面级操作时不占位，否则右侧的间距让层的警告离内容右缘多出一格。Teleport 进来的按钮是它的子节点。 */
.settings-section-heading__actions:empty {
    display: none;
}

/* 层的警告不缩：标题与说明先让位。 */
.settings-section-heading__warning {
    flex-shrink: 0;
}

.settings-section-heading__warning-action {
    display: inline-flex;
    height: calc(var(--control-h-sm) - 8px);
    align-items: center;
    gap: var(--space-1);
    margin-left: var(--space-2);
    padding: 0 var(--space-4);
    border-radius: calc(var(--radius-control) - 4px);
    background: color-mix(in srgb, var(--status-warning) 18%, transparent);
    font-weight: var(--weight-medium);
}

.settings-section-heading__tip-line {
    display: block;
    overflow-wrap: anywhere;
}
</style>
