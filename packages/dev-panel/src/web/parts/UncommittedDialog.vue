<script setup lang="ts">
import {Button, Dialog} from "@notnotype/nb-ui/components";
import type {UncommittedChanges} from "../host/types.js";
import DiffView from "./DiffView.vue";

/**
 * 目标文件在主工作区有别人没提交的改动时的确认：已暂存的与工作区里的分两段显示（`git add` 会用工作区的内容替换暂存的那一份），
 * 选“连同这些改动一起提交”才放行（待决问题 8）。这些改动会以面板的名义进 master。
 */
defineProps<{open: boolean; path: string; changes: UncommittedChanges | null; pending: boolean}>();
const emit = defineEmits<{confirm: []; cancel: []}>();
</script>

<template>
    <Dialog :open="open" title="这个文件有别人没提交的改动" size="lg" :busy="pending" @request-close="emit('cancel')">
        <div v-if="changes" class="flex flex-col gap-3">
            <p><code>{{ path }}</code>（{{ changes.status.join("、") }}）</p>
            <p class="nbdev-note">路径限定的提交会把这些改动和你的这次改动一起提交进 master，提交作者是主工作区的 Git 身份。拿不准是谁改的，就先取消、在终端问清楚。</p>
            <p v-if="changes.untracked">这个文件还没入库（未跟踪），整份内容会随这次提交入库。</p>
            <section v-if="changes.staged" class="flex flex-col gap-1">
                <h3 class="font-semibold">已暂存的改动</h3>
                <DiffView :text="changes.staged" />
            </section>
            <section v-if="changes.unstaged" class="flex flex-col gap-1">
                <h3 class="font-semibold">工作区里还没暂存的改动</h3>
                <DiffView :text="changes.unstaged" />
            </section>
        </div>
        <template #footer>
            <div class="flex justify-end gap-2">
                <Button variant="ghost" :disabled="pending" @click="emit('cancel')">取消</Button>
                <Button variant="danger" :loading="pending" @click="emit('confirm')">连同这些改动一起提交</Button>
            </div>
        </template>
    </Dialog>
</template>
