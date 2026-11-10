<script setup lang="ts">
/**
 * 条目树的夹具：注入登记了 `nbook.canon` 目录的翻译端口（Lab 窗口的端口没有它，做法同 `explorer-scene/explorer-text.ts`）。
 * 展开状态是场景的双向绑定，由 Lab 管；`open`、`more`、`retry` 记成事件。场景 id 以 `-english` 结尾的用英文界面。
 */
import {provide} from "vue";

import {TEXT_PORT_KEY} from "@notnotype/nb-ui/text-port";

import EntryTree from "nbook/plugins/canon/web/components/EntryTree.vue";
import {canonCatalogs} from "nbook/plugins/canon/web/text";
import {createHostTextEngine} from "nbook/web/host/text-engine";

import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const engine = createHostTextEngine({locale: props.scene.endsWith("-english") ? "en-US" : "zh-CN"});
engine.register("nbook.canon", canonCatalogs.catalogs, canonCatalogs.source);
provide(TEXT_PORT_KEY, engine.port);

const subject = useLabSubject<typeof EntryTree>(() => props.input, ["open", "more", "retry"]);
</script>

<template>
    <EntryTree data-lab-subject class="w-72" v-bind="subject.bindings.value" />
</template>
