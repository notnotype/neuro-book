<script setup lang="ts">
import {Tooltip} from "@notnotype/nb-ui/components";
import {computed} from "vue";
import {TITLE_SOURCE, type SessionName} from "../host/format.js";
import {isPlainClick} from "../host/routes.js";
import SessionLabel from "./SessionLabel.vue";

/** 一份租约（谁在动）的虚线胶囊；给了 `href` 就是去会话页的链接。契约见同名 .md。 */
const props = withDefaults(defineProps<{session: SessionName; task?: string | null; stale?: boolean; ended?: boolean; hint?: string; compact?: boolean; href?: string | null}>(), {task: null, stale: false, ended: false, hint: "", compact: false, href: null});
const emit = defineEmits<{navigate: [href: string]}>();
/** 提示：调用方的说明在前，有标题时补上完整标题与它从哪里读的（标题可能被截断，`compact` 时根本不显示）。 */
const tip = computed(() => {
    const {title, source} = props.session;
    const titleNote = title && source ? `${title}（标题取自 ${TITLE_SOURCE[source]}）` : "";
    return [props.hint, titleNote].filter((part) => part !== "").join("；");
});
function follow(event: MouseEvent): void {
    if (!props.href || !isPlainClick(event)) return;
    event.preventDefault();
    emit("navigate", props.href);
}
</script>

<template>
    <Tooltip :text="tip" :disabled="tip === ''">
        <!-- 有地方可去才是链接（能聚焦）；没有时只是一段字，不再为了看提示而单独占一个 Tab 停靠点（t22）。 -->
        <component
            :is="href ? 'a' : 'span'"
            :href="href ?? undefined"
            class="nbdev-note inline-flex max-w-full items-center gap-1 rounded-full border border-dashed border-[var(--status-info,var(--accent-main))] px-2 py-0.5"
            :class="{'hover:underline': href}"
            @click="follow"
        >
            <span class="i-lucide-user-round size-3 shrink-0" aria-hidden="true" />
            <span v-if="compact" class="whitespace-nowrap" :class="{'line-through': ended}">{{ session.short }}</span>
            <!-- 完整标题在胶囊自己的提示里，标题这里只截断，不再套一层提示。 -->
            <SessionLabel v-else :class="{'line-through': ended}" :session="session" :full-text="false" />
            <span v-if="task" class="shrink-0 nbdev-secondary">· {{ task }}</span>
            <!-- 过期、失效写成看得见的字，不只靠变淡与删除线（t22）。 -->
            <span v-if="ended" class="shrink-0 nbdev-secondary">· 已失效</span>
            <span v-else-if="stale" class="shrink-0 nbdev-secondary">· 过期</span>
        </component>
    </Tooltip>
</template>
