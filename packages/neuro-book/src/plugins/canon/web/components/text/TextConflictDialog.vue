<script setup lang="ts">
/** 提交主文字时逐条选的冲突（同名 .md）。受控。 */
import {computed, shallowRef, watch} from "vue";

import {Dialog} from "@notnotype/nb-ui/components";

import {useCanonText} from "../../text";
import type {ConflictChoice, ConflictItem} from "./text-conflict-dialog";

const props = withDefaults(defineProps<{open: boolean; items: readonly ConflictItem[]; busy?: boolean}>(), {busy: false});
const emit = defineEmits<{
    (event: "choose", id: string, choice: ConflictChoice): void;
    (event: "confirm"): void;
    (event: "update:open", value: boolean): void;
}>();

const text = useCanonText();

const complete = computed(() => props.items.every((item) => item.choice !== null));
/** 有要回去整理的块（没有可选的）：这一轮发不出去，只能“回去再改”。 */
const needsBack = computed(() => props.items.some((item) => item.kind === "manual"));
/** 点过“提交”而发不出去（还有没选的、有要回去整理的）：列表下面写一句；选全了或重新打开时收起。 */
const tried = shallowRef(false);
watch(() => props.open, () => {
    tried.value = false;
});
const confirm = (): void => {
    if (complete.value) emit("confirm");
    else tried.value = true;
};

/** 两段文字前后相同的部分与各自不同的那一截：只标出不一样的地方，长块里也一眼看得到改了什么。 */
function sides(mineText: string, theirsText: string): {readonly head: string; readonly mine: string; readonly theirs: string; readonly tail: string} {
    // 按字（码点）比，不按 UTF-16 的码元：否则一个表情或生僻字会被从中间切开，两边各显示成半个。
    const [mine, theirs] = [Array.from(mineText), Array.from(theirsText)];
    let head = 0;
    while (head < mine.length && head < theirs.length && mine[head] === theirs[head]) head += 1;
    let tail = 0;
    while (tail < mine.length - head && tail < theirs.length - head && mine[mine.length - 1 - tail] === theirs[theirs.length - 1 - tail]) tail += 1;
    return {head: mine.slice(0, head).join(""), mine: mine.slice(head, mine.length - tail).join(""), theirs: theirs.slice(head, theirs.length - tail).join(""), tail: mine.slice(mine.length - tail).join("")};
}

const rows = computed(() => props.items.map((item) => ({item, diff: item.mine !== null && item.theirs !== null ? sides(item.mine, item.theirs) : null})));
</script>

<template>
    <Dialog
        :open="props.open"
        :title="text('textEdit.conflictTitle')"
        :confirm-label="text('textEdit.conflictConfirm')"
        :cancel-label="text('textEdit.conflictBack')"
        show-cancel
        :busy="props.busy"
        @update:open="(value: boolean) => emit('update:open', value)"
        @confirm="confirm()"
    >
        <ul class="text-conflicts" data-text-conflicts>
            <li v-for="{item, diff} in rows" :key="item.id" class="text-conflicts__row" :data-conflict="item.id" :data-conflict-kind="item.kind">
                <p v-if="item.kind === 'rerouted' || item.kind === 'manual'" class="text-conflicts__note">{{ item.reason }}</p>
                <template v-if="item.kind === 'changed' || item.kind === 'rerouted'">
                    <button type="button" class="text-conflicts__pick" :aria-pressed="item.choice === 'theirs'" data-pick="theirs" @click="emit('choose', item.id, 'theirs')">
                        <span class="text-conflicts__name">{{ text("textEdit.conflictTheirs") }}</span>
                        <span v-if="diff !== null" class="text-conflicts__text"><span class="text-conflicts__same">{{ diff.head }}</span><mark class="text-conflicts__diff">{{ diff.theirs }}</mark><span class="text-conflicts__same">{{ diff.tail }}</span></span>
                        <span v-else class="text-conflicts__text">{{ item.theirs }}</span>
                    </button>
                    <button type="button" class="text-conflicts__pick" :aria-pressed="item.choice === 'mine'" data-pick="mine" @click="emit('choose', item.id, 'mine')">
                        <span class="text-conflicts__name">{{ text("textEdit.conflictMine") }}</span>
                        <span v-if="diff !== null" class="text-conflicts__text"><span class="text-conflicts__same">{{ diff.head }}</span><mark class="text-conflicts__diff">{{ diff.mine }}</mark><span class="text-conflicts__same">{{ diff.tail }}</span></span>
                        <span v-else class="text-conflicts__text text-[var(--text-muted)]">{{ text("textEdit.conflictMineRemoved") }}</span>
                    </button>
                </template>
                <template v-else-if="item.kind === 'gone'">
                    <button type="button" class="text-conflicts__pick" :aria-pressed="item.choice === 'drop'" data-pick="drop" @click="emit('choose', item.id, 'drop')">
                        <span class="text-conflicts__name">{{ text("textEdit.conflictDrop") }}</span>
                        <span class="text-conflicts__text text-[var(--text-muted)]">{{ text("textEdit.conflictTheirsGone") }}</span>
                    </button>
                    <button type="button" class="text-conflicts__pick" :aria-pressed="item.choice === 'keep'" data-pick="keep" @click="emit('choose', item.id, 'keep')">
                        <span class="text-conflicts__name">{{ text("textEdit.conflictKeep") }}</span>
                        <span class="text-conflicts__text">{{ item.mine }}</span>
                    </button>
                </template>
                <template v-else-if="item.kind === 'locked'">
                    <button type="button" class="text-conflicts__pick text-conflicts__pick--wide" :aria-pressed="item.choice === 'theirs'" data-pick="theirs" @click="emit('choose', item.id, 'theirs')">
                        <span class="text-conflicts__name">{{ text("textEdit.conflictUndo") }}</span>
                        <span class="text-conflicts__text">{{ item.reason }}</span>
                        <span v-if="item.theirs !== null" class="text-conflicts__text text-conflicts__same">{{ item.theirs }}</span>
                    </button>
                </template>
            </li>
        </ul>
        <Transition name="text-conflicts-hint">
            <p v-if="tried && !complete" class="mt-3 text-[length:var(--text-sm)] text-[var(--status-danger)]" role="alert" data-text-conflicts-incomplete>{{ text(needsBack ? "textEdit.conflictNeedsBack" : "textEdit.conflictIncomplete") }}</p>
        </Transition>
    </Dialog>
</template>

<style scoped>
.text-conflicts {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    container-type: inline-size;
}
.text-conflicts__row {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.5rem;
}
/* 按对话框自己的宽度并排，不按视口。 */
@container (min-width: 30rem) {
    .text-conflicts__row {
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
    .text-conflicts__pick--wide {
        grid-column: 1 / -1;
    }
}
.text-conflicts__pick {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    min-width: 0;
    padding: 0.625rem 0.75rem;
    border: 1px solid var(--divider);
    border-radius: var(--radius-control);
    text-align: left;
    transition: border-color var(--motion-fast) var(--ease-layout), background-color var(--motion-fast) var(--ease-layout);
}
.text-conflicts__note {
    grid-column: 1 / -1;
    color: var(--text-secondary);
    font-size: var(--text-sm);
}
.text-conflicts__pick[aria-pressed="true"] {
    border-color: var(--accent-main);
    background: color-mix(in srgb, var(--accent-main) 8%, transparent);
}
.text-conflicts__pick:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
}
.text-conflicts__name {
    color: var(--text-muted);
    font-size: var(--text-xs);
}
.text-conflicts__text {
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    font-size: var(--text-sm);
}
.text-conflicts__same {
    color: var(--text-secondary);
}
.text-conflicts__diff {
    border-radius: 2px;
    background: color-mix(in srgb, var(--status-warning) 22%, transparent);
    color: var(--text-main);
}
.text-conflicts-hint-enter-active,
.text-conflicts-hint-leave-active {
    transition: opacity var(--motion-fast) var(--ease-layout);
}
.text-conflicts-hint-enter-from,
.text-conflicts-hint-leave-to {
    opacity: 0;
}
</style>
