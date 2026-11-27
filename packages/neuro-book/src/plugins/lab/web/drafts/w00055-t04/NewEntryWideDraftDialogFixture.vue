<script setup lang="ts">
/** w00055 t04 新建对话框横版静态稿的台子：注入 canon 的文字（勾选列表要用）。 */
import {useLabSubject} from "../../lab-subject";
import type {LabFixtureProps} from "../../lab-subject";
import {provideCanonText} from "../../../../canon/web/lab/canon-text";
import NewEntryWideDraftDialog from "./NewEntryWideDraftDialog.vue";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);
const subject = useLabSubject<typeof NewEntryWideDraftDialog>(() => props.input, []);
</script>

<template>
    <div data-lab-subject>
        <NewEntryWideDraftDialog v-bind="subject.bindings.value" />
    </div>
</template>
