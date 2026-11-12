<script setup lang="ts">
import {ref} from "vue";

/** 产物的原页：沙箱 iframe 加一行“页面是当前版本”的说明。产物页与 Task 页的速览面板共用。契约见同名 .md。 */
withDefaults(defineProps<{src: string; title: string; note?: string | null}>(), {note: "页面是当前版本（磁盘上的）"});
const frame = ref<HTMLIFrameElement | null>(null);
/** iframe 的窗口：产物页拿它和页面里的答题控件对话（t23），只收它发来的消息。 */
defineExpose({contentWindow: (): Window | null => frame.value?.contentWindow ?? null});
</script>

<template>
    <section class="nbdev-stack-tight flex min-h-0 min-w-0 flex-1 flex-col">
        <p v-if="note" class="nbdev-note flex flex-wrap items-center gap-1.5">
            <span class="i-lucide-info size-3.5" aria-hidden="true" />{{ note }}
        </p>
        <!-- 产物页按亮色画、多半没有自己的底色：iframe 定死亮色并垫白底，理由见同名 .md。 -->
        <iframe ref="frame" :src="src" sandbox="allow-scripts allow-forms allow-popups" referrerpolicy="no-referrer" class="min-h-0 w-full flex-1 rounded-[var(--radius-panel)] border border-[var(--divider)]" style="color-scheme: light; background: #fff" :title="title" />
    </section>
</template>
