<script setup lang="ts">
/**
 * 世界横幅的夹具：注入 canon 的翻译端口（`canon-text.ts`）；`retry` 记成事件。
 */
import WorldBanners from "nbook/plugins/canon/web/components/entry-page/WorldBanners.vue";

import {useLabSubject, type LabFixtureProps} from "../lab-subject";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);

const subject = useLabSubject<typeof WorldBanners>(() => props.input, ["retry"]);
</script>

<template>
    <div data-lab-subject class="w-full">
        <WorldBanners v-bind="subject.bindings.value" />
    </div>
</template>
