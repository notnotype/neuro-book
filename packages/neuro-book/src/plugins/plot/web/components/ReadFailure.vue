<script setup lang="ts">
/**
 * 剧情读取失败的那一条（docs/specs/plot/author-ui.md 输出 4 与失败与恢复）：写“剧情的数据读不出来”与服务给的说明，带“重试”。
 * 三张表与四个分页共用。没读到过时页面只有它；读到过的页面留着旧内容，它放在内容上面（canon/author-ui.md 输出 26）。
 */
import {Banner, Button} from "@notnotype/nb-ui/components";

import type {CanonFailure} from "nbook/plugins/canon/shared/contracts";

import {failureText} from "../page-shell";
import {usePlotText} from "../text";

const props = defineProps<{
    failure: CanonFailure;
}>();

const emit = defineEmits<{(event: "retry"): void}>();

const text = usePlotText();
</script>

<template>
    <Banner tone="danger" role="alert" :message="failureText(props.failure, text)">
        <template #actions><Button variant="primary" size="sm" @click="emit('retry')">{{ text("page.retry") }}</Button></template>
    </Banner>
</template>
