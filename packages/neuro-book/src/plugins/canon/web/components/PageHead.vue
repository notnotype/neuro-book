<script setup lang="ts">
/**
 * 别的浏览器入口的页面用的页头（docs/specs/canon/author-ui.md 输出 35）：世界横幅、标题与“在看”（`ViewPointPicker`：故事线、
 * 时间点与“算上计划中的情节”，输出 7、34），与条目页的页头同一个控件、同样的出现条件。受控：位置的值与“按计划”由页面给（存在它的
 * 标签状态里），交互时发出新值；窗口的线直接改窗口的。
 * 位置的值是 `positions.ts` 的写法，空串是缺省位置。
 */
import {computed} from "vue";

import type {ReadPosition} from "@notnotype/nb-canon";
import {useText} from "@notnotype/nb-ui/text-port";

import type {PageLine} from "../entry-page";
import {chapterLine, defaultPosition, positionChapters, positionExists, positionFromValue, positionValue} from "../positions";
import type {ChapterRef} from "../positions";
import {useWorldList, useWorldRead} from "../use-reads";
import {readOnlyBanner} from "../writable";
import type {CanonWorld} from "../world";
import ViewPointPicker from "./ViewPointPicker.vue";
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

const port = useText();
const chaptersRead = useWorldRead(props.world, "chapters", () => ({}));
const chapters = computed<readonly ChapterRef[]>(() => chaptersRead.value?.data?.items ?? []);
const rows = computed(() => positionChapters(chapters.value));
const picked = computed(() => (props.position === "" ? null : positionFromValue(props.position)));
const exists = computed(() => picked.value !== null && positionExists(picked.value, chapters.value));
const chosen = computed<ReadPosition>(() => (picked.value !== null && exists.value ? picked.value : defaultPosition(chapters.value)));
/**
 * 页面选过的章不在了（删了）：读取回到缺省位置（输出 7），这里写那一句。页面状态里的旧值不改：页头只拿到值，不替页面改它，
 * 作者另选一个位置时这一句就没了。
 */
const gone = computed(() => props.position !== "" && chaptersRead.value?.data !== undefined && !exists.value);
// 同条目页：作品里有计划（或这一页正算着计划，好让作者关掉）才有开关；没有章、没有计划又只有主线时不出“在看”。
const plans = useWorldList(props.world, "changes", () => ({filter: {kind: "plan" as const}}), 1);
const canPlan = computed(() => (plans.state.value?.data?.total ?? 0) > 0 || props.planned);
const showPicker = computed(() => rows.value.length > 0 || canPlan.value || props.windowLine.options.value.length > 1);
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
            <div class="flex min-w-0 max-w-full flex-wrap items-center gap-3">
                <ViewPointPicker
                    v-if="showPicker"
                    :chapters="rows"
                    :position="positionValue(chosen)"
                    :planned="props.planned"
                    :can-plan="canPlan"
                    :position-gone="gone"
                    :line-options="props.windowLine.options.value"
                    :line="props.windowLine.line.value"
                    :resolved-line="resolved"
                    @update:position="(value: string) => emit('update:position', value)"
                    @update:planned="(value: boolean) => emit('update:planned', value)"
                    @update:line="(value: string) => props.windowLine.set(value)"
                />
            </div>
        </div>
    </header>
</template>
