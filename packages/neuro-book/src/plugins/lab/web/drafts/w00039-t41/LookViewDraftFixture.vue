<script setup lang="ts">
/** w00039 t41 第 2 轮静态稿：条目页骨架里的LookViewDraft。 */
import type {LabFixtureProps} from "../../lab-subject";
import EntryDraftFixture from "./EntryDraftFixture.vue";

const props = defineProps<LabFixtureProps>();
</script>

<template>
    <EntryDraftFixture :scene="props.scene" view="look" />
</template>
