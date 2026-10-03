<script setup lang="ts">
const props = defineProps<{
    name: string;
}>();
</script>

<template>
    <!-- 通用技能 chip -->
    <span
        class="nb-skill-chip"
        :data-agent-skill-name="props.name"
        contenteditable="false"
    >
        <span class="nb-skill-chip__icon i-lucide-sparkles" aria-hidden="true"></span>
        <span class="nb-skill-chip__label">{{ props.name }}</span>
        <span class="nb-skill-chip__badge">技能</span>
    </span>
</template>
