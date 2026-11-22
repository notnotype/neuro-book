<script setup lang="ts">
/**
 * 右侧的一张详情（docs/specs/story/viewer.md 输出 66、67）：人物卡、原文、段落或图节点，外面一层带读屏名称、关闭按钮（人物卡自己带）。
 * 里面的链接换它所在的那张：给里面提供会话的代理（`openCard` 这些换这一张、`closeDrawer` 关这一张），卡片里的入口不用知道自己在哪一张。
 *
 * 它不读会话的 `details`（输出 155 的限制）：关掉时网格冻住它的插槽调用，但它自己读的响应式数据照常更新，读到已经关掉的那张会出错。
 * 要的几样（这一项、左右、几张、是不是最近的）都由宿主经属性给。
 */
import {IconButton} from "@notnotype/nb-ui/components";
import {provide, ref} from "vue";

import {BOOK_SESSION, type BookSession} from "../host/book";
import type {DetailItem} from "../host/details";
import DrawerCard from "./DrawerCard.vue";
import DrawerNode from "./DrawerNode.vue";
import DrawerParagraph from "./DrawerParagraph.vue";
import DrawerSource from "./DrawerSource.vue";

const props = defineProps<{
    session: BookSession;
    item: DetailItem;
    /** 左边是 0，右边是 1。 */
    index: number;
    /** 此刻并排的张数（1 或 2）。 */
    count: number;
    /** 是不是最近点过的那张。 */
    active: boolean;
}>();
const emit = defineEmits<{
    /** 要关掉这一张；带外壳的根元素，宿主据此判断焦点在不在里面。 */
    close: [shell: HTMLElement];
    /** 在里面按下指针、获得焦点或滚动：成为最近点过的那张。 */
    touch: [];
}>();

const shell = ref<HTMLElement | null>(null);
const key = props.item.key;
/**
 * 会话的代理：原型是会话本身（`info` 是 getter，用展开语法会把它求值成那一刻的旧值），只覆盖换哪一张、关哪一张。
 * 这一张的 `key` 在建外壳时定下：同一个外壳只对应一张详情（换内容会换 `key`、换外壳）。
 */
const scoped: BookSession = Object.create(props.session, {
    openCard: {value: (entity: string, tab?: Parameters<BookSession["openCard"]>[1]) => props.session.openDetail(tab === undefined ? {kind: "card", entity} : {kind: "card", entity, tab}, {key})},
    openSource: {value: (ref: string) => props.session.openDetail({kind: "source", ref}, {key})},
    openParagraph: {value: (chapter: number, paragraph: number) => props.session.openDetail({kind: "para", chapter, paragraph}, {key})},
    openNode: {value: (id: string, label: string) => props.session.openDetail({kind: "node", id, label}, {key})},
    closeDrawer: {value: () => close()},
});
provide(BOOK_SESSION, scoped);

function close(): void {
    if (shell.value !== null) emit("close", shell.value);
}
function touch(): void {
    if (!props.active) emit("touch");
}
const label = (): string => (props.count < 2 ? "详情" : props.index === 0 ? "左边的详情" : "右边的详情");
</script>

<template>
    <!-- tabindex="-1"：关掉另一张时焦点要能交到这里（不进 Tab 顺序）。 -->
    <aside
        ref="shell" tabindex="-1"
        class="detail-shell flex h-full min-w-0 flex-col overflow-hidden border-l border-[var(--divider)] bg-[var(--panel-surface)] outline-none"
        data-testid="drawer" :data-detail-key="item.key" :data-detail-index="index" :aria-label="label()" :aria-current="count > 1 && active ? 'true' : undefined"
        @pointerdown.capture="touch" @focusin="touch" @wheel.passive="touch"
    >
        <!-- 人物卡自己带关闭按钮；其余几种内容在这里补一个（反馈：右侧栏要有关闭按钮） -->
        <div v-if="item.content.kind !== 'card'" class="flex shrink-0 justify-end px-2 pt-1"><IconButton size="xs" icon-class="i-lucide-x" aria-label="关闭" @click="close" /></div>
        <div class="min-h-0 flex-1">
            <DrawerCard v-if="item.content.kind === 'card'" :entity="item.content.entity" :tab="item.content.tab" />
            <DrawerSource v-else-if="item.content.kind === 'source'" :ref-text="item.content.ref" class="story-scroll-y h-full" />
            <DrawerParagraph v-else-if="item.content.kind === 'para'" :chapter="item.content.chapter" :paragraph="item.content.paragraph" class="story-scroll-y h-full" />
            <DrawerNode v-else :id="item.content.id" :label="item.content.label" class="story-scroll-y h-full" />
        </div>
    </aside>
</template>

<style scoped>
/* 两张并排时最近点过的那张：上边一条 2 像素的强调色线（读屏另有 aria-current）。 */
.detail-shell[aria-current="true"] {
    box-shadow: inset 0 2px 0 var(--accent-main);
}
</style>
