<script setup lang="ts">
import {Button, Dialog} from "@notnotype/nb-ui/components";
import {relativeTime} from "../host/format.js";

/** 接管键盘之前的提示与确认；契约见同名 .md。 */
withDefaults(defineProps<{
    open: boolean;
    current: {cols: number; rows: number; known: boolean};
    next: {cols: number; rows: number};
    conflict: {reason: "controlled_elsewhere" | "other_browser"; text: string | null; since: string | null} | null;
    pending?: boolean;
}>(), {pending: false});
const emit = defineEmits<{confirm: []; cancel: []}>();
</script>

<template>
    <Dialog :open="open" :title="conflict ? '别处正在控制这个终端' : '接管键盘'" size="md" :busy="pending" @request-close="emit('cancel')">
        <div class="flex flex-col gap-3">
            <p v-if="conflict?.reason === 'other_browser'">面板的另一个浏览器正在接管它<template v-if="conflict.since">（{{ relativeTime(conflict.since) }}起）</template>。抢过来之后那边回到观看。</p>
            <p v-else-if="conflict">可能有别的程序在控制这个终端<template v-if="conflict.text">（herdr：{{ conflict.text }}）</template>。抢过来之后那边会断开。</p>
            <ul class="flex list-disc flex-col gap-1 pl-5 nbdev-small">
                <li>终端会改成网页的尺寸 {{ next.cols }}×{{ next.rows }}<template v-if="current.known">（现在是 {{ current.cols }}×{{ current.rows }}，释放时改回）</template><template v-else>（读不到现在的尺寸，释放时不改回）</template>，herdr 那边会重排。</li>
                <li>herdr 那边（键盘与其它程序）照样能写进这个终端，两边的输入会混在一起。</li>
                <li>接管期间面板不自动投递通知，会话页的输入框也不用（直接在终端里打）。</li>
                <li>切到别的标签页、关掉页面、断线、15 分钟没有输入，都会自动释放。</li>
            </ul>
        </div>
        <template #footer>
            <div class="flex justify-end gap-2">
                <Button variant="ghost" :disabled="pending" @click="emit('cancel')">取消</Button>
                <Button :variant="conflict ? 'danger' : 'primary'" :loading="pending" @click="emit('confirm')">{{ conflict ? "抢过来" : "接管" }}</Button>
            </div>
        </template>
    </Dialog>
</template>
