<script setup lang="ts">
/**
 * Markdown 展示器（同名 .md；docs/specs/ui/markdown-display.md）：编解码器读入后按 schema 生成页面元素，不建编辑器。语言、
 * 链接的目标分类与诊断出口来自宿主（`useMarkdownHost`），没有提供时用缺省宿主。
 */
import {onBeforeUnmount, onMounted, ref, watch} from "vue";

import {useMarkdownHost} from "../host";
import {markdownViewContext, provideMarkdownText} from "../host/text";
import {defaultMarkdownLanguage} from "../language/syntax";
import type {MarkdownLocale} from "../locale";
import {showsAsChip} from "../targets";
import "./markdown.css";
import type {ResolveAsset} from "./MarkdownImage.vue";
import {DisplayRenderer, schemaFor} from "./renderer";
import type {DisplayActivation} from "./static-views";

// `locale` 只在上面没有注入翻译端口时起作用（`../host/text.ts`）。
const props = withDefaults(defineProps<{text: string; locale?: MarkdownLocale; streaming?: boolean; resolveAsset?: ResolveAsset}>(), {locale: undefined, streaming: false, resolveAsset: undefined});
const emit = defineEmits<{(e: "activate", activation: DisplayActivation): void}>();

const host = useMarkdownHost();
const text = provideMarkdownText(() => props.locale);
// 在 provide 之后取：静态视图里挂的图片要读到这里提供的端口。
const context = markdownViewContext(text);
const report = (event: string, message: string, error: unknown): void => host.report(event, message, error);

const root = ref<HTMLElement | null>(null);
let renderer: DisplayRenderer | null = null;
/** 组不成语言或建不起渲染器时为真：之后只按纯文字显示原文（“失败与恢复”）。 */
let plain = false;
let frame: number | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
/** 上一次读入很慢时，下一次读入不早于这个时刻（`performance.now()`）。 */
let resumeAt = 0;
let cursor: HTMLElement | null = null;

/** 读入超过这么久，下一次读入至少隔同样长：长回复流式时每帧整篇重读，不让它占满主线程（输出 6）。 */
const SLOW_READ_MS = 8;

const placeCursor = (): void => {
    cursor?.remove();
    cursor = null;
    if (!props.streaming || renderer === null || root.value === null) return;
    const target = renderer.lastTextblock() ?? root.value;
    cursor = root.value.ownerDocument.createElement("span");
    cursor.className = "nb-markdown-display__cursor";
    cursor.setAttribute("aria-hidden", "true");
    target.append(cursor);
};

const flush = (): void => {
    frame = null;
    if (plain) {
        if (root.value !== null) {
            root.value.style.whiteSpace = "pre-wrap";
            root.value.textContent = props.text;
        }
        return;
    }
    const started = performance.now();
    renderer?.update(props.text);
    const cost = performance.now() - started;
    resumeAt = cost > SLOW_READ_MS ? performance.now() + cost : 0;
    placeCursor();
};

/** 排下一次读入：同一帧里多次改变只读入最后一次；上一次读入慢时先等一会儿。 */
const schedule = (): void => {
    if (frame !== null || timer !== null || (renderer === null && !plain)) return;
    const wait = resumeAt - performance.now();
    if (wait <= 0) {
        frame = requestAnimationFrame(flush);
        return;
    }
    timer = setTimeout(() => {
        timer = null;
        frame = requestAnimationFrame(flush);
    }, wait);
};

onMounted(() => {
    if (root.value === null) return;
    const document = root.value.ownerDocument;
    try {
        // 挂上时取定语言（docs/specs/workspace/markdown-syntaxes.md 输出 7）。
        const language = host.language?.() ?? defaultMarkdownLanguage();
        renderer = new DisplayRenderer(root.value, language, schemaFor(language), {
            document,
            context,
            text,
            get resolveAsset() {
                return props.resolveAsset;
            },
            resolveSticker: host.stickers,
            chips: host.chips,
            imageMissing: host.imageMissing,
            activate: (activation) => emit("activate", activation),
            report: (message, error) => report("markdown.display.block-failed", message, error),
        });
        flush();
    } catch (error) {
        renderer?.destroy();
        renderer = null;
        plain = true;
        report("markdown.display.failed", "展示器组不成语言，按纯文字显示原文", error);
        flush();
    }
});

watch(() => props.text, schedule);
// 换语言：静态视图里画在普通 DOM 上的文字（小块的悬停提示、HTML 卡片的按钮）是画的时候取的字符串，整篇重画一次。
// 提示块的展开与 HTML 卡片的展开状态随之回到初始。
watch(() => text.locale.value, () => {
    if (renderer === null) return;
    if (frame !== null) cancelAnimationFrame(frame);
    renderer.destroy();
    flush();
});
watch(() => props.streaming, placeCursor);

onBeforeUnmount(() => {
    if (frame !== null) cancelAnimationFrame(frame);
    if (timer !== null) clearTimeout(timer);
    renderer?.destroy();
    renderer = null;
});

/** 点链接与引用小块：交给宿主，不自己跳转（输出 5）。提示块与 `<html>` 块的按钮、图片各自处理。 */
const onClick = (event: MouseEvent): void => {
    const anchor = (event.target as HTMLElement | null)?.closest("a[href]");
    if (anchor === null || anchor === undefined || !root.value?.contains(anchor)) return;
    event.preventDefault();
    const href = anchor.getAttribute("href") ?? "";
    emit("activate", showsAsChip(host.chips.targets.classify(href, null)) ? {kind: "reference", target: href} : {kind: "link", href});
};
</script>

<template>
    <div ref="root" class="nb-markdown nb-markdown-display" data-markdown-display @click="onClick"></div>
</template>

<style scoped>
.nb-markdown-display {
    --markdown-font-size: var(--text-sm);
    --markdown-line-height: 1.7;
    --markdown-block-gap: 8px;
    min-width: 0;
    overflow-wrap: anywhere;
    /* 长对话：看不见的消息不参与排版，拖动改宽度只排看得见的（输出 9）；`auto` 记住上一次显示的高度。 */
    content-visibility: auto;
    contain-intrinsic-size: auto 120px;
}

.nb-markdown-display :deep(.nb-markdown-display__cursor) {
    display: inline-block;
    width: 0.5em;
    height: 1em;
    margin-inline-start: 0.1em;
    vertical-align: text-bottom;
    background: var(--text-main);
    animation: nb-markdown-display-blink 1s steps(1) infinite;
}

@keyframes nb-markdown-display-blink {
    50% {
        opacity: 0;
    }
}

@media (prefers-reduced-motion: reduce) {
    .nb-markdown-display :deep(.nb-markdown-display__cursor) {
        animation: none;
    }
}
</style>
