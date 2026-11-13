<script setup lang="ts">
/** 条目的悬停内容（同名 .md）：加载贡献方的组件并渲染，没有可显示的就退回文字。 */
import {onErrorCaptured, shallowRef, watch} from "vue";
import type {Component} from "vue";

import type {HoverSource} from "../items/registry";

defineOptions({name: "WorkbenchItemHover"});

const props = defineProps<{
    source: HoverSource;
    fallback: string;
}>();

const loaded = shallowRef<Component | null>(null);
const broken = shallowRef(false);

// 换了 source 就重新开始；先到的旧结果按 source 是否还是同一个丢掉。
watch(() => props.source, (source) => {
    loaded.value = null;
    broken.value = false;
    source.load().then((component) => {
        if (props.source === source) loaded.value = component;
    }, () => {
        if (props.source === source) broken.value = true;
    });
}, {immediate: true});

onErrorCaptured((error) => {
    broken.value = true;
    props.source.failed(error);
    return false;
});
</script>

<template>
    <component :is="loaded" v-if="loaded !== null && !broken" />
    <span v-else>{{ fallback }}</span>
</template>
