<script setup lang="ts">
import {computed, ref, watch} from "vue";

import {useUiText} from "../../text-port";
import IconButton from "../controls/IconButton.vue";
import {focusRingClass} from "../controls/focus-ring";

// 分页条：受控，只发新页码。合同见同名 Pagination.md。
const props = withDefaults(defineProps<{
    modelValue: number;
    pageCount: number;
    disabled?: boolean;
    prevLabel?: string;
    nextLabel?: string;
    navLabel?: string;
}>(), {
    disabled: false,
});

const emit = defineEmits<{
    "update:modelValue": [page: number];
}>();

const text = useUiText();
const navRef = ref<HTMLElement | null>(null);

/** 页数多于这个数时折成固定的 7 格；不超过时全部列出，格数同样不超过 7。 */
const MAX_CELLS = 7;

const lastPage = computed(() => (Number.isFinite(props.pageCount) ? Math.max(1, Math.floor(props.pageCount)) : 1));
/** 越界的 modelValue 只在显示上夹到边界，不回写：改不改值由使用方定（Pagination.md 的“状态与边界”）。 */
const current = computed(() => {
    const page = Number.isFinite(props.modelValue) ? Math.round(props.modelValue) : 1;
    return Math.min(Math.max(page, 1), lastPage.value);
});

type Cell = {kind: "page"; page: number} | {kind: "gap"; side: "start" | "end"};

const cells = computed<Cell[]>(() => {
    const last = lastPage.value;
    const page = current.value;
    const pages = (...list: number[]): Cell[] => list.map((value) => ({kind: "page", page: value}));
    if (last <= MAX_CELLS) {
        return pages(...Array.from({length: last}, (_, index) => index + 1));
    }
    if (page <= 4) {
        return [...pages(1, 2, 3, 4, 5), {kind: "gap", side: "end"}, ...pages(last)];
    }
    if (page >= last - 3) {
        return [...pages(1), {kind: "gap", side: "start"}, ...pages(last - 4, last - 3, last - 2, last - 1, last)];
    }
    return [...pages(1), {kind: "gap", side: "start"}, ...pages(page - 1, page, page + 1), {kind: "gap", side: "end"}, ...pages(last)];
});

/*
 * 格子按页码作 key：点了“5”以后它多半就是新的当前页，同一个按钮留着、焦点也跟着留着。
 * 焦点会在两种情况下没地方落：页码换了位置，Vue 移走了焦点所在的按钮；或者焦点所在的按钮变成不可用
 * （箭头点到了端点，或整条不可用）。Chrome 里变成不可用的按钮这一刻仍是 activeElement，稍后才丢回 body，
 * 所以只看“焦点还在不在条里”接不住第二种。
 * pre 在重排之前记下焦点在不在条里，post 在重排之后看它还有没有地方落，没有就落到当前页上。
 * 焦点原本不在条里（使用方从别处改了页码）时不动焦点；整条不可用时当前页也不可用，没有能落的格子，交给使用方。
 */
let focusWasInside = false;
watch([current, lastPage, () => props.disabled], () => {
    focusWasInside = navRef.value?.contains(document.activeElement) ?? false;
}, {flush: "pre"});
watch([current, lastPage, () => props.disabled], () => {
    const nav = navRef.value;
    if (!focusWasInside || !nav) return;
    const active = document.activeElement;
    const stillUsable = nav.contains(active) && !(active instanceof HTMLButtonElement && active.disabled);
    if (stillUsable) return;
    const target = nav.querySelector<HTMLButtonElement>("button[aria-current='page']");
    if (target && !target.disabled) target.focus();
}, {flush: "post"});

function go(page: number): void {
    if (props.disabled || page === current.value || page < 1 || page > lastPage.value) return;
    emit("update:modelValue", page);
}
</script>

<template>
    <nav ref="navRef" class="nb-pagination" :aria-label="props.navLabel ?? text('pagination.nav')">
        <IconButton
            size="sm"
            icon-class="i-lucide-chevron-left"
            :title="props.prevLabel ?? text('pagination.prev')"
            :disabled="props.disabled || current <= 1"
            @click="go(current - 1)"
        />
        <template v-for="cell in cells" :key="cell.kind === 'page' ? cell.page : `gap-${cell.side}`">
            <span v-if="cell.kind === 'gap'" class="nb-pagination-cell nb-pagination-gap" aria-hidden="true">…</span>
            <button
                v-else
                type="button"
                class="nb-pagination-cell nb-pagination-page"
                :class="[focusRingClass('outer'), {'is-current': cell.page === current}]"
                :disabled="props.disabled"
                :aria-current="cell.page === current ? 'page' : undefined"
                :aria-label="text('pagination.page', {page: cell.page})"
                @click="go(cell.page)"
            >{{ cell.page }}</button>
        </template>
        <IconButton
            size="sm"
            icon-class="i-lucide-chevron-right"
            :title="props.nextLabel ?? text('pagination.next')"
            :disabled="props.disabled || current >= lastPage"
            @click="go(current + 1)"
        />
    </nav>
</template>

<style scoped>
.nb-pagination {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-1);
    user-select: none;
}

/*
 * 最小宽度而不是定宽：三位数以内的页码都放得进 32px，翻页时整条宽度不变；
 * 四位数时按内容变宽而不是挤出格子（Pagination.md 的“布局”）。高与小号图标按钮相同，两种零件在一条线上。
 */
.nb-pagination-cell {
    display: inline-grid;
    place-items: center;
    box-sizing: border-box;
    min-width: 32px;
    height: 26px;
    padding: 0 var(--space-2);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
}

.nb-pagination-gap {
    color: var(--text-muted);
    user-select: none;
}

.nb-pagination-page {
    border: 0;
    border-radius: var(--radius-button-sm);
    background: transparent;
    color: var(--text-secondary);
    font-family: inherit;
    cursor: pointer;
    transition-property: background-color, color, transform;
    transition-duration: var(--motion-fast);
    transition-timing-function: var(--ease-layout);
}

/* 悬停与按下取同一条里两个箭头（IconButton 的缺省档）的取值，鼠标从箭头移到页码时深浅一致。 */
.nb-pagination-page:not(:disabled):hover {
    background: color-mix(in srgb, var(--text-main) 15%, transparent);
    color: var(--text-main);
}

.nb-pagination-page:not(:disabled):active {
    background: color-mix(in srgb, var(--text-main) 24%, transparent);
    transform: scale(0.93);
}

/*
 * 当前页用主色的浅底，不用灰底：灰底与上面的悬停底深浅几乎一样，鼠标停在别的页码上时分不清哪个是当前页。
 * 带 :not(:disabled) 是为了与悬停、按下同一优先级、写在后面压过它们：停在当前页上时它仍是当前页的样子。
 */
.nb-pagination-page.is-current:not(:disabled) {
    background: color-mix(in srgb, var(--accent-main) 14%, transparent);
    color: color-mix(in srgb, var(--accent-main) 75%, var(--text-main));
    font-weight: var(--weight-strong);
}

.nb-pagination-page:disabled {
    cursor: not-allowed;
    opacity: 0.4;
}
</style>
