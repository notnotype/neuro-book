<script setup lang="ts">
import AgentThinkingCollapsible from "../../components/novel-ide/agent/bubbles/base/AgentThinkingCollapsible.vue";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const longThinking = `首先梳理故事的世界观约束：在这个存在灵脉潮汐的世界里，所有魔法阵的运转都必须与月相周期同步。
主角在前文中提到的“在无月之夜强行突破结界”显然与该铁律存在冲突。
因此必须修正这里的逻辑链条：要么主角使用了某种能够储存灵潮的禁忌遗物，要么结界本身的弱点并非灵潮缺失，而是守卫阵眼的灵石产生了裂痕。
经过权衡，采用“禁忌遗物”的解释最具戏剧张力，同时能引出后文关于遗物来源的副线剧情。`;

const shortThinking = `正在计算本章节奏曲线与冲突张力指标...`;
</script>

<template>
    <div class="w-full p-4">
        <AgentThinkingCollapsible
            data-lab-subject
            class="w-full"
            :thinking="props.scene === 'short' ? shortThinking : longThinking"
            :default-collapsed="props.scene !== 'expanded'"
            :streaming="props.scene === 'streaming'"
        />
    </div>
</template>
