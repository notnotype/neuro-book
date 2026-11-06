<script setup lang="ts">
import {AnchoredPopover, IconButton, Toolbar} from "@notnotype/nb-ui/components";
import {useTemplateRef} from "vue";

import type {LabFixtureProps} from "../../lab-subject";

defineProps<LabFixtureProps>();
/** 锚点不是可序列化的场景输入：这里的一段文字扮演选区。 */
const anchor = useTemplateRef<HTMLElement>("anchor");
</script>

<template>
    <div class="flex h-full w-full flex-col items-center justify-center p-4" data-lab-subject>
        <p class="text-sm text-[var(--text-main)]">天色将晚，<span ref="anchor" class="bg-[color-mix(in_srgb,var(--accent-main)_24%,transparent)]">渡口只剩一条船</span>。</p>
        <AnchoredPopover :open="true" :anchor="anchor">
            <Toolbar variant="flat" aria-label="选区格式" class="w-auto p-1">
                <IconButton title="粗体" icon-class="i-lucide-bold" size="sm" />
                <IconButton title="斜体" icon-class="i-lucide-italic" size="sm" />
            </Toolbar>
        </AnchoredPopover>
    </div>
</template>
