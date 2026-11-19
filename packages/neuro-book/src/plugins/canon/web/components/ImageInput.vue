<script setup lang="ts">
/**
 * 图片字段的输入（同名 .md）：路径与说明两个输入框，整值受控；路径的规则用内核的 `assetPathProblem` 先查一遍，服务退回的
 * 原因（`problem`）优先。
 */
import {computed} from "vue";

// 走不带引擎的子路径：根入口带着 MDX 解析链，Lab 的开发服务里会把 CommonJS 的依赖原样交给浏览器。
import {assetPathProblem} from "@notnotype/nb-canon/schema";
import {Input} from "@notnotype/nb-ui/components";

import {useCanonText} from "../text";
import type {ImageValue} from "./image-input";

const props = withDefaults(defineProps<{
    modelValue: ImageValue | null;
    problem?: string;
    disabled?: boolean;
}>(), {problem: undefined, disabled: false});

const emit = defineEmits<{(e: "update:modelValue", value: ImageValue | null): void}>();

const text = useCanonText();
const path = computed(() => props.modelValue?.["图片"] ?? "");
const caption = computed(() => props.modelValue?.["说明"] ?? "");
/** 写在输入下面的原因：服务退回的优先；只填了说明、没填路径的图片存不进去，先说一声。 */
const reason = computed(() => {
    if (props.problem !== undefined) return props.problem;
    if (path.value === "") return caption.value === "" ? undefined : text("imageInput.needPath");
    return assetPathProblem(path.value) !== null ? text("imageInput.badPath") : undefined;
});

function update(next: {readonly 图片: string; readonly 说明: string}): void {
    emit("update:modelValue", next["图片"] === "" && next["说明"] === "" ? null : next);
}
</script>

<template>
    <div class="flex w-full flex-col gap-[var(--space-2)]" data-image-input>
        <Input
            :model-value="path"
            :placeholder="text('imageInput.pathPlaceholder')"
            :aria-label="text('imageInput.path')"
            :invalid="reason !== undefined"
            :disabled="props.disabled"
            @update:model-value="(value: string) => update({图片: value, 说明: caption})"
        />
        <Input
            :model-value="caption"
            :placeholder="text('imageInput.caption')"
            :aria-label="text('imageInput.caption')"
            :disabled="props.disabled"
            @update:model-value="(value: string) => update({图片: path, 说明: value})"
        />
        <p v-if="reason !== undefined" class="text-[length:var(--text-xs)] text-[var(--status-danger)]" data-image-problem>{{ reason }}</p>
    </div>
</template>
