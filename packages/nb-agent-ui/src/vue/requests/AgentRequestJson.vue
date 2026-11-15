<script setup lang="ts">
/**
 * 原样显示一段 JSON（docs/specs/agent/request-trace.md 输出 22）：能解析的按两格缩进排开，带行号，很长的一行折行；行数很多时
 * 先显示前一段，点“显示全部”再全部画出来（几十万行一次画出来会卡住页面）。
 */
import {computed, ref, watch} from "vue";
import {Button} from "@notnotype/nb-ui/components";

import {useAgentText} from "../text";

const props = defineProps<{
    text: string;
}>();

const {t} = useAgentText();

/** 先画这么多行；一般的请求体在这以内。 */
const FIRST_LINES = 2000;

const lines = computed(() => {
    let pretty = props.text;
    try {
        pretty = JSON.stringify(JSON.parse(props.text), null, 2);
    } catch {
        // 不是 JSON（适配器交的原文）：原样按行显示。
    }
    return pretty.split("\n");
});

const showAll = ref(false);
watch(() => props.text, () => {
    showAll.value = false;
});
const shown = computed(() => (showAll.value ? lines.value : lines.value.slice(0, FIRST_LINES)));
</script>

<template>
    <div class="arj">
        <ol class="arj__code">
            <li v-for="(line, index) in shown" :key="index" class="arj__line"><span class="arj__ln" aria-hidden="true">{{ index + 1 }}</span><span class="arj__text">{{ line }}</span></li>
        </ol>
        <div v-if="shown.length < lines.length" class="arj__more">
            <Button size="sm" variant="ghost" @click="showAll = true">{{ t("requests.json.showAll", {count: lines.length}) }}</Button>
        </div>
    </div>
</template>

<style scoped>
.arj {
    min-width: 0;
}
.arj__code {
    margin: 0;
    padding: 0;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.6;
    list-style: none;
}
.arj__line {
    display: grid;
    grid-template-columns: 4.5em minmax(0, 1fr);
    gap: var(--space-2);
}
.arj__ln {
    color: var(--text-muted);
    text-align: right;
    user-select: none;
}
.arj__text {
    color: var(--text-main);
    overflow-wrap: anywhere;
    white-space: pre-wrap;
}
.arj__more {
    padding-top: var(--space-2);
}
</style>
