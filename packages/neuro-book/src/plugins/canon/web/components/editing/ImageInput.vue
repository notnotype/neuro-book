<script setup lang="ts">
/**
 * 图片字段的输入（同名 .md）：作品图片文件夹里的候选、上传、说明，另可手填路径；整值受控。候选与上传由宿主一层做、注入进来
 * （`images.ts` 的 `provideImagePicking`），这里只发动作。路径的规则用内核的 `assetPathProblem` 先查一遍，服务退回的原因（`problem`）优先。
 */
import {computed, onMounted, ref} from "vue";

// 只要路径的规则：走 schema 子路径，不把整个内核带进这个组件。
import {assetPathProblem} from "@notnotype/nb-canon/schema";
import {Button, Input} from "@notnotype/nb-ui/components";

import {IMAGE_ACCEPT, useImagePicking} from "../../images";
import {useCanonText} from "../../text";
import CanonImage from "../groups/CanonImage.vue";
import type {ImageValue} from "./image-input";

const props = withDefaults(defineProps<{
    modelValue: ImageValue | null;
    problem?: string;
    disabled?: boolean;
}>(), {problem: undefined, disabled: false});

const emit = defineEmits<{(e: "update:modelValue", value: ImageValue | null): void}>();

const text = useCanonText();
const fileInput = ref<HTMLInputElement | null>(null);
const path = computed(() => props.modelValue?.["图片"] ?? "");
const caption = computed(() => props.modelValue?.["说明"] ?? "");
// 宿主注入的候选与上传；没有（窗口里没有文件服务）时只剩手填路径与说明。
const injected = useImagePicking();
const picking = computed(() => (injected?.available === true ? injected : null));
/** 写在下面的原因：上传与列候选的、服务退回的优先；只填了说明、没填路径的图片存不进去，先说一声。 */
const reason = computed(() => {
    if (picking.value !== null && picking.value.reason !== "") return picking.value.reason;
    if (props.problem !== undefined) return props.problem;
    if (path.value === "") return caption.value === "" ? undefined : text("imageInput.needPath");
    return assetPathProblem(path.value) !== null ? text("imageInput.badPath") : undefined;
});

function update(next: {readonly 图片: string; readonly 说明: string}): void {
    emit("update:modelValue", next["图片"] === "" && next["说明"] === "" ? null : next);
}

// 每处选图片的地方挂上时重列：别处可能加了图，上一处的原因也不带过来。
onMounted(() => picking.value?.browse());

const onFile = async (event: Event): Promise<void> => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (file === undefined || picking.value === null) return;
    const stored = await picking.value.upload(file);
    if (stored !== null) update({图片: stored, 说明: caption.value});
};

// 上传在途时 Escape 取消上传，不往外传（外面的浮层不因此关掉，输出 51）。
const onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || event.isComposing || picking.value?.uploading !== true) return;
    event.preventDefault();
    event.stopPropagation();
    picking.value.cancel();
};
</script>

<template>
    <div class="flex w-full flex-col gap-[var(--space-2)]" data-image-input @keydown="onKeydown">
        <template v-if="picking !== null">
            <div class="flex items-center justify-between gap-2">
                <span class="text-[length:var(--text-xs)] text-[var(--text-secondary)]">{{ text("imageInput.candidates") }}</span>
                <!-- 上传与取消上传是同一个按钮、只换文字：换成两个按钮时焦点会随旧的那个掉到页面上，Escape 就到不了这里。 -->
                <Button
                    size="sm"
                    :variant="picking.uploading ? 'ghost' : 'secondary'"
                    :disabled="props.disabled && !picking.uploading"
                    :data-image-cancel="picking.uploading ? '' : undefined"
                    :data-image-upload="picking.uploading ? undefined : ''"
                    @click="picking.uploading ? picking.cancel() : fileInput?.click()"
                >{{ picking.uploading ? text("imageInput.cancelUpload") : text("imageInput.upload") }}</Button>
                <input ref="fileInput" class="hidden" type="file" :accept="IMAGE_ACCEPT" data-image-file @change="onFile">
            </div>
            <!-- 固定大小的方格：候选多少不改变外框的高度。 -->
            <ul class="m-0 grid h-[8.75rem] list-none grid-cols-4 content-start gap-[var(--space-2)] overflow-y-auto p-0" :aria-label="text('imageInput.candidates')" data-image-candidates>
                <li v-for="candidate in picking.candidates ?? []" :key="candidate.path">
                    <button
                        type="button"
                        class="block h-16 w-full overflow-hidden rounded-[var(--radius-control)] border transition-colors [transition-duration:var(--motion-fast)]"
                        :class="candidate.path === path ? 'border-[var(--accent-main)]' : 'border-transparent hover:border-[var(--divider)]'"
                        :aria-label="candidate.name"
                        :aria-pressed="candidate.path === path"
                        :disabled="props.disabled"
                        :data-image-candidate="candidate.path"
                        @click="update({图片: candidate.path, 说明: caption})"
                    >
                        <CanonImage :path="candidate.path" />
                    </button>
                </li>
                <li v-if="picking.uploading" class="flex h-16 items-center justify-center rounded-[var(--radius-control)] bg-[var(--bg-input)] text-[length:var(--text-xs)] text-[var(--text-muted)]" role="status">{{ text("imageInput.uploading") }}</li>
                <li v-else-if="picking.candidates !== null && picking.candidates.length === 0" class="col-span-4 text-[length:var(--text-xs)] text-[var(--text-muted)]">{{ text("imageInput.noCandidates") }}</li>
            </ul>
        </template>
        <Input
            :model-value="path"
            :placeholder="picking !== null ? text('imageInput.manual') : text('imageInput.pathPlaceholder')"
            :aria-label="text('imageInput.path')"
            :invalid="reason !== undefined && picking?.reason !== reason"
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
        <p v-if="reason !== undefined" class="text-[length:var(--text-xs)] text-[var(--status-danger)]" role="alert" data-image-problem>{{ reason }}</p>
        <p v-else-if="picking !== null && picking.notice !== ''" class="text-[length:var(--text-xs)] text-[var(--text-secondary)]" role="status" data-image-notice>{{ picking.notice }}</p>
    </div>
</template>
