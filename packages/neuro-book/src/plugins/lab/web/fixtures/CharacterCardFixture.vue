<script setup lang="ts">
/**
 * 人物分页的展示层：注入 canon 的翻译端口与样本图（`canon-images.ts`）；“添加一项资料”的开关是场景的双向绑定。现在的状态展开时
 * 插槽里放一段样本的细节（真实的细节是绑定层的 `FieldDetail`，Lab 里没有世界）。
 */
import CharacterCard from "nbook/plugins/canon/web/components/groups/CharacterCard.vue";

import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import {provideSampleImages} from "./canon-images";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);
provideSampleImages();

const subject = useLabSubject<typeof CharacterCard>(() => props.input, ["edit", "origins", "toggle-condition", "portrait", "add-preset", "restore", "add-own", "rename", "remove"]);
</script>

<template>
    <div class="w-full">
        <CharacterCard data-lab-subject v-bind="subject.bindings.value">
            <template #condition-detail>
                <ol class="m-0 list-none p-0 text-[length:var(--text-sm)]">
                    <li class="py-0.5"><span class="mr-2 text-[length:var(--text-xs)] text-[var(--text-muted)]">第 2 章</span>魔力只恢复了三成，变不了身</li>
                    <li class="py-0.5"><span class="mr-2 text-[length:var(--text-xs)] text-[var(--text-muted)]">第 1 章</span>用哥哥的样子去学院接妹妹</li>
                </ol>
            </template>
        </CharacterCard>
    </div>
</template>
