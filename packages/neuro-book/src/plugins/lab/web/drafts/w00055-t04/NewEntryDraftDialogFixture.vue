<script setup lang="ts">
/** w00055 t04 新建对话框静态稿的台子：注入 canon 的文字（勾选列表要用）。 */
import {useLabSubject} from "../../lab-subject";
import type {LabFixtureProps} from "../../lab-subject";
import {provideCanonText} from "../../../../canon/web/lab/canon-text";
import NewEntryDraftDialog from "./NewEntryDraftDialog.vue";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);
const subject = useLabSubject<typeof NewEntryDraftDialog>(() => props.input, []);
</script>

<template>
    <div data-lab-subject>
        <NewEntryDraftDialog v-bind="subject.bindings.value" />
    </div>
</template>
