<script setup lang="ts">
/** 竖排分页的夹具：注入 canon 的翻译端口（`canon-text.ts`）；选中的分页是场景的双向绑定，由 Lab 管。放在 168 像素宽的一栏里，同条目页。 */
import EntryPageNav from "nbook/plugins/canon/web/components/EntryPageNav.vue";

import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);

const subject = useLabSubject<typeof EntryPageNav>(() => props.input, ["add-toggle", "context"]);
</script>

<template>
    <div class="w-full p-4">
        <EntryPageNav data-lab-subject class="w-[42%] min-w-40 max-w-56" v-bind="subject.bindings.value" :tab-id="(value: string) => `lab-tab-${value}`" />
    </div>
</template>
