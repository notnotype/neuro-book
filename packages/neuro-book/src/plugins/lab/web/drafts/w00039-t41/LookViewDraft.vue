<script setup lang="ts">
/** w00039 t41 第 2 轮静态稿（不合并）：形象这一组设定的分页：立绘、外貌、现在穿的、衣柜。同名 .md。 */
import {computed, nextTick, onMounted, ref} from "vue";

import "@notnotype/nb-markdown/markdown.css";
import {Badge, Button, IconButton, Input, Popover, SearchSelect, SegmentedControl} from "@notnotype/nb-ui/components";
import type {SearchSelectOption} from "@notnotype/nb-ui/components";
import {imageDress, imageHome, imageIdea, imageShy, imageThink, imageUniform, portraitSrc} from "./images";


type Scene = "filled" | "empty" | "pick-image" | "wearing";

const props = withDefaults(defineProps<{scene?: Scene}>(), {scene: "filled"});
const blank = computed(() => props.scene === "empty");

const appearance = computed(() => (blank.value ? null : "淡金色长发及腰，浅灰蓝的眼睛，个子娇小。左手腕内侧有一道回溯留下的细痕。"));

interface Outfit {
    readonly id: string;
    readonly name: string;
    readonly look: string;
    readonly src: string | null;
}
const outfits = computed((): Outfit[] => (blank.value ? [] : [
    {id: "home", name: "哥哥的便装", look: "深灰连帽衫、牛仔裤，认知滤镜下看上去是个高个子男生", src: imageHome},
    {id: "uniform", name: "学院制服", look: "第三魔法学院的冬季制服，藏青外套配格子裙", src: imageUniform},
    {id: "dress", name: "魔法少女礼装", look: "白金配色的礼装，披风内衬是流动的星图", src: imageDress},
    {id: "pajamas", name: "睡衣", look: "妹妹挑的兔子睡衣，袖子长了一截", src: null},
]));

/** 现在穿的：建议值是衣柜里各套的名字，也可以直接写一个衣柜里没有的。 */
const wearing = ref(blank.value ? "" : "哥哥的便装");
const wearQuery = ref("");
/** 正在改“现在穿的”：浮层锚在点的那个地方（这一项的值，或某一套的“换上”）。 */
const wearAnchor = ref<HTMLElement | null>(null);
const wearDraft = ref("");
const wearIntent = ref<"setting" | "plot">("setting");
const changeWearing = (event: Event, name?: string): void => {
    wearAnchor.value = event.currentTarget as HTMLElement;
    wearDraft.value = name ?? wearing.value;
    // 换上某一套多半是剧情里的事：意图预选“从这一章起”。
    wearIntent.value = name === undefined ? "setting" : "plot";
};
const root = ref<HTMLElement | null>(null);
// 截图用：换装的场景一上来就开着“学院制服”的那个浮层。
onMounted(() => {
    if (props.scene !== "wearing") return;
    void nextTick(() => {
        wearAnchor.value = root.value?.querySelector<HTMLElement>("[data-put-on='uniform']") ?? null;
        wearDraft.value = "学院制服";
        wearIntent.value = "plot";
    });
});
const wearOptions = computed((): SearchSelectOption[] => {
    const word = wearQuery.value.trim();
    const listed = outfits.value.filter((item) => item.name.includes(word)).map((item) => ({value: item.name, label: item.name}));
    return word === "" || outfits.value.some((item) => item.name === word) ? listed : [...listed, {value: word, label: `用“${word}”`}];
});

/* ---------- 选立绘 ---------- */

const picking = ref(props.scene === "pick-image");
const LIBRARY = [
    {path: "插图/星瑕-立绘.webp", src: portraitSrc},
    {path: "插图/星瑕-便装.webp", src: imageHome},
    {path: "插图/星瑕-制服.webp", src: imageUniform},
    {path: "插图/星瑕-礼装.webp", src: imageDress},
    {path: "插图/星瑾-害羞.webp", src: imageShy},
    {path: "插图/星瑾-灵感.webp", src: imageIdea},
    {path: "插图/彗-思考.webp", src: imageThink},
    {path: "插图/星瑾-便装.webp", src: imageHome},
];
const picked = ref("插图/星瑕-立绘.webp");
const caption = ref("淡金长发的少女侧身回头，披风扬起");
const intent = ref<"setting" | "plot">("setting");
const INTENTS = [{value: "setting", label: "一直是这样"}, {value: "plot", label: "从第 3 章末尾起"}];
</script>

<template>
    <div ref="root" class="look-view" data-look-view>
        <div class="look-view__top">
            <Popover :open="picking" side="right" align="start" content-class="look-view__popover" @update:open="(next: boolean) => (picking = next)">
                <template #trigger>
                    <button v-if="!blank" type="button" class="look-view__portrait nb-ui-focus-ring" aria-label="换一张立绘" data-portrait>
                        <img :src="portraitSrc" alt="淡金长发的少女侧身回头，披风扬起" />
                        <span class="look-view__portrait-action"><span class="i-lucide-image-up size-3.5" aria-hidden="true" />换一张</span>
                    </button>
                    <button v-else type="button" class="look-view__portrait look-view__portrait--empty nb-ui-focus-ring" data-portrait>
                        <span class="i-lucide-image-plus size-7" aria-hidden="true" />
                        <span>添加立绘</span>
                    </button>
                </template>
                <div class="look-view__picker" data-image-picker>
                    <div class="flex items-center justify-between">
                        <p class="look-view__picker-title">立绘</p>
                        <Button size="sm" variant="ghost"><span class="i-lucide-upload size-3.5" aria-hidden="true" />上传</Button>
                    </div>
                    <ul class="look-view__library">
                        <li v-for="image in LIBRARY" :key="image.path">
                            <button type="button" class="look-view__tile nb-ui-focus-ring" :title="image.path" :aria-pressed="picked === image.path" :data-picked="picked === image.path ? '' : undefined" @click="picked = image.path">
                                <img :src="image.src" :alt="image.path" />
                            </button>
                        </li>
                    </ul>
                    <p class="look-view__path">{{ picked }}</p>
                    <Input v-model="caption" size="sm" placeholder="图片的说明" aria-label="图片的说明" />
                    <SegmentedControl v-model="intent" size="sm" :options="INTENTS" aria-label="这次改的是什么" />
                    <div class="flex justify-end gap-2">
                        <Button size="sm" variant="ghost" @click="picking = false">取消</Button>
                        <Button size="sm" variant="primary" @click="picking = false">保存</Button>
                    </div>
                </div>
            </Popover>

            <div class="min-w-0 flex-1">
                <section class="look-view__block">
                    <header><h3>外貌</h3></header>
                    <button type="button" class="look-view__passage nb-markdown nb-ui-focus-ring" :class="{'look-view__passage--empty': appearance === null}">{{ appearance ?? "发色、眼睛、体型，一眼认得出来的地方" }}</button>
                </section>
                <section class="look-view__block look-view__block--line">
                    <header><h3>现在穿的</h3><span v-if="!blank" class="look-view__mark">第 2 章改过</span></header>
                    <button type="button" class="look-view__value nb-ui-focus-ring" :class="{'look-view__value--empty': wearing === ''}" data-edit="look.现在穿的" @click="changeWearing($event)">{{ wearing === "" ? "填写" : wearing }}</button>
                </section>
            </div>
        </div>

        <section class="look-view__wardrobe">
            <header><h3>衣柜</h3></header>
            <ul class="look-view__outfits">
                <li v-for="outfit in outfits" :key="outfit.id" class="look-view__outfit" :data-wearing="wearing === outfit.name ? '' : undefined">
                    <button type="button" class="look-view__outfit-main nb-ui-focus-ring" :aria-label="`改“${outfit.name}”`">
                        <span class="look-view__outfit-image">
                            <img v-if="outfit.src !== null" :src="outfit.src" alt="" />
                            <span v-else class="i-lucide-shirt size-6" aria-hidden="true" />
                        </span>
                        <span class="look-view__outfit-name">{{ outfit.name }}</span>
                        <span class="look-view__outfit-look">{{ outfit.look }}</span>
                    </button>
                    <div class="look-view__outfit-foot">
                        <Badge v-if="wearing === outfit.name" tone="accent" variant="soft" size="sm">穿着</Badge>
                        <Button v-else size="sm" variant="ghost" :data-put-on="outfit.id" @click="changeWearing($event, outfit.name)">换上</Button>
                        <IconButton class="look-view__more" size="sm" icon-class="i-lucide-ellipsis" :aria-label="`${outfit.name}：改、去掉`" />
                    </div>
                </li>
                <li>
                    <button type="button" class="look-view__outfit look-view__outfit--add nb-ui-focus-ring">
                        <span class="i-lucide-plus size-5" aria-hidden="true" />
                        <span>添加一套</span>
                    </button>
                </li>
            </ul>
        </section>

        <!-- “现在穿的”的编辑器只有一个，锚在点的那个地方。 -->
        <Popover :open="wearAnchor !== null" :anchor="wearAnchor" side="bottom" align="start" content-class="look-view__popover look-view__popover--field" @update:open="(next: boolean) => { if (!next) wearAnchor = null; }">
            <div class="look-view__picker" data-wearing-editor>
                <p class="look-view__picker-title">现在穿的</p>
                <SearchSelect v-model="wearDraft" size="sm" :filter="false" :options="wearOptions" :selected-label="wearDraft" aria-label="现在穿的" placeholder="从衣柜里选，或者直接写" @search="(word: string) => (wearQuery = word)" />
                <SegmentedControl v-model="wearIntent" size="sm" :options="INTENTS" aria-label="这次改的是什么" />
                <p class="look-view__route">{{ wearIntent === "setting" ? "改的是初值" : "在第 3 章末尾记一条变更" }}<br />{{ wearIntent === "setting" ? "" : "之后各章读到的都是新的值" }}</p>
                <div class="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" @click="wearAnchor = null">取消</Button>
                    <Button size="sm" variant="primary" @click="wearAnchor = null">保存</Button>
                </div>
            </div>
        </Popover>
    </div>
</template>

<style scoped>
.look-view {
    container-type: inline-size;
    min-width: 0;
    font-size: var(--text-sm);
    color: var(--text-main);
    --markdown-font-size: 17px;
    --markdown-line-height: 1.95;
}
.look-view__top {
    display: flex;
    gap: 2rem;
    align-items: flex-start;
}
/* 这一页只有立绘用力。 */
.look-view__portrait {
    position: relative;
    flex-shrink: 0;
    width: 16rem;
    aspect-ratio: 3 / 4;
    overflow: hidden;
    border-radius: var(--radius-panel);
    background: var(--bg-subtle);
    box-shadow: 0 1px 2px color-mix(in srgb, var(--text-main) 12%, transparent), 0 12px 32px -14px color-mix(in srgb, var(--text-main) 38%, transparent);
}
.look-view__portrait img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}
.look-view__portrait-action {
    position: absolute;
    right: 0.625rem;
    bottom: 0.625rem;
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
.look-view__portrait:hover .look-view__portrait-action,
.look-view__portrait:focus-visible .look-view__portrait-action,
.look-view__portrait[data-state="open"] .look-view__portrait-action {
    opacity: 1;
}
.look-view__portrait--empty {
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
.look-view__portrait--empty:hover {
    border-color: var(--accent-main);
    color: var(--accent-text);
}
.look-view__block > header,
.look-view__wardrobe > header {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    margin-bottom: 0.375rem;
}
.look-view h3 {
    flex: 1;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-secondary);
}
.look-view__block--line {
    margin-top: 1.25rem;
    padding-top: 1.25rem;
    border-top: 1px solid var(--divider);
}
.look-view__value {
    padding: 0.125rem 0.25rem;
    margin-left: -0.25rem;
    border-radius: var(--radius-control);
    text-align: left;
    transition: background var(--motion-fast) var(--ease-layout);
}
.look-view__value:hover {
    background: var(--bg-hover);
}
.look-view__value--empty {
    color: var(--text-muted);
}
.look-view__mark {
    flex-shrink: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
}
.look-view__passage {
    display: block;
    width: calc(100% + 1rem);
    margin: 0 -0.5rem;
    padding: 0.125rem 0.5rem;
    border-radius: var(--radius-control);
    text-align: left;
    font-size: var(--markdown-font-size);
    line-height: var(--markdown-line-height);
    transition: background var(--motion-fast) var(--ease-layout);
}
.look-view__passage:hover {
    background: var(--bg-hover);
}
.look-view__passage--empty {
    font-size: var(--text-sm);
    line-height: 1.75rem;
    color: var(--text-muted);
}
.look-view__wardrobe {
    margin-top: 1.75rem;
    padding-top: 1.25rem;
    border-top: 1px solid var(--divider);
}
.look-view__outfits {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr));
    /* 各行一样高：单独落在一行的“添加一套”也是一张卡的高度。 */
    grid-auto-rows: 1fr;
    gap: 0.75rem;
    margin: 0;
    padding: 0;
    list-style: none;
}
.look-view__outfits > li {
    display: flex;
    min-width: 0;
}
/* 每张卡的行数与每行的高度固定：没有图、说明长短不一都一样高。 */
.look-view__outfit {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    border: 1px solid var(--divider);
    border-radius: var(--radius-control);
    transition: border-color var(--motion-fast) var(--ease-layout);
}
.look-view__outfit[data-wearing] {
    border-color: var(--accent-main);
}
.look-view__outfit-main {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.625rem 0.625rem 0.25rem;
    border-radius: inherit;
    text-align: left;
}
.look-view__outfit-image {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 6rem;
    margin-bottom: 0.25rem;
    border-radius: calc(var(--radius-control) - 2px);
    background: var(--bg-subtle);
    color: var(--text-muted);
}
.look-view__outfit-image img {
    max-width: 100%;
    height: 100%;
    object-fit: contain;
}
.look-view__outfit-name {
    overflow: hidden;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.look-view__outfit-look {
    display: -webkit-box;
    height: 2.5rem;
    overflow: hidden;
    font-size: var(--text-xs);
    line-height: 1.25rem;
    color: var(--text-secondary);
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
}
.look-view__outfit-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 2.25rem;
    padding: 0 0.375rem 0.375rem 0.625rem;
}
.look-view__outfit-foot :deep(button:first-child) {
    margin-left: -0.375rem;
}
.look-view__more {
    opacity: 0;
    transition: opacity var(--motion-fast) var(--ease-layout);
}
.look-view__outfit:hover .look-view__more,
.look-view__more:focus-visible {
    opacity: 1;
}
.look-view__outfit--add {
    align-items: center;
    justify-content: center;
    gap: 0.375rem;
    min-height: 13.75rem;
    border-style: dashed;
    color: var(--text-muted);
    transition: color var(--motion-fast) var(--ease-layout), border-color var(--motion-fast) var(--ease-layout);
}
.look-view__outfit--add:hover {
    border-color: var(--accent-main);
    color: var(--accent-text);
}
/* 窄处立绘放到上面、缩小。 */
@container (max-width: 560px) {
    .look-view__top {
        flex-direction: column;
        gap: 1rem;
    }
    .look-view__portrait {
        width: 10rem;
    }
}
</style>

<!-- 浮层经 Portal 渲染在组件树之外，scoped 样式够不到。 -->
<style>
.look-view__popover {
    width: 21rem;
}
.look-view__popover .look-view__picker {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
}
.look-view__popover .look-view__picker-title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-secondary);
}
.look-view__popover .look-view__library {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.375rem;
    margin: 0;
    padding: 0;
    list-style: none;
}
.look-view__popover .look-view__tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.125rem;
    width: 100%;
    aspect-ratio: 1;
    overflow: hidden;
    border-radius: var(--radius-control);
    background: var(--bg-subtle);
    font-size: var(--text-xs);
    color: var(--text-secondary);
    box-shadow: 0 0 0 0 transparent;
    transition: box-shadow var(--motion-fast) var(--ease-layout);
}
.look-view__popover .look-view__tile img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}
.look-view__popover .look-view__tile[data-picked] {
    box-shadow: 0 0 0 2px var(--accent-main);
}
.look-view__popover--field {
    width: 19rem;
}
/* 预览固定占两行，浮层的大小不变。 */
.look-view__popover .look-view__route {
    height: 2.5rem;
    overflow: hidden;
    font-size: var(--text-xs);
    line-height: 1.25rem;
    color: var(--text-secondary);
}
.look-view__popover .look-view__path {
    overflow: hidden;
    font-size: var(--text-xs);
    color: var(--text-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
}
</style>
