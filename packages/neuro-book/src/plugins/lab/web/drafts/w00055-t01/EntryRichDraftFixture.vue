<script setup lang="ts">
/** w00055 t01 富文本 spike 的台子：模式与初始文字来自场景登记的 props。 */
import EntryRichDraft from "./EntryRichDraft.vue";

import {useLabSubject, type LabFixtureProps} from "../../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof EntryRichDraft>(() => props.input, []);
</script>

<template>
    <div class="h-full w-full overflow-auto" data-lab-subject>
        <EntryRichDraft :key="props.scene" v-bind="subject.bindings.value" />
    </div>
</template>
