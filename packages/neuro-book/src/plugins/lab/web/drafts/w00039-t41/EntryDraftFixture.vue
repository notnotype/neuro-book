<script setup lang="ts">
/** w00039 t41 第 2 轮静态稿的台子：真实的条目页骨架，分页内容是人物或形象的草稿。 */
import {computed, ref} from "vue";

import EntryPage from "nbook/plugins/canon/web/components/EntryPage.vue";
import CharacterViewDraft from "./CharacterViewDraft.vue";
import LookViewDraft from "./LookViewDraft.vue";

import type {LabFixtureProps} from "../../lab-subject";
import {provideCanonText} from "../../fixtures/canon-text";

const props = defineProps<LabFixtureProps & {view: "character" | "look"}>();
provideCanonText(props.scene);

type CharacterScene = InstanceType<typeof CharacterViewDraft>["$props"]["scene"];
type LookScene = InstanceType<typeof LookViewDraft>["$props"]["scene"];
const CHAPTERS = [{chapter: "3", index: 3, title: null, start: "3:start", end: "3:end"}];
const position = ref("3:end");
const blank = computed(() => props.scene === "empty");
/** 条目上有没有形象这一组：没有时没有它的分页。 */
const hasLook = computed(() => props.scene !== "no-look");
const tab = ref(props.view);
const tabs = computed(() => [
    {value: "character", label: "人物", iconClass: "i-lucide-user-round", segment: "own" as const},
    ...(hasLook.value ? [{value: "look", label: "形象", iconClass: "i-lucide-shirt", segment: "own" as const}] : []),
    {value: "text", label: "文字", iconClass: "i-lucide-file-text", segment: "own" as const},
    ...(blank.value ? [] : [{value: "history", label: "经历", iconClass: "i-lucide-footprints", segment: "view" as const}, {value: "plot", label: "情节", iconClass: "i-lucide-git-commit-horizontal", segment: "view" as const}]),
]);
</script>

<template>
    <div class="h-full w-full overflow-y-auto bg-[var(--panel-surface)]" data-lab-subject>
        <EntryPage
            status="normal"
            :name="blank ? '新人物' : '星瑕'"
            :summary="blank ? '' : '前蓝星最强的魔法少女，隐退后以哥哥的样子把妹妹接回家住'"
            :chapters="CHAPTERS"
            :position="position"
            :tabs="tabs"
            :tab="tab"
            editable
            :aliases="blank ? [] : ['小瑕']"
            @update:tab="(value: string) => (tab = value as 'character' | 'look')"
            @update:position="(value: string) => (position = value)"
        >
            <LookViewDraft v-if="tab === 'look'" :scene="props.view === 'look' ? (props.scene as LookScene) : 'filled'" />
            <CharacterViewDraft v-else :scene="props.view === 'character' ? (props.scene as CharacterScene) : 'filled'" />
        </EntryPage>
    </div>
</template>
