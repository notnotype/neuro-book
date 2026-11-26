<script setup lang="ts">
/**
 * w00039 t42 第 2 轮静态稿：就地改的编辑控件。真实的 `CharacterCard`，编辑器经它的 `editor`、`passage-editor` 插槽放进去。三种做法：
 * - compact：紧凑的浮层，不透明的面；意图写成落点（“改最初 | 第 3 章变了”），和取消、保存在同一行；没有别的变化时不写预览；
 * - outcome：浮层里的两项写成结果（“设定改成 18 岁 / 第 3 章里变成 18 岁”），下面一行小字说之前怎样；
 * - inline：不弹浮层，在原处展开成输入框，下一行是意图与保存，下面的内容往下让。
 * 只画样子，不保存；`surface` 只给 compact 用，对比玻璃与不透明的面。
 */
import {computed, ref} from "vue";

import {Button, IconButton, Input, RadioGroup, SegmentedControl, Textarea} from "@notnotype/nb-ui/components";

import CharacterCard from "nbook/plugins/canon/web/components/CharacterCard.vue";

import {FILLED_CARD} from "./sample";

type Variant = "compact" | "outcome" | "inline";
type Case = "age" | "where" | "height" | "gender" | "personality" | "initial";

const props = withDefaults(defineProps<{
    variant?: Variant;
    /**
     * age 年龄（只在最初设过，看的是第 3 章末尾）；where 现在在哪（第 2 章改过）；height 身高，改了以后多一条待处理；gender 性别（有建议值）；
     * personality 性格（长文字）；initial 看的是“最初”时改年龄（不用选意图）。
     */
    case?: Case;
    surface?: "solid" | "glass";
}>(), {variant: "compact", case: "age", surface: "solid"});

/** 每种情形：改哪一项、旧值、新值、两种去处的说法、有没有连锁影响。 */
const CASES = {
    age: {id: "年龄", old: "17 岁", next: "18 岁", source: "最初", impact: null},
    where: {id: "现在在哪", old: "星家老宅", next: "学院宿舍", source: "第 2 章", impact: null},
    height: {id: "身高", old: "158 cm", next: "165 cm", source: "最初", impact: "保存后多 1 条待处理：第 4 章正文写的是 160 cm"},
    gender: {id: "性别", old: "女", next: "女", source: "最初", impact: null},
    personality: {id: "性格", old: "", next: "迟钝，情商不高，做事认真。嘴硬心软，其实很在意妹妹，常常用错方法，过后才知道搞砸了。", source: "最初", impact: null},
    initial: {id: "年龄", old: "17 岁", next: "18 岁", source: "最初", impact: null},
} as const;

const spec = computed(() => CASES[props.case]);
const atInitial = computed(() => props.case === "initial");
const passage = computed(() => props.case === "personality");
const value = ref<string>(CASES[props.case].next);
const intent = ref<"source" | "story">("source");
const SUGGESTIONS = ["男", "女", "不明", "无"];

/** 卡片的数据：样本加一项身高，好画“多一条待处理”。看“最初”时没有“第 N 章改过”。 */
const card = computed(() => {
    const facts = [...FILLED_CARD.facts.slice(0, 6), {id: "身高", label: "身高", text: "158 cm"}, ...FILLED_CARD.facts.slice(6)];
    return {...FILLED_CARD, facts: atInitial.value ? facts.map(({mark: _mark, ...fact}) => fact) : facts};
});
/** 右边一列的项（第 2、4、6……个）浮层靠右对齐，不越出卡片。 */
const alignRight = computed(() => card.value.facts.findIndex((fact) => fact.id === spec.value.id) % 2 === 1);

const sourceLabel = computed(() => `改${spec.value.source}`);
const storyLabel = "第 3 章变了";
const intentOptions = computed(() => [{value: "source", label: sourceLabel.value}, {value: "story", label: storyLabel}]);
const outcomeOptions = computed(() => {
    const next = passage.value ? "这段" : value.value;
    return [
        {value: "source", label: spec.value.source === "最初" ? `设定改成${passage.value ? "这样" : ` ${next}`}` : `把${spec.value.source}那一笔改成 ${next}`, description: spec.value.source === "最初" ? "从最初起就是这样" : `${spec.value.source}起就是这样`},
        {value: "story", label: `第 3 章里变成${passage.value ? "这样" : ` ${next}`}`, description: passage.value ? "第 3 章之前仍是原来那段" : `第 3 章之前仍是 ${spec.value.old}`},
    ];
});
const editing = (id: string): boolean => id === spec.value.id;
</script>

<template>
    <div class="ed-root h-full w-full overflow-auto bg-[var(--panel-surface)]" data-draft-in-place-edit :data-variant="props.variant" :data-case="props.case">
        <div class="ed-column mx-auto w-full px-8 py-6">
            <!-- 这一页此刻在看的时间点，决定“改最初 / 第 3 章变了”这一问出不出。 -->
            <p class="mb-4 flex items-center gap-1.5 text-[length:var(--text-sm)] text-[var(--text-muted)]">在看<span class="text-[var(--text-main)]">{{ atInitial ? "最初" : "第 3 章末尾 · 主线" }}</span></p>
            <CharacterCard v-bind="card" namespace="character" :class="['ed-card', {'ed-card--inline': props.variant === 'inline'}]" :data-editing="spec.id">
                <template #editor="{id}">
                    <template v-if="editing(id) && !passage">
                        <!-- C：原地展开。值本身藏起来（样式按 data-editing），输入框占它的位置，下一行是意图与保存。 -->
                        <div v-if="props.variant === 'inline'" class="ed-inline" data-ed-inline>
                            <Input v-model="value" size="sm" class="ed-inline__input" autofocus />
                            <div v-if="props.case === 'gender'" class="ed-chips">
                                <button v-for="item in SUGGESTIONS" :key="item" type="button" class="ed-chip" :data-on="item === value ? '' : undefined">{{ item }}</button>
                            </div>
                            <p v-if="spec.impact !== null" class="ed-impact ed-impact--inline"><span class="i-lucide-triangle-alert size-3.5 shrink-0" aria-hidden="true" />{{ spec.impact }}</p>
                            <div class="ed-inline__foot">
                                <SegmentedControl v-if="!atInitial" v-model="intent" variant="raised" size="xs" :options="intentOptions" aria-label="这次改的是" />
                                <span class="flex-1" />
                                <IconButton size="sm" icon-class="i-lucide-x" aria-label="取消" title="取消（Esc）" />
                                <IconButton size="sm" variant="accent" icon-class="i-lucide-check" aria-label="保存" title="保存（回车）" />
                            </div>
                        </div>
                        <!-- A、B：浮层。 -->
                        <div v-else class="ed-pop nb-ui-popover-surface" :class="{'ed-pop--solid': props.surface === 'solid', 'ed-pop--right': alignRight, 'ed-pop--wide': props.variant === 'outcome'}" data-ed-pop>
                            <Input v-model="value" size="sm" autofocus />
                            <ul v-if="props.case === 'gender'" class="ed-suggest" role="listbox" aria-label="建议值">
                                <li v-for="item in SUGGESTIONS" :key="item"><button type="button" class="nb-ui-menu-item w-full" role="option" :aria-selected="item === value"><span class="flex-1 text-left">{{ item }}</span><span v-if="item === value" class="i-lucide-check size-3.5" aria-hidden="true" /></button></li>
                            </ul>
                            <RadioGroup v-if="props.variant === 'outcome' && !atInitial" v-model="intent" size="sm" :options="outcomeOptions" />
                            <p v-if="spec.impact !== null" class="ed-impact"><span class="i-lucide-triangle-alert size-3.5 shrink-0" aria-hidden="true" />{{ spec.impact }}</p>
                            <div class="ed-foot">
                                <SegmentedControl v-if="props.variant === 'compact' && !atInitial" v-model="intent" variant="raised" size="xs" :options="intentOptions" aria-label="这次改的是" />
                                <span class="flex-1" />
                                <Button size="sm" variant="ghost">取消</Button>
                                <Button size="sm" variant="primary">保存<span class="ed-enter" aria-hidden="true">↵</span></Button>
                            </div>
                        </div>
                    </template>
                </template>
                <template #passage-editor="{id}">
                    <template v-if="editing(id) && passage">
                        <div v-if="props.variant === 'inline'" class="ed-inline ed-inline--passage" data-ed-inline>
                            <Textarea v-model="value" autosize :rows="3" autofocus />
                            <div class="ed-inline__foot">
                                <SegmentedControl v-model="intent" variant="raised" size="xs" :options="intentOptions" aria-label="这次改的是" />
                                <span class="flex-1" />
                                <Button size="sm" variant="ghost">取消</Button>
                                <Button size="sm" variant="primary">保存<span class="ed-enter" aria-hidden="true">Ctrl ↵</span></Button>
                            </div>
                        </div>
                        <div v-else class="ed-pop ed-pop--passage nb-ui-popover-surface" :class="{'ed-pop--solid': props.surface === 'solid'}" data-ed-pop>
                            <Textarea v-model="value" autosize :rows="3" autofocus />
                            <RadioGroup v-if="props.variant === 'outcome'" v-model="intent" size="sm" orientation="horizontal" :options="outcomeOptions" />
                            <div class="ed-foot">
                                <SegmentedControl v-if="props.variant === 'compact'" v-model="intent" variant="raised" size="xs" :options="intentOptions" aria-label="这次改的是" />
                                <span class="flex-1" />
                                <Button size="sm" variant="ghost">取消</Button>
                                <Button size="sm" variant="primary">保存<span class="ed-enter" aria-hidden="true">Ctrl ↵</span></Button>
                            </div>
                        </div>
                    </template>
                </template>
            </CharacterCard>
        </div>
    </div>
</template>

<style scoped>
/* 窄屏按画布宽算（Lab 的手机尺寸只改画布，不改视口）。 */
.ed-root {
    container-type: inline-size;
}
.ed-column {
    max-width: calc(760px + 64px);
}
@container (max-width: 480px) {
    .ed-column {
        padding-inline: 16px;
    }
}
/* 正在改的那一项：dd 给浮层当定位的父元素；原地展开时值本身藏起来、这一行可以长高。 */
.ed-card :deep([data-fact] dd) {
    position: relative;
}
.ed-card--inline[data-editing="年龄"] :deep([data-fact="年龄"] .character-card__value),
.ed-card--inline[data-editing="身高"] :deep([data-fact="身高"] .character-card__value),
.ed-card--inline[data-editing="性别"] :deep([data-fact="性别"] .character-card__value),
.ed-card--inline[data-editing="现在在哪"] :deep([data-fact="现在在哪"] .character-card__value),
.ed-card--inline[data-editing="现在在哪"] :deep([data-fact="现在在哪"] .character-card__mark),
.ed-card--inline[data-editing="性格"] :deep([data-passage="性格"] .character-card__passage) {
    display: none;
}
.ed-card--inline :deep([data-fact] dd) {
    flex-wrap: wrap;
}
/* 原地展开的那一项占满两栏：半栏放不下输入框、意图与两个按钮。 */
.ed-card--inline[data-editing="年龄"] :deep([data-fact="年龄"]),
.ed-card--inline[data-editing="身高"] :deep([data-fact="身高"]),
.ed-card--inline[data-editing="性别"] :deep([data-fact="性别"]),
.ed-card--inline[data-editing="现在在哪"] :deep([data-fact="现在在哪"]) {
    grid-column: 1 / -1;
}
.ed-inline__input {
    max-width: 20rem;
}

/* 浮层：贴在值的下面，短项 18rem 宽；不透明的面取面板色、不模糊。 */
.ed-pop {
    position: absolute;
    top: calc(100% + 4px);
    left: -6px;
    z-index: 4;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 21rem;
    padding: 10px;
}
.ed-pop--wide {
    width: 21rem;
}
.ed-pop--right {
    right: 0;
    left: auto;
}
.ed-pop--solid {
    background-color: var(--panel-surface);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
}
.ed-pop--passage {
    top: -10px;
    right: -10px;
    left: -10px;
    width: auto;
}
.ed-foot {
    display: flex;
    align-items: center;
    gap: 4px;
}
.ed-enter {
    margin-left: 6px;
    font-size: var(--text-xs);
    opacity: 0.7;
}
.ed-suggest {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
}
/* 连锁影响：只有真有影响时出现，警告色浅底一行。 */
.ed-impact {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 6px 8px;
    border-radius: var(--radius-control);
    background: color-mix(in srgb, var(--status-warning) 12%, transparent);
    color: var(--text-main);
    font-size: var(--text-xs);
    line-height: 1.5;
}
.ed-impact > span {
    margin-top: 2px;
    color: var(--status-warning);
}
/* 原地展开：占满这一项的值那一栏，下一行意图与图标按钮。 */
.ed-inline {
    display: flex;
    flex: 1 1 100%;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    padding: 4px 0 8px;
}
.ed-inline--passage {
    padding: 0 0 4px;
}
.ed-inline__foot {
    display: flex;
    align-items: center;
    gap: 2px;
}
.ed-impact--inline {
    padding: 4px 6px;
}
.ed-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
}
.ed-chip {
    height: 1.5rem;
    padding: 0 8px;
    border-radius: var(--radius-control);
    background: color-mix(in srgb, var(--text-main) 6%, transparent);
    font-size: var(--text-xs);
    color: var(--text-secondary);
}
.ed-chip[data-on] {
    background: color-mix(in srgb, var(--accent-main) 14%, transparent);
    color: var(--accent-text);
}
</style>
