<script setup lang="ts">
/**
 * 浮动提示的夹具：一段能滚动的页面，提示放在页面根元素的最末（同三个宿主）。注入 canon 的翻译端口（`canon-text.ts`），
 * 各个动作记成事件；`hold` 不接（Lab 里不自己收起）。
 */
import PageNotices from "nbook/plugins/canon/web/components/entry-page/PageNotices.vue";

import {type LabFixtureProps, useLabSubject} from "nbook/plugins/lab/web/scene-kit";
import {provideCanonText} from "./canon-text";

const props = defineProps<LabFixtureProps>();
provideCanonText(props.scene);

const subject = useLabSubject<typeof PageNotices>(() => props.input, ["receipt", "undo", "revisions", "close", "close-agent", "close-error"]);
const PARAGRAPHS = Array.from({length: 12}, (_, index) => `第 ${String(index + 1)} 段：六岁那年的城市大灾难里失去了父母，之后觉醒了时间系的天赋，被对策委员会带进魔法少女部。`);
</script>

<template>
    <div class="h-full w-full overflow-y-auto bg-[var(--panel-surface)]">
        <div class="min-h-full">
            <div class="mx-auto max-w-3xl px-8 py-6">
                <p v-for="paragraph in PARAGRAPHS" :key="paragraph" class="mb-3 text-[length:var(--text-sm)] text-[var(--text-main)]">{{ paragraph }}</p>
            </div>
            <PageNotices data-lab-subject v-bind="subject.bindings.value" />
        </div>
    </div>
</template>
