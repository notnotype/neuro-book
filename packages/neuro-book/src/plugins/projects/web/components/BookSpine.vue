<script setup lang="ts">
/** 书脊（同名 .md）：竖排书名、厚度与颜色；选项语义，交互归 SpineShelf。 */
import {computed} from "vue";

defineOptions({name: "BookSpine"});

const props = defineProps<{
    id: string;
    title: string;
    width: number;
    height: number;
    hue: number;
    color: string | null;
    active: boolean;
    running: boolean;
    runningLabel: string;
}>();

/** 作者给的颜色按相对亮度选文字的深浅；生成的色档明度固定，文字总是浅色。 */
const darkInk = computed(() => {
    if (props.color === null) return false;
    const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(props.color);
    if (match === null) return false;
    const [r, g, b] = match.slice(1).map((part) => {
        const channel = Number.parseInt(part, 16) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4;
});

const style = computed(() => ({
    "--spine-w": `${String(props.width)}px`,
    "--spine-h": `${String(props.height)}px`,
    "--spine-hue": String(props.hue),
    ...(props.color === null ? {} : {"--spine-color": props.color}),
}));
</script>

<template>
    <div
        :id="id"
        role="option"
        :aria-selected="active"
        class="book-spine shelf-spine-color"
        :class="{'book-spine--active': active, 'shelf-spine-color--custom': color !== null, 'book-spine--dark-ink': darkInk}"
        :style="style"
        data-book-spine
    >
        <span class="book-spine__title">{{ title }}</span>
        <span v-if="running" class="book-spine__running" :title="runningLabel" :aria-label="runningLabel" />
    </div>
</template>

<style src="./shelf-colors.css"></style>

<style scoped>
.book-spine {
    --spine-ink: oklch(from var(--spine-bg) 0.96 0.015 h);
    position: relative;
    display: flex;
    flex: 0 0 auto;
    align-items: flex-start;
    justify-content: center;
    width: var(--spine-w);
    height: var(--spine-h);
    padding: 22px 0 26px;
    border-radius: 3px 3px 2px 2px;
    background: var(--spine-bg);
    color: var(--spine-ink);
    cursor: pointer;
    transition: transform var(--motion-fast) var(--ease-standard), box-shadow var(--motion-fast) var(--ease-standard);
    /* 装订线：上下各一道，用文字色的低透明度，换配色也成立。最后一层是书脊的圆度：左右两边略暗、偏左一道亮，是光不是颜色。 */
    background-image:
        linear-gradient(to bottom, transparent 10px, color-mix(in oklch, var(--spine-ink) 32%, transparent) 10px 11px, transparent 11px),
        linear-gradient(to top, transparent 12px, color-mix(in oklch, var(--spine-ink) 32%, transparent) 12px 13px, transparent 13px),
        linear-gradient(to right, rgb(0 0 0 / 0.16), transparent 18%, rgb(255 255 255 / 0.08) 38%, transparent 62%, rgb(0 0 0 / 0.14));
    box-shadow: inset -1px 0 0 color-mix(in oklch, var(--spine-ink) 14%, transparent), inset 1px 0 0 color-mix(in oklch, black 16%, transparent);
}

.book-spine--dark-ink {
    --spine-ink: oklch(from var(--spine-bg) 0.22 0.02 h);
}

.book-spine:hover {
    transform: translateY(-4px);
}

.book-spine--active {
    transform: translateY(-10px);
    box-shadow: var(--elevation-raised);
}

.book-spine--active:hover {
    transform: translateY(-10px);
}

.book-spine__title {
    overflow: hidden;
    max-height: 100%;
    font-family: var(--font-display);
    font-size: 15px;
    line-height: 1.1;
    letter-spacing: 0.12em;
    white-space: nowrap;
    text-overflow: ellipsis;
    writing-mode: vertical-rl;
}

.book-spine__running {
    position: absolute;
    bottom: 5px;
    left: 50%;
    width: 5px;
    height: 5px;
    border-radius: 999px;
    background: var(--spine-ink);
    transform: translateX(-50%);
}

@media (prefers-reduced-motion: reduce) {
    .book-spine,
    .book-spine:hover,
    .book-spine--active,
    .book-spine--active:hover {
        transform: none;
        transition: none;
    }
}
</style>
