<script setup lang="ts">
/** w00039 t41 第 2 轮静态稿（不合并）：人物这一组设定的分页（角色卡）。立绘读自同一条目上的形象组。同名 .md。 */
import {computed, onMounted, ref} from "vue";

import "@notnotype/nb-markdown/markdown.css";
import {Button, IconButton, Input, Popover, SearchSelect, SegmentedControl, Textarea} from "@notnotype/nb-ui/components";
import type {SearchSelectOption} from "@notnotype/nb-ui/components";

import EntryPicker from "nbook/plugins/canon/web/components/EntryPicker.vue";
import OriginList from "nbook/plugins/canon/web/components/OriginList.vue";
import type {EntryResults} from "nbook/plugins/canon/web/components/entry-picker";
import {portraitSrc} from "./images";

type Scene = "filled" | "no-look" | "empty" | "edit-suggest" | "edit-ref" | "edit-text" | "add-field" | "origins" | "semantic";

const props = withDefaults(defineProps<{scene?: Scene}>(), {scene: "filled"});

interface Fact {
    readonly id: string;
    readonly label: string;
    readonly value: string | null;
    readonly kind: "text" | "suggest" | "ref";
    readonly suggest?: readonly string[];
    /** 引用字段可以指向的种类。 */
    readonly target?: string;
    /** 作者自己加的一项：可以改名、去掉。 */
    readonly own?: boolean;
    readonly mark?: string;
}
interface Passage {
    readonly id: string;
    readonly label: string;
    readonly value: string | null;
    readonly hint: string;
    readonly mark?: string;
}

const blank = computed(() => props.scene === "empty");

const facts = computed((): Fact[] => [
    {id: "性别", label: "性别", kind: "suggest", value: blank.value ? null : "女", suggest: ["男", "女", "不明"]},
    {id: "年龄", label: "年龄", kind: "text", value: blank.value ? null : "17 岁"},
    {id: "身份", label: "身份", kind: "text", value: blank.value ? null : "隐退的魔法少女"},
    {id: "所属", label: "所属", kind: "ref", target: "组织", value: blank.value ? null : "对策委员会魔法少女部"},
    {id: "现在在哪", label: "现在在哪", kind: "ref", target: "地点", value: blank.value ? null : "星家老宅", mark: "第 2 章改过"},
    {id: "生死", label: "生死", kind: "suggest", value: blank.value ? null : "活着", suggest: ["活着", "已故", "失踪"]},
    ...(blank.value ? [] : [
        {id: "种族", label: "种族", kind: "text", value: "人类", own: true} as const,
        {id: "喜好", label: "喜好", kind: "text", value: "甜食，尤其是妹妹做的布丁", own: true} as const,
    ]),
]);
const condition = computed((): Passage => ({id: "现在的状态", label: "现在的状态", value: blank.value ? null : "以哥哥的样子和妹妹同住，魔力还没恢复到能变身的程度", hint: "受伤、被通缉、刚搬家……此刻的处境", mark: "第 2 章改过"}));
const passages = computed((): Passage[] => [
    {id: "性格", label: "性格", value: blank.value ? null : "迟钝，情商不高，做事认真。想对妹妹好，常常用错方法，过后才知道搞砸了。", hint: "遇事怎么反应，最在意什么"},
    {id: "说话方式", label: "说话方式", value: null, hint: "口头禅、语气、对不同的人怎么称呼"},
    {id: "背景", label: "背景", value: blank.value ? null : "六岁那年的城市大灾难里失去了父母。之后觉醒了时间系的天赋，被对策委员会带进魔法少女部，几年里成了蓝星最强；灾难平息后，官方给她安了罪名，她顺势隐退。", hint: "从哪里来，经历过什么"},
]);

/** 立绘那一格的三种样子：有形象组也有立绘、有形象组没立绘、条目上没有形象这一组。 */
const portrait = computed(() => (props.scene === "no-look" ? "no-look" : blank.value ? "no-image" : "image"));

/* ---------- 就地改 ---------- */

const editing = ref<string | null>(props.scene === "edit-suggest" ? "性别" : props.scene === "edit-ref" ? "所属" : props.scene === "edit-text" ? "背景" : null);
const draft = ref(props.scene === "edit-suggest" ? "女" : props.scene === "edit-text" ? "六岁那年的城市大灾难里失去了父母，被远房的姑姑带大。之后觉醒了时间系的天赋，被对策委员会带进魔法少女部，几年里成了蓝星最强；灾难平息后，官方给她安了罪名，她顺势隐退。" : "");
const intent = ref<"setting" | "plot">(props.scene === "edit-ref" ? "plot" : "setting");
const INTENTS = [{value: "setting", label: "一直是这样"}, {value: "plot", label: "从第 3 章末尾起"}];
const route = computed(() => (intent.value === "setting" ? "改的是初值" : "在第 3 章末尾记一条变更"));
/** 带来的变化：占第二行，没有时这一行空着。 */
const impact = computed(() => (editing.value === "背景" ? "" : intent.value === "plot" ? "之后各章读到的都是新的值" : ""));
const open = (fact: {id: string; value: string | null}): void => {
    editing.value = fact.id;
    draft.value = fact.value ?? "";
    intent.value = "setting";
};
const close = (): void => {
    editing.value = null;
};

/** 有建议值的项：下拉里列建议值，也可以直接打字，没有同名的建议值时末尾多一行“用‘某某’”。 */
const query = ref("");
const suggestOptions = (fact: Fact): SearchSelectOption[] => {
    const word = query.value.trim();
    const listed = (fact.suggest ?? []).filter((item) => item.includes(word)).map((item) => ({value: item, label: item}));
    return word === "" || (fact.suggest ?? []).includes(word) ? listed : [...listed, {value: word, label: `用“${word}”`}];
};

const ORGANIZATIONS = [
    {id: "o1", name: "对策委员会魔法少女部", kind: "组织"},
    {id: "o2", name: "第三魔法学院", kind: "组织"},
    {id: "o3", name: "蓝星联邦对策委员会", kind: "组织", note: "别名：对策委"},
];
const refValue = ref<string | null>("o1");
const refResults = ref<EntryResults>({kind: "idle"});
const searchRef = (word: string): void => {
    refResults.value = {kind: "done", query: word, items: ORGANIZATIONS.filter((item) => item.name.includes(word) || (item.note ?? "").includes(word))};
};

// 截图用：浮层在组件树之外，截图脚本点不到，这一场景自己把下拉点开。
onMounted(() => {
    if (props.scene !== "edit-suggest") return;
    let tries = 0;
    const tick = (): void => {
        const input = document.querySelector<HTMLInputElement>("[data-fact-editor='性别'] input");
        if (input !== null) input.click();
        else if (++tries < 120) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
});

/* ---------- 来历与语义档的细节 ---------- */

const origins = ref<string | null>(props.scene === "origins" ? "现在在哪" : null);
const ORIGIN_ROWS = [
    {key: "c2", where: "第 2 章", what: "把妹妹接回老宅同住", result: "星家老宅", change: "c2"},
    {key: "init", where: "", what: "初值", result: "第三魔法学院宿舍"},
];
const detail = ref(props.scene === "semantic");
const NOTE_ROWS = [
    {key: "c5", where: "第 2 章", what: "魔力只恢复了三成，变不了身", result: ""},
    {key: "c3", where: "第 1 章", what: "用哥哥的样子去学院接妹妹", result: ""},
    {key: "init", where: "", what: "起点：隐退后独自住在学院宿舍", result: ""},
];
const note = ref("");

/* ---------- 添加一项资料 ---------- */

const adding = ref(props.scene === "add-field");
const PRESETS = ["生日", "弱点", "动机", "初次登场"];
/** 去掉过的一项：数据还在，可以恢复。 */
const REMOVED = ["身高"];
</script>

<template>
    <div class="character-view" data-character-view>
        <div class="character-view__top">
            <button v-if="portrait === 'image'" type="button" class="character-view__portrait" aria-label="打开形象">
                <img :src="portraitSrc" alt="星瑕的立绘" />
                <span class="character-view__portrait-action">形象<span class="i-lucide-arrow-up-right size-3.5" aria-hidden="true" /></span>
            </button>
            <button v-else type="button" class="character-view__portrait character-view__portrait--empty">
                <span :class="portrait === 'no-look' ? 'i-lucide-shirt' : 'i-lucide-image-plus'" class="size-6" aria-hidden="true" />
                <span>{{ portrait === "no-look" ? "添加形象" : "添加立绘" }}</span>
            </button>

            <div class="min-w-0 flex-1">
                <dl class="character-view__facts">
                    <div v-for="fact in facts" :key="fact.id" class="character-view__fact">
                        <dt>{{ fact.label }}</dt>
                        <dd>
                            <Popover :open="editing === fact.id" side="bottom" align="start" content-class="character-view__popover" @update:open="(next: boolean) => (next ? open(fact) : close())">
                                <template #trigger>
                                    <button type="button" class="character-view__value nb-ui-focus-ring" :class="{'character-view__value--ref': fact.kind === 'ref' && fact.value !== null, 'character-view__value--empty': fact.value === null}" :data-fact="fact.id" :data-edit="`character.${fact.id}`">{{ fact.value ?? "填写" }}</button>
                                </template>
                                <div class="character-view__editor" :data-fact-editor="fact.id">
                                    <p class="character-view__editor-title">{{ fact.label }}</p>
                                    <SearchSelect
                                        v-if="fact.kind === 'suggest'"
                                        v-model="draft"
                                        size="sm"
                                        :filter="false"
                                        :options="suggestOptions(fact)"
                                        :selected-label="draft"
                                        :aria-label="fact.label"
                                        placeholder="选一个，或者直接写"
                                        @search="(word: string) => (query = word)"
                                    />
                                    <EntryPicker v-else-if="fact.kind === 'ref'" v-model="refValue" :results="refResults" selected-name="对策委员会魔法少女部" :create-kind="fact.target" :aria-label="fact.label" @search="searchRef" />
                                    <Input v-else v-model="draft" size="sm" :aria-label="fact.label" />
                                    <SegmentedControl v-model="intent" size="sm" :options="INTENTS" aria-label="这次改的是什么" />
                                    <p class="character-view__route">{{ route }}<br />{{ impact }}</p>
                                    <div class="flex justify-end gap-2">
                                        <Button size="sm" variant="ghost" @click="close()">取消</Button>
                                        <Button size="sm" variant="primary" @click="close()">保存</Button>
                                    </div>
                                </div>
                            </Popover>
                            <Popover v-if="fact.mark !== undefined && fact.value !== null" :open="origins === fact.id" side="bottom" align="start" content-class="character-view__popover character-view__popover--wide" @update:open="(next: boolean) => (origins = next ? fact.id : null)">
                                <template #trigger>
                                    <button type="button" class="character-view__mark character-view__mark--button nb-ui-focus-ring">{{ fact.mark }}</button>
                                </template>
                                <OriginList :rows="ORIGIN_ROWS" :caption="`${fact.label}是怎么来的`" data-origins />
                            </Popover>
                            <IconButton v-if="fact.own === true" class="character-view__more" size="sm" icon-class="i-lucide-ellipsis" :aria-label="`${fact.label}：改名、去掉`" />
                        </dd>
                    </div>
                </dl>
                <Popover :open="adding" side="bottom" align="start" content-class="character-view__popover" @update:open="(next: boolean) => (adding = next)">
                    <template #trigger>
                        <Button class="mt-2 -ml-2" size="sm" variant="ghost" data-add-field><span class="i-lucide-plus size-3.5" aria-hidden="true" />添加一项资料</Button>
                    </template>
                    <div class="character-view__editor" data-add-field-panel>
                        <ul class="character-view__presets">
                            <li v-for="preset in PRESETS" :key="preset"><button type="button" class="nb-ui-menu-item w-full">{{ preset }}</button></li>
                            <li v-for="removed in REMOVED" :key="removed"><button type="button" class="nb-ui-menu-item w-full"><span class="i-lucide-rotate-ccw size-3.5 text-[var(--text-secondary)]" aria-hidden="true" />恢复“{{ removed }}”</button></li>
                        </ul>
                        <div class="character-view__own">
                            <Input class="min-w-0 flex-1" size="sm" placeholder="别的，写它的名字" aria-label="新的一项的名字" />
                            <Button size="sm" variant="secondary">添加</Button>
                        </div>
                    </div>
                </Popover>

                <div class="character-view__condition character-view__slot">
                    <span class="character-view__label">{{ condition.label }}</span>
                    <button type="button" class="character-view__value nb-ui-focus-ring" :class="{'character-view__value--empty': condition.value === null}" :aria-expanded="detail" data-condition @click="detail = !detail">{{ condition.value ?? condition.hint }}</button>
                    <span v-if="condition.mark !== undefined && condition.value !== null" class="character-view__mark">{{ condition.mark }}</span>
                    <Transition name="character-view-lift">
                        <div v-if="detail" class="character-view__lifted character-view__lifted--below" data-condition-detail>
                            <OriginList :rows="NOTE_ROWS" />
                            <div class="flex items-center gap-2">
                                <Input v-model="note" class="min-w-0 flex-1" size="sm" placeholder="第 3 章末尾发生了什么" aria-label="记一句" />
                                <Button size="sm" variant="secondary">记一句</Button>
                                <Button size="sm" variant="ghost">改起点</Button>
                            </div>
                        </div>
                    </Transition>
                </div>
            </div>
        </div>

        <!-- 成段的文字：照正文的字号与行距。改的时候编辑层浮在原处、向下长，后面的内容不动。 -->
        <section v-for="passage in passages" :key="passage.id" class="character-view__section">
            <header><h3>{{ passage.label }}</h3><span v-if="passage.mark !== undefined" class="character-view__mark">{{ passage.mark }}</span></header>
            <div class="character-view__slot">
                <button type="button" class="character-view__passage nb-markdown nb-ui-focus-ring" :class="{'character-view__passage--empty': passage.value === null}" :data-passage="passage.id" @click="open(passage)">{{ passage.value ?? passage.hint }}</button>
                <Transition name="character-view-lift">
                    <div v-if="editing === passage.id" class="character-view__lifted" :data-passage-editor="passage.id">
                        <Textarea v-model="draft" autosize :rows="3" :aria-label="passage.label" />
                        <div class="flex flex-wrap items-center gap-2">
                            <SegmentedControl v-model="intent" size="sm" :options="INTENTS" aria-label="这次改的是什么" />
                            <span class="character-view__route flex-1">{{ route }}</span>
                            <Button size="sm" variant="ghost" @click="close()">取消</Button>
                            <Button size="sm" variant="primary" @click="close()">保存</Button>
                        </div>
                    </div>
                </Transition>
            </div>
        </section>
    </div>
</template>

<style scoped>
.character-view {
    container-type: inline-size;
    min-width: 0;
    font-size: var(--text-sm);
    color: var(--text-main);
    --markdown-font-size: 17px;
    --markdown-line-height: 1.95;
}
.character-view__top {
    display: flex;
    gap: 1.75rem;
    align-items: flex-start;
}
/* 立绘是这一页唯一用力的地方：其余都是字。 */
.character-view__portrait {
    position: relative;
    flex-shrink: 0;
    width: 11rem;
    aspect-ratio: 3 / 4;
    overflow: hidden;
    border-radius: var(--radius-panel);
    background: var(--bg-subtle);
    box-shadow: 0 1px 2px color-mix(in srgb, var(--text-main) 12%, transparent), 0 8px 24px -12px color-mix(in srgb, var(--text-main) 35%, transparent);
}
.character-view__portrait img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}
.character-view__portrait-action {
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
.character-view__portrait:hover .character-view__portrait-action,
.character-view__portrait:focus-visible .character-view__portrait-action {
    opacity: 1;
}
.character-view__portrait--empty {
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
.character-view__portrait--empty:hover {
    border-color: var(--accent-main);
    color: var(--accent-text);
}
.character-view__facts {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.25rem 1.5rem;
    margin: 0;
}
/* 一项一行、行高固定：换成“填写”、多出“第 N 章改过”或行尾的按钮都不改变行的高度。 */
.character-view__fact {
    display: grid;
    grid-template-columns: 4.5rem minmax(0, 1fr);
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
    min-height: 1.75rem;
}
.character-view__fact dt,
.character-view__label {
    color: var(--text-secondary);
}
.character-view__fact dd {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    margin: 0;
}
.character-view__value {
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
.character-view__value:hover,
.character-view__value[data-state="open"] {
    background: var(--bg-hover);
}
.character-view__value--ref {
    color: var(--accent-text);
}
.character-view__value--empty {
    color: var(--text-muted);
}
.character-view__mark {
    flex-shrink: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
}
/* 自己加的项行尾的“更多”：位置一直留着，指到这一行才显出来。 */
.character-view__more {
    flex-shrink: 0;
    margin-left: auto;
    opacity: 0;
    transition: opacity var(--motion-fast) var(--ease-layout);
}
.character-view__fact:hover .character-view__more,
.character-view__more:focus-visible {
    opacity: 1;
}
.character-view__condition {
    display: grid;
    grid-template-columns: 4.5rem minmax(0, 1fr) auto;
    align-items: baseline;
    gap: 0.75rem;
    margin-top: 0.75rem;
    padding-top: 0.875rem;
    border-top: 1px solid var(--divider);
}
.character-view__condition .character-view__value {
    white-space: normal;
    line-height: 1.6;
}
.character-view__section {
    margin-top: 1.5rem;
    padding-top: 1.25rem;
    border-top: 1px solid var(--divider);
}
.character-view__section > header {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    margin-bottom: 0.375rem;
}
.character-view__section h3 {
    flex: 1;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-secondary);
}
.character-view__slot {
    position: relative;
}
.character-view__passage {
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
.character-view__passage:hover {
    background: var(--bg-hover);
}
.character-view__passage--empty {
    font-size: var(--text-sm);
    line-height: 1.75rem;
    color: var(--text-muted);
}
/* 编辑层盖在这一段上面、自己向下长，占位还是原来那一段的。 */
.character-view__lifted {
    position: absolute;
    z-index: 1;
    top: 0;
    right: -0.75rem;
    left: -0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    padding: 0.75rem;
    border-radius: var(--radius-panel);
    background: var(--bg-panel);
    box-shadow: var(--elevation-raised), 0 0 0 1px var(--divider);
}
/* 细节面板挂在这一行的下面，同样浮着。 */
.character-view__lifted--below {
    top: calc(100% + 0.375rem);
    right: 0;
    left: 0;
}
.character-view__mark--button {
    padding: 0 0.25rem;
    border-radius: var(--radius-control);
    transition: background var(--motion-fast) var(--ease-layout), color var(--motion-fast) var(--ease-layout);
}
.character-view__mark--button:hover,
.character-view__mark--button[data-state="open"] {
    background: var(--bg-hover);
    color: var(--text-secondary);
}
.character-view-lift-enter-active,
.character-view-lift-leave-active {
    transition: opacity var(--motion-base) var(--ease-layout), transform var(--motion-base) var(--ease-layout);
}
.character-view-lift-enter-from,
.character-view-lift-leave-to {
    opacity: 0;
    transform: translateY(-4px);
}
.character-view__own {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--divider);
}
.character-view__presets {
    margin: 0;
    padding: 0;
    list-style: none;
}
.character-view__route {
    min-height: 1.25rem;
    font-size: var(--text-xs);
    color: var(--text-secondary);
}
/* 窄处立绘放到上面、缩小，资料改成一列。 */
@container (max-width: 520px) {
    .character-view__top {
        flex-direction: column;
        gap: 1rem;
    }
    .character-view__portrait {
        width: 8rem;
    }
    .character-view__facts {
        grid-template-columns: minmax(0, 1fr);
    }
}
</style>

<!-- 浮层经 Portal 渲染在组件树之外，scoped 样式够不到。 -->
<style>
.character-view__popover {
    width: 19rem;
}
.character-view__popover .character-view__editor {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
}
.character-view__popover .character-view__editor-title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-secondary);
}
/* 预览固定占两行：写回哪里、带来的变化；报错也用这块位置，浮层的大小不变。 */
.character-view__popover .character-view__route {
    height: 2.5rem;
    overflow: hidden;
    font-size: var(--text-xs);
    line-height: 1.25rem;
    color: var(--text-secondary);
}
.character-view__popover--wide {
    width: 34rem;
}
.character-view__popover .character-view__presets {
    margin: 0;
    padding: 0;
    list-style: none;
}
.character-view__popover .character-view__own {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding-top: 0.625rem;
    border-top: 1px solid var(--divider);
}
</style>
