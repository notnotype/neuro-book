<script setup lang="ts">
/**
 * 形象分页的展示层（同名 .md，docs/specs/canon/author-ui.md 输出 50）：大的立绘、外貌、现在穿的与衣柜。只收属性、发事件；就地改的
 * 编辑器与来历由绑定层经插槽放进来（`LookView.vue`）。
 */
import {shallowRef} from "vue";

import {Badge, Button, DropdownMenu, IconButton} from "@notnotype/nb-ui/components";

import {useCanonText} from "../text";
import CanonImage from "./CanonImage.vue";
import type {CardFact, CardOutfit, CardPassage} from "./character-card";

const props = withDefaults(defineProps<{
    /** 立绘的作品内路径与说明；没有时为 null（写“添加立绘”）。 */
    portrait: {readonly path: string; readonly alt: string} | null;
    /** 立绘在所选位置之前被剧情改过时的“第 N 章改过”。 */
    portraitMark?: string;
    appearance?: CardPassage | null;
    wearing?: CardFact | null;
    outfits?: readonly CardOutfit[];
    /** 写不了的原因：值按钮不可用、悬停写它；可以写时为空。 */
    editReason?: string;
    /** 值按钮的 `data-edit` 写完整路径（`<命名空间>.<字段>`），宿主保存或放弃以后按它把焦点还回来；缺省只写字段名。 */
    namespace?: string;
}>(), {portraitMark: undefined, appearance: null, wearing: null, outfits: () => [], editReason: "", namespace: ""});

const emit = defineEmits<{
    /** 点了一个值（立绘、外貌、现在穿的）：就地改它；`anchor` 是那个按钮。 */
    (event: "edit", id: string, anchor: HTMLElement): void;
    (event: "origins", id: string, anchor: HTMLElement): void;
    /** 换上一套：打开现在穿的的编辑，锚在这个按钮上。 */
    (event: "put-on", outfit: string, anchor: HTMLElement): void;
    (event: "outfit-edit", id: string): void;
    (event: "outfit-remove", id: string): void;
    (event: "outfit-add"): void;
}>();

defineSlots<{
    /** 立绘、现在穿的旁边：就地改的编辑器（浮层，锚在 `anchor`）。 */
    editor?(props: {id: string; anchor: HTMLElement | null}): unknown;
    /** 外貌的位置上：就地改的编辑器，`anchor` 是原文按钮（编辑浮层锚在它下方）。 */
    "passage-editor"?(props: {id: string; anchor: HTMLElement | null}): unknown;
}>();

const text = useCanonText();
const anchors = shallowRef<Record<string, HTMLElement | null>>({});
const keep = (id: string) => (element: unknown) => {
    const next = element as HTMLElement | null;
    if (anchors.value[id] === next) return;
    anchors.value = {...anchors.value, [id]: next};
};
const blocked = (): boolean => props.editReason !== "";
const editKey = (id: string): string => (props.namespace === "" ? id : `${props.namespace}.${id}`);
const pick = (event: MouseEvent, id: string): void => emit("edit", id, event.currentTarget as HTMLElement);
/** 值按钮的读屏名带上是哪一项。 */
const valueLabel = (label: string, shown: string | null): string => text("card.valueLabel", {label, value: shown ?? text("card.fill")});
</script>

<template>
    <div class="look-card" data-look-card>
        <div class="look-card__top">
            <div class="look-card__portrait-slot">
                <button
                    :ref="keep('立绘')"
                    type="button"
                    class="look-card__portrait nb-ui-focus-ring"
                    :class="{'look-card__portrait--empty': props.portrait === null}"
                    :disabled="blocked()"
                    :title="props.editReason || undefined"
                    :aria-label="valueLabel(text('look.portrait'), props.portrait === null ? null : props.portrait.alt || props.portrait.path)"
                    :data-edit="editKey('立绘')"
                    @click="pick($event, '立绘')"
                >
                    <template v-if="props.portrait !== null">
                        <CanonImage :path="props.portrait.path" :alt="props.portrait.alt" />
                        <span class="look-card__portrait-action"><span class="i-lucide-image-up size-3.5" aria-hidden="true" />{{ text("look.changePortrait") }}</span>
                    </template>
                    <template v-else>
                        <span class="i-lucide-image-plus size-7" aria-hidden="true" />
                        <span>{{ text("look.addPortrait") }}</span>
                    </template>
                </button>
                <slot name="editor" id="立绘" :anchor="anchors['立绘'] ?? null" />
                <button v-if="props.portraitMark !== undefined && props.portrait !== null" type="button" class="look-card__mark look-card__mark--button nb-ui-focus-ring mt-1.5" data-origins="立绘" @click="emit('origins', '立绘', $event.currentTarget as HTMLElement)">{{ props.portraitMark }}</button>
            </div>

            <div class="min-w-0 flex-1">
                <section v-if="props.appearance !== null" class="look-card__block" data-passage="外貌">
                    <header>
                        <h3>{{ props.appearance.label }}</h3>
                        <button v-if="props.appearance.mark !== undefined && props.appearance.text !== null" type="button" class="look-card__mark look-card__mark--button nb-ui-focus-ring" :data-origins="props.appearance.id" @click="emit('origins', props.appearance.id, $event.currentTarget as HTMLElement)">{{ props.appearance.mark }}</button>
                    </header>
                    <div>
                        <button :ref="keep(props.appearance.id)" type="button" class="look-card__passage nb-ui-focus-ring" :class="{'look-card__passage--empty': props.appearance.text === null}" :disabled="blocked()" :title="props.editReason || undefined" :aria-label="valueLabel(props.appearance.label, props.appearance.text)" :data-edit="editKey(props.appearance.id)" @click="pick($event, props.appearance.id)">
                            <Transition name="nb-ui-switch" mode="out-in"><span :key="props.appearance.text ?? ''">{{ props.appearance.text ?? props.appearance.hint }}</span></Transition>
                        </button>
                        <slot name="passage-editor" :id="props.appearance.id" :anchor="anchors[props.appearance.id] ?? null" />
                    </div>
                </section>
                <section v-if="props.wearing !== null" class="look-card__block look-card__block--line" :data-fact="props.wearing.id">
                    <header><h3>{{ props.wearing.label }}</h3></header>
                    <div class="flex min-w-0 items-center gap-2">
                        <button :ref="keep(props.wearing.id)" type="button" class="look-card__value nb-ui-focus-ring" :class="{'look-card__value--empty': props.wearing.text === null}" :disabled="blocked()" :title="props.editReason || props.wearing.text || undefined" :aria-label="valueLabel(props.wearing.label, props.wearing.text)" :data-edit="editKey(props.wearing.id)" @click="pick($event, props.wearing.id)">
                            <Transition name="nb-ui-switch" mode="out-in"><span :key="props.wearing.text ?? ''">{{ props.wearing.text ?? text("card.fill") }}</span></Transition>
                        </button>
                        <button v-if="props.wearing.mark !== undefined && props.wearing.text !== null" type="button" class="look-card__mark look-card__mark--button nb-ui-focus-ring" :data-origins="props.wearing.id" @click="emit('origins', props.wearing.id, $event.currentTarget as HTMLElement)">{{ props.wearing.mark }}</button>
                        <slot name="editor" :id="props.wearing.id" :anchor="anchors[props.wearing.id] ?? null" />
                    </div>
                </section>
            </div>
        </div>

        <section class="look-card__wardrobe">
            <header><h3>{{ text("look.wardrobe") }}</h3></header>
            <TransitionGroup tag="ul" name="look-card-outfit" class="look-card__outfits">
                <li v-for="outfit in props.outfits" :key="outfit.id" class="look-card__outfit" :data-outfit="outfit.id" :data-wearing="outfit.wearing ? '' : undefined">
                    <button type="button" class="look-card__outfit-main nb-ui-focus-ring" :disabled="blocked()" :aria-label="text('look.editOutfit', {name: outfit.name})" @click="emit('outfit-edit', outfit.id)">
                        <span class="look-card__outfit-image">
                            <CanonImage v-if="outfit.image !== null" :path="outfit.image" />
                            <span v-else class="i-lucide-shirt size-6" aria-hidden="true" />
                        </span>
                        <span class="look-card__outfit-name" :title="outfit.name">{{ outfit.name }}</span>
                        <span class="look-card__outfit-look">{{ outfit.look }}</span>
                    </button>
                    <div class="look-card__outfit-foot">
                        <Badge v-if="outfit.wearing" tone="accent" variant="soft" size="sm">{{ text("look.wearing") }}</Badge>
                        <Button v-else size="sm" variant="ghost" :disabled="blocked()" :data-put-on="outfit.id" @click="emit('put-on', outfit.name, $event.currentTarget as HTMLElement)">{{ text("look.putOn") }}</Button>
                        <DropdownMenu
                            :items="[{id: 'edit', label: text('edit.button')}, {id: 'remove', label: text('card.remove'), tone: 'danger'}]"
                            :disabled="blocked()"
                            root-class="look-card__more"
                            @select="(action: string) => (action === 'edit' ? emit('outfit-edit', outfit.id) : emit('outfit-remove', outfit.id))"
                        >
                            <IconButton size="sm" icon-class="i-lucide-ellipsis" :aria-label="text('look.outfitMore', {name: outfit.name})" />
                        </DropdownMenu>
                    </div>
                </li>
                <li key="__add">
                    <button type="button" class="look-card__outfit look-card__outfit--add nb-ui-focus-ring" :disabled="blocked()" data-outfit-add @click="emit('outfit-add')">
                        <span class="i-lucide-plus size-5" aria-hidden="true" />
                        <span>{{ text("look.addOutfit") }}</span>
                    </button>
                </li>
            </TransitionGroup>
        </section>
    </div>
</template>

<style scoped>
.look-card {
    container-type: inline-size;
    min-width: 0;
    font-size: var(--text-sm);
    color: var(--text-main);
}
.look-card__top {
    display: flex;
    gap: 1.75rem;
    align-items: flex-start;
}
.look-card__portrait-slot {
    position: relative;
    flex-shrink: 0;
}
/* 大的立绘：这一页唯一用力的地方。宽度固定，不随窗口变大。 */
.look-card__portrait {
    position: relative;
    display: block;
    width: 15rem;
    aspect-ratio: 3 / 4;
    overflow: hidden;
    border-radius: var(--radius-panel);
    background: var(--bg-input);
    box-shadow: 0 1px 2px color-mix(in srgb, var(--text-main) 12%, transparent), 0 10px 28px -14px color-mix(in srgb, var(--text-main) 40%, transparent);
}
.look-card__portrait-action {
    position: absolute;
    right: 0.5rem;
    bottom: 0.5rem;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.125rem 0.5rem;
    border-radius: var(--radius-pill);
    background: color-mix(in srgb, var(--bg-panel) 88%, transparent);
    font-size: var(--text-xs);
    color: var(--text-secondary);
    opacity: 0;
    transition: opacity var(--motion-fast) var(--ease-layout);
}
.look-card__portrait:hover .look-card__portrait-action,
.look-card__portrait:focus-visible .look-card__portrait-action {
    opacity: 1;
}
.look-card__portrait--empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    border: 1px dashed var(--divider);
    box-shadow: none;
    background: transparent;
    color: var(--text-muted);
    transition: color var(--motion-fast) var(--ease-layout), border-color var(--motion-fast) var(--ease-layout);
}
.look-card__portrait--empty:not(:disabled):hover {
    border-color: var(--accent-main);
    color: var(--accent-text);
}
.look-card__block > header,
.look-card__wardrobe > header {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    margin-bottom: 0.375rem;
}
.look-card__block:first-child > header {
    padding: 0 0.5rem;
}
.look-card__block--line > header {
    padding: 0 0.5rem;
}
.look-card__block h3,
.look-card__wardrobe h3 {
    flex: 1;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-secondary);
}
.look-card__block--line {
    margin-top: 1.25rem;
    padding-top: 1rem;
    border-top: 1px solid var(--divider);
}
/* 悬停的底色比文字宽出一点：内边距在按钮里，不用负的外边距（会越出这一栏）。标题同样缩进，与文字对齐。 */
.look-card__passage {
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
.look-card__passage:not(:disabled):hover,
.look-card__value:not(:disabled):hover {
    background: var(--bg-hover);
}
.look-card__passage--empty {
    font-size: var(--text-sm);
    line-height: 1.75rem;
    color: var(--text-muted);
}
.look-card__value {
    min-width: 0;
    padding: 0.125rem 0.5rem;
    border-radius: var(--radius-control);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: background var(--motion-fast) var(--ease-layout);
}
.look-card__value--empty {
    color: var(--text-muted);
}
.look-card__mark {
    flex-shrink: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
}
.look-card__mark--button {
    padding: 0 0.25rem;
    border-radius: var(--radius-control);
    transition: background var(--motion-fast) var(--ease-layout), color var(--motion-fast) var(--ease-layout);
}
.look-card__mark--button:hover {
    background: var(--bg-hover);
    color: var(--text-secondary);
}
.look-card__wardrobe {
    margin-top: 1.75rem;
    padding-top: 1.25rem;
    border-top: 1px solid var(--divider);
}
.look-card__outfits {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
    gap: 0.75rem;
    margin: 0;
    padding: 0;
    list-style: none;
}
.look-card__outfit {
    display: flex;
    flex-direction: column;
    min-width: 0;
    border-radius: var(--radius-panel);
    box-shadow: 0 0 0 1px var(--divider);
    transition: box-shadow var(--motion-fast) var(--ease-layout);
}
.look-card__outfit[data-wearing] {
    box-shadow: 0 0 0 1.5px var(--accent-main);
}
.look-card__outfit-main {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.5rem 0.5rem 0;
    text-align: left;
}
.look-card__outfit-image {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 7.5rem;
    overflow: hidden;
    border-radius: var(--radius-control);
    background: var(--bg-input);
    color: var(--text-muted);
}
.look-card__outfit-name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
/* 样子两行截断：卡的高度不随文字变。 */
.look-card__outfit-look {
    display: -webkit-box;
    min-height: 2.5rem;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    font-size: var(--text-xs);
    line-height: 1.25rem;
    color: var(--text-secondary);
}
.look-card__outfit-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.25rem;
    padding: 0.25rem 0.25rem 0.375rem 0.5rem;
}
.look-card__outfit--add {
    align-items: center;
    justify-content: center;
    gap: 0.375rem;
    width: 100%;
    min-height: 12rem;
    border: 1px dashed var(--divider);
    box-shadow: none;
    color: var(--text-muted);
    transition: color var(--motion-fast) var(--ease-layout), border-color var(--motion-fast) var(--ease-layout);
}
.look-card__outfit--add:not(:disabled):hover {
    border-color: var(--accent-main);
    color: var(--accent-text);
}
.look-card-outfit-enter-active,
.look-card-outfit-leave-active {
    transition: opacity var(--motion-base) var(--ease-layout), transform var(--motion-base) var(--ease-layout);
}
.look-card-outfit-enter-from,
.look-card-outfit-leave-to {
    opacity: 0;
    transform: scale(0.97);
}
.look-card-outfit-leave-active {
    position: absolute;
}
.look-card-outfit-move {
    transition: transform var(--motion-move) var(--ease-layout);
}
/* 窄处立绘在上，外貌与现在穿的在下。 */
@container (max-width: 560px) {
    .look-card__top {
        flex-direction: column;
        gap: 1rem;
    }
    .look-card__portrait {
        width: 10rem;
    }
}
@media (prefers-reduced-motion: reduce) {
    .look-card-outfit-enter-active,
    .look-card-outfit-leave-active,
    .look-card-outfit-move {
        transition: none;
    }
}
</style>
