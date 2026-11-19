<script setup lang="ts">
/**
 * 别的浏览器入口的页面用的页头（docs/specs/canon/author-ui.md 输出 35）：世界横幅、标题、线选择（输出 34）、位置选择与“按计划”，
 * 与条目页的页头同一套控件与文字。受控：位置的值与“按计划”由页面给（存在它的标签状态里），交互时发出新值；窗口的线直接改窗口的。
 * 位置的值是 `positions.ts` 的写法，空串是缺省位置。
 */
import {computed} from "vue";

import type {ReadPosition} from "@notnotype/nb-canon";
import {Select, Switch} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";

import type {PageLine} from "../entry-page";
import {chapterLine, defaultPosition, positionExists, positionFromValue, positionOptions, positionValue} from "../positions";
import type {ChapterRef} from "../positions";
import {useCanonText} from "../text";
import {useWorldRead} from "../use-reads";
import {readOnlyBanner} from "../writable";
import type {CanonWorld} from "../world";
import LineSelect from "./LineSelect.vue";
import WorldBanners from "./WorldBanners.vue";

const props = withDefaults(defineProps<{
    world: CanonWorld;
    windowLine: PageLine;
    title: string;
    /** 位置选择的值；空串是缺省位置（最新一章末尾）。 */
    position?: string;
    planned?: boolean;
    /** 内容列封顶 1100 像素（表格页）；否则同条目页的 760。 */
    wide?: boolean;
}>(), {position: "", planned: false, wide: false});

const emit = defineEmits<{
    (event: "update:position", value: string): void;
    (event: "update:planned", value: boolean): void;
}>();

defineSlots<{
    /** 标题下面的一行（例如保密档）。 */
    default?(): unknown;
}>();

const text = useCanonText();
const port = useText();
const chaptersRead = useWorldRead(props.world, "chapters", () => ({}));
const chapters = computed<readonly ChapterRef[]>(() => chaptersRead.value?.data?.items ?? []);
const options = computed(() => positionOptions(chapters.value, text));
const chosen = computed<ReadPosition>(() => {
    const read = props.position === "" ? null : positionFromValue(props.position);
    return read !== null && positionExists(read, chapters.value) ? read : defaultPosition(chapters.value);
});
const resolved = computed(() => chapterLine(props.windowLine.line.value === "" ? chosen.value : {...chosen.value, line: props.windowLine.line.value}, chapters.value));
const readOnly = computed(() => readOnlyBanner(props.world));
</script>

<template>
    <WorldBanners :disconnected="props.world.connection.value === 'ended'" :read-only="readOnly === null ? '' : port.t(readOnly)" @retry="props.world.retry()" />
    <header class="border-b border-[var(--divider)] bg-[var(--panel-surface)] px-8 py-4 max-[480px]:px-4" data-page-head>
        <div class="mx-auto flex flex-wrap items-start gap-x-4 gap-y-2" :class="props.wide ? 'max-w-[1100px]' : 'max-w-[760px]'">
            <div class="min-w-0 flex-1 basis-64">
                <h1 class="text-[length:var(--text-xl)] font-semibold text-[var(--text-main)]">{{ props.title }}</h1>
                <slot />
            </div>
            <div class="flex flex-wrap items-center gap-3">
                <LineSelect :options="props.windowLine.options.value" :line="props.windowLine.line.value" :resolved="resolved" @update:line="(value: string) => props.windowLine.set(value)" />
                <Select class="w-52" size="sm" :aria-label="text('entry.position')" :options="[...options]" :model-value="positionValue(chosen)" @update:model-value="(value: string) => emit('update:position', value)" />
                <label class="flex items-center gap-1.5 text-[length:var(--text-xs)] text-[var(--text-secondary)]">
                    <Switch size="sm" :model-value="props.planned" :aria-label="text('entry.planned')" @update:model-value="(value: boolean) => emit('update:planned', value)" />{{ text("entry.planned") }}
                </label>
            </div>
        </div>
    </header>
</template>
