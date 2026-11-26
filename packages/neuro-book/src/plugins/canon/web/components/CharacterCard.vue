<script setup lang="ts">
/**
 * 人物分页的展示层（同名 .md，docs/specs/canon/author-ui.md 输出 49、52）：立绘、短资料、现在的状态与三段文字。只收属性、发事件；
 * 就地改的编辑器、来历与细节由绑定层经插槽放进来（`CharacterView.vue`）。
 */
import {ref, shallowRef} from "vue";

import {Button, DropdownMenu, IconButton, Input, Popover} from "@notnotype/nb-ui/components";

import {useCanonText} from "../text";
import CanonImage from "./CanonImage.vue";
import type {CardAddable, CardFact, CardPassage, CardPortrait} from "./character-card";

const props = withDefaults(defineProps<{
    facts: readonly CardFact[];
    condition?: CardPassage | null;
    passages?: readonly CardPassage[];
    portrait: CardPortrait;
    /** 写不了的原因：值按钮不可用、悬停写它；可以写时为空。 */
    editReason?: string;
    /** 值按钮的 `data-edit` 写完整路径（`<命名空间>.<字段>`），宿主保存或放弃以后按它把焦点还回来；缺省只写字段名。 */
    namespace?: string;
    /** 现在的状态的细节展开着。 */
    conditionOpen?: boolean;
    /** 能自己加一项（类型允许实例字段）。 */
    canAdd?: boolean;
    presets?: readonly CardAddable[];
    removed?: readonly CardAddable[];
    /** 添加一项被拒的原因，写在自己写名字那一栏下面。 */
    addError?: string;
    adding?: boolean;
    /** “添加一项资料”的浮层开着。 */
    addOpen?: boolean;
    /** 立绘那一格加上（恢复）形象的写入在途：这一格不可用。 */
    portraitBusy?: boolean;
    /** 加上形象被拒的原因，写在立绘下面。 */
    portraitError?: string;
}>(), {condition: null, passages: () => [], editReason: "", namespace: "", conditionOpen: false, canAdd: false, presets: () => [], removed: () => [], addError: "", adding: false, addOpen: false, portraitBusy: false, portraitError: ""});

const emit = defineEmits<{
    /** 点了一个值：就地改它；`anchor` 是值按钮（浮层贴着它）。 */
    (event: "edit", id: string, anchor: HTMLElement): void;
    /** 点了“第 N 章改过”：看来历。 */
    (event: "origins", id: string, anchor: HTMLElement): void;
    (event: "toggle-condition"): void;
    /** 点了立绘那一格。 */
    (event: "portrait"): void;
    (event: "add-preset", id: string): void;
    (event: "restore", id: string): void;
    (event: "add-own", label: string): void;
    (event: "rename", id: string): void;
    (event: "remove", id: string): void;
    (event: "update:addOpen", value: boolean): void;
}>();

defineSlots<{
    /** 每个值旁边：就地改的编辑器（浮层，锚在 `anchor`）。 */
    editor?(props: {id: string; anchor: HTMLElement | null}): unknown;
    /** 每段文字与现在的状态的位置上：浮在原处的编辑层（这个位置是 `relative` 的）。 */
    "passage-editor"?(props: {id: string}): unknown;
    /** 现在的状态展开时下面的细节。 */
    "condition-detail"?(props: {id: string}): unknown;
}>();

const text = useCanonText();
const anchors = shallowRef<Record<string, HTMLElement | null>>({});
const keep = (id: string) => (element: unknown) => {
    const next = element as HTMLElement | null;
    if (anchors.value[id] === next) return;
    anchors.value = {...anchors.value, [id]: next};
};
const own = ref("");
const blocked = (): boolean => props.editReason !== "";
const editKey = (id: string): string => (props.namespace === "" ? id : `${props.namespace}.${id}`);
const pick = (event: MouseEvent, id: string): void => emit("edit", id, event.currentTarget as HTMLElement);
/** 值按钮的读屏名带上是哪一项：一个刚建的人物有六七个“填写”。 */
const valueLabel = (label: string, shown: string | null): string => text("card.valueLabel", {label, value: shown ?? text("card.fill")});
const submitOwn = (): void => {
    const label = own.value.trim();
    if (label === "") return;
    emit("add-own", label);
};
defineExpose({clearOwn: () => (own.value = "")});
</script>

<template>
    <div class="character-card" data-character-card>
        <div class="character-card__top">
            <div v-if="props.portrait.status !== 'unavailable'" class="character-card__portrait-slot">
                <button
                    type="button"
                    class="character-card__portrait nb-ui-focus-ring"
                    :class="{'character-card__portrait--empty': props.portrait.status !== 'image'}"
                    :disabled="props.portrait.status === 'later' || (props.portrait.status !== 'image' && props.portrait.status !== 'no-image' && (blocked() || props.portraitBusy))"
                    :data-portrait="props.portrait.status"
                    @click="emit('portrait')"
                >
                    <template v-if="props.portrait.status === 'image'">
                        <CanonImage :path="props.portrait.path" :alt="props.portrait.alt" />
                        <span class="character-card__portrait-action">{{ text("character.portraitOpen") }}<span class="i-lucide-arrow-up-right size-3.5" aria-hidden="true" /></span>
                    </template>
                    <template v-else>
                        <span :class="props.portrait.status === 'no-image' || props.portrait.status === 'absent' ? 'i-lucide-image-plus' : props.portrait.status === 'removed' ? 'i-lucide-rotate-ccw' : 'i-lucide-shirt'" class="size-6" aria-hidden="true" />
                        <span>{{ props.portrait.status === "no-image" || props.portrait.status === "absent" ? text("character.addPortrait") : props.portrait.status === "removed" ? text("character.restoreLook") : text("character.lookFrom", {from: props.portrait.from}) }}</span>
                    </template>
                </button>
                <p v-if="props.portraitError !== ''" role="alert" class="character-card__portrait-error">{{ props.portraitError }}</p>
            </div>

            <div class="character-card__main min-w-0 flex-1">
                <TransitionGroup tag="dl" name="character-card-row" class="character-card__facts">
                    <div v-for="fact in props.facts" :key="fact.id" class="character-card__fact" :data-fact="fact.id">
                        <dt>{{ fact.label }}</dt>
                        <dd>
                            <button
                                :ref="keep(fact.id)"
                                type="button"
                                class="character-card__value nb-ui-focus-ring"
                                :class="{'character-card__value--link': fact.link === true && fact.text !== null, 'character-card__value--empty': fact.text === null}"
                                :disabled="blocked()"
                                :title="props.editReason || fact.text || undefined"
                                :aria-label="valueLabel(fact.label, fact.text)"
                                :data-edit="editKey(fact.id)"
                                @click="pick($event, fact.id)"
                            >
                                <Transition name="nb-ui-switch" mode="out-in"><span :key="fact.text ?? ''">{{ fact.text ?? text("card.fill") }}</span></Transition>
                            </button>
                            <slot name="editor" :id="fact.id" :anchor="anchors[fact.id] ?? null" />
                            <button v-if="fact.mark !== undefined && fact.text !== null" type="button" class="character-card__mark character-card__mark--button nb-ui-focus-ring" :data-origins="fact.id" @click="emit('origins', fact.id, $event.currentTarget as HTMLElement)">{{ fact.mark }}</button>
                            <DropdownMenu
                                v-if="fact.own === true"
                                :items="[{id: 'rename', label: text('card.rename')}, {id: 'remove', label: text('card.remove'), tone: 'danger'}]"
                                :disabled="blocked()"
                                root-class="character-card__more"
                                @select="(action: string) => (action === 'rename' ? emit('rename', fact.id) : emit('remove', fact.id))"
                            >
                                <IconButton size="sm" icon-class="i-lucide-ellipsis" :aria-label="text('card.more', {label: fact.label})" :data-more="fact.id" />
                            </DropdownMenu>
                        </dd>
                    </div>
                </TransitionGroup>
                <Popover v-if="props.canAdd" :open="props.addOpen" side="bottom" align="start" content-class="w-[19rem]" @update:open="(next: boolean) => emit('update:addOpen', next)">
                    <template #trigger>
                        <Button class="mt-2" size="sm" variant="ghost" :disabled="blocked()" data-add-field><span class="i-lucide-plus size-3.5" aria-hidden="true" />{{ text("card.addField") }}</Button>
                    </template>
                    <div class="flex flex-col gap-2" data-add-field-panel>
                        <ul v-if="props.presets.length + props.removed.length > 0" class="m-0 max-h-56 list-none overflow-y-auto p-0">
                            <li v-for="preset in props.presets" :key="preset.id"><button type="button" class="nb-ui-menu-item w-full" :disabled="props.adding" :data-preset="preset.id" @click="emit('add-preset', preset.id)">{{ preset.label }}</button></li>
                            <li v-for="item in props.removed" :key="item.id"><button type="button" class="nb-ui-menu-item w-full" :disabled="props.adding" :data-restore="item.id" @click="emit('restore', item.id)"><span class="i-lucide-rotate-ccw size-3.5 text-[var(--text-secondary)]" aria-hidden="true" />{{ text("card.restore", {name: item.label}) }}</button></li>
                        </ul>
                        <form class="character-card__own" @submit.prevent="submitOwn">
                            <Input v-model="own" class="min-w-0 flex-1" size="sm" :placeholder="text('card.ownPlaceholder')" :aria-label="text('card.ownLabel')" :invalid="props.addError !== ''" />
                            <Button size="sm" variant="secondary" type="submit" :disabled="props.adding || own.trim() === ''">{{ text("card.add") }}</Button>
                        </form>
                        <p v-if="props.addError !== ''" role="alert" class="text-[length:var(--text-xs)] text-[var(--status-danger)]">{{ props.addError }}</p>
                    </div>
                </Popover>

                <div v-if="props.condition !== null" class="character-card__condition">
                    <span class="character-card__label">{{ props.condition.label }}</span>
                    <div class="character-card__in-place relative min-w-0">
                        <button type="button" class="character-card__value character-card__value--wrap nb-ui-focus-ring" :class="{'character-card__value--empty': props.condition.text === null}" :aria-expanded="props.conditionOpen" :aria-label="valueLabel(props.condition.label, props.condition.text)" :data-condition="props.condition.id" @click="emit('toggle-condition')">
                            <Transition name="nb-ui-switch" mode="out-in"><span :key="props.condition.text ?? ''">{{ props.condition.text ?? props.condition.hint }}</span></Transition>
                        </button>
                        <slot name="passage-editor" :id="props.condition.id" />
                    </div>
                    <!-- 语义档的来历就在它的细节里（起点与之后记下的各句）：“第 N 章改过”展开细节。 -->
                    <button v-if="props.condition.mark !== undefined && props.condition.text !== null" type="button" class="character-card__mark character-card__mark--button nb-ui-focus-ring" :aria-expanded="props.conditionOpen" :data-origins="props.condition.id" @click="emit('toggle-condition')">{{ props.condition.mark }}</button>
                    <Transition name="character-card-lift">
                        <div v-if="props.conditionOpen" class="character-card__detail" data-condition-detail>
                            <slot name="condition-detail" :id="props.condition.id" />
                        </div>
                    </Transition>
                </div>
            </div>
        </div>

        <section v-for="passage in props.passages" :key="passage.id" class="character-card__section" :data-passage="passage.id">
            <header>
                <h3>{{ passage.label }}</h3>
                <button v-if="passage.mark !== undefined && passage.text !== null" type="button" class="character-card__mark character-card__mark--button nb-ui-focus-ring" :data-origins="passage.id" @click="emit('origins', passage.id, $event.currentTarget as HTMLElement)">{{ passage.mark }}</button>
            </header>
            <div class="character-card__in-place relative">
                <button
                    type="button"
                    class="character-card__passage nb-ui-focus-ring"
                    :class="{'character-card__passage--empty': passage.text === null}"
                    :disabled="blocked()"
                    :title="props.editReason || undefined"
                    :aria-label="valueLabel(passage.label, passage.text)"
                    :data-edit="editKey(passage.id)"
                    @click="pick($event, passage.id)"
                >
                    <Transition name="nb-ui-switch" mode="out-in"><span :key="passage.text ?? ''">{{ passage.text ?? passage.hint }}</span></Transition>
                </button>
                <slot name="passage-editor" :id="passage.id" />
            </div>
        </section>
    </div>
</template>

<style scoped>
.character-card {
    container-type: inline-size;
    min-width: 0;
    font-size: var(--text-sm);
    color: var(--text-main);
}
.character-card__top {
    display: flex;
    gap: 1.75rem;
    align-items: flex-start;
}
/* 立绘是这一页唯一用力的地方：其余都是字。宽度固定，宽窗口里不随窗口变大。 */
.character-card__portrait {
    position: relative;
    flex-shrink: 0;
    width: 11rem;
    aspect-ratio: 3 / 4;
    overflow: hidden;
    border-radius: var(--radius-panel);
    background: var(--bg-input);
    box-shadow: 0 1px 2px color-mix(in srgb, var(--text-main) 12%, transparent), 0 8px 24px -12px color-mix(in srgb, var(--text-main) 35%, transparent);
}
.character-card__portrait-action {
    position: absolute;
    right: 0.5rem;
    bottom: 0.5rem;
    display: inline-flex;
    align-items: center;
    gap: 0.125rem;
    padding: 0.125rem 0.5rem;
    border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--bg-panel) 88%, transparent);
    font-size: var(--text-xs);
    color: var(--text-secondary);
    opacity: 0;
    transition: opacity var(--motion-fast) var(--ease-layout);
}
.character-card__portrait:hover .character-card__portrait-action,
.character-card__portrait:focus-visible .character-card__portrait-action {
    opacity: 1;
}
.character-card__portrait--empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.75rem;
    border: 1px dashed var(--divider);
    box-shadow: none;
    background: transparent;
    color: var(--text-muted);
    text-align: center;
    transition: color var(--motion-fast) var(--ease-layout), border-color var(--motion-fast) var(--ease-layout);
}
.character-card__portrait--empty:not(:disabled):hover {
    border-color: var(--accent-main);
    color: var(--accent-text);
}
/* 短资料排几列看右边这一栏有多宽（立绘占去一块以后），不看整张卡：条目页两侧栏都开着时这一栏只有三百多像素。 */
.character-card__main {
    container-type: inline-size;
}
.character-card__facts {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.25rem 1.5rem;
    margin: 0;
}
/* 一项一行、行高固定：换成“填写”、多出“第 N 章改过”或行尾的按钮都不改变行的高度。 */
.character-card__fact {
    display: grid;
    grid-template-columns: 4.5rem minmax(0, 1fr);
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
    min-height: 1.75rem;
}
.character-card__fact dt,
.character-card__label {
    color: var(--text-secondary);
}
.character-card__fact dd {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    margin: 0;
}
.character-card__value {
    min-width: 0;
    padding: 0.125rem 0.25rem;
    margin-left: -0.25rem;
    border-radius: var(--radius-control);
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: background var(--motion-fast) var(--ease-layout);
}
.character-card__value:not(:disabled):hover,
.character-card__value[aria-expanded="true"] {
    background: var(--bg-hover);
}
.character-card__value--wrap {
    white-space: normal;
    line-height: 1.6;
}
.character-card__value--link {
    color: var(--accent-text);
}
.character-card__value--empty {
    color: var(--text-muted);
}
.character-card__portrait-slot {
    display: flex;
    flex-shrink: 0;
    flex-direction: column;
    gap: 0.375rem;
}
.character-card__portrait-error {
    max-width: 11rem;
    font-size: var(--text-xs);
    color: var(--status-danger);
}
.character-card__mark {
    flex-shrink: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
}
.character-card__mark--button {
    padding: 0 0.25rem;
    border-radius: var(--radius-control);
    transition: background var(--motion-fast) var(--ease-layout), color var(--motion-fast) var(--ease-layout);
}
.character-card__mark--button:hover {
    background: var(--bg-hover);
    color: var(--text-secondary);
}
/* 自己加的项行尾的“更多”：常显、低对比度。 */
:deep(.character-card__more) {
    flex-shrink: 0;
    margin-left: auto;
    opacity: 0.55;
    transition: opacity var(--motion-fast) var(--ease-layout);
}
.character-card__fact:hover :deep(.character-card__more),
:deep(.character-card__more:focus-within) {
    opacity: 1;
}
.character-card__own {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--divider);
}
.character-card__condition {
    position: relative;
    display: grid;
    grid-template-columns: 4.5rem minmax(0, 1fr) auto;
    align-items: baseline;
    gap: 0.75rem;
    margin-top: 0.75rem;
    padding-top: 0.875rem;
    border-top: 1px solid var(--divider);
}
/* 细节挂在这一行的下面、浮着，后面的内容不动。 */
.character-card__detail {
    position: absolute;
    z-index: 1;
    top: calc(100% + 0.375rem);
    right: 0;
    left: 0;
    padding: 0.75rem;
    border-radius: var(--radius-panel);
    background: var(--bg-panel);
    box-shadow: var(--elevation-raised), 0 0 0 1px var(--divider);
}
.character-card__section {
    margin-top: 1.5rem;
    padding-top: 1.25rem;
    border-top: 1px solid var(--divider);
}
.character-card__section > header {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    margin-bottom: 0.375rem;
    padding: 0 0.5rem;
}
.character-card__section h3 {
    flex: 1;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-secondary);
}
/* 悬停的底色比文字宽出一点：内边距在按钮里，不用负的外边距（会越出这一栏）。标题同样缩进，与文字对齐。 */
.character-card__passage {
    display: block;
    width: 100%;
    padding: 0.125rem 0.5rem;
    border-radius: var(--radius-control);
    text-align: left;
    font-size: 1rem;
    line-height: 1.85;
    white-space: pre-wrap;
    transition: background var(--motion-fast) var(--ease-layout);
}
.character-card__passage:not(:disabled):hover {
    background: var(--bg-hover);
}
.character-card__passage--empty {
    font-size: var(--text-sm);
    line-height: 1.75rem;
    color: var(--text-muted);
}
.character-card-lift-enter-active,
.character-card-lift-leave-active,
.character-card-row-enter-active,
.character-card-row-leave-active {
    transition: opacity var(--motion-base) var(--ease-layout), transform var(--motion-base) var(--ease-layout);
}
.character-card-lift-enter-from,
.character-card-lift-leave-to,
.character-card-row-enter-from,
.character-card-row-leave-to {
    opacity: 0;
    transform: translateY(-4px);
}
.character-card-row-move {
    transition: transform var(--motion-move) var(--ease-layout);
}
/* 窄处立绘放到上面、缩小。资料这一栏要撑满整行：竖排时它按内容定宽，而它是尺寸容器、内容宽度算作 0，会被挤成一字宽。 */
@container (max-width: 520px) {
    .character-card__top {
        flex-direction: column;
        align-items: stretch;
        gap: 1rem;
    }
    .character-card__portrait {
        width: 8rem;
    }
}
/* 资料这一栏放不下两列（每列要给值留出地方）时排成一列。 */
@container (max-width: 34rem) {
    .character-card__facts {
        grid-template-columns: minmax(0, 1fr);
    }
}
@media (prefers-reduced-motion: reduce) {
    .character-card-lift-enter-active,
    .character-card-lift-leave-active,
    .character-card-row-enter-active,
    .character-card-row-leave-active,
    .character-card-row-move {
        transition: none;
    }
}
/* 成段的文字在原处改时（宿主的编辑卡带 `data-editing-in-place`，输出 51），原文藏起来，编辑卡占它的位置、把下面推开。 */
.character-card__in-place:has(> [data-editing-in-place]) > button {
    display: none;
}
</style>
