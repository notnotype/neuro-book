<script setup lang="ts">
import {NodeViewWrapper} from "@tiptap/vue-3";
import type {NodeViewProps} from "@tiptap/core";
import SkillChip from "nbook/app/components/common/SkillChip.vue";

const props = defineProps<NodeViewProps>();

const attrs = computed(() => props.node.attrs as {
    name: string;
});
</script>

<template>
    <!-- Agent 技能节点 -->
    <NodeViewWrapper as="span" class="nb-agent-skill-node">
        <SkillChip :name="attrs.name" />
    </NodeViewWrapper>
</template>

<style scoped>
.nb-agent-skill-node {
    display: inline-flex;
    margin: 0 0.1rem;
    vertical-align: baseline;
}
</style>
