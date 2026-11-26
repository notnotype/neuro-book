<script setup lang="ts">
/**
 * 第一幕的章节条（同名 .md，w00056 t06 第 7 轮）：纯显示，演到哪、这一段走了多少由页面给。
 * 三版画法共用一套结构：每一段是一个按钮（标题，下面一截线、一粒菱形、一圈进度环），版式差别都在样式里；
 * 书签版的通长金线与书签不属于哪一段，画在整条上。进度写成注册过的自定义属性（`--cr-p` 等），换段、补满、退回时由过渡接上。
 */
import {computed} from "vue";

const props = withDefaults(defineProps<{
    chapters: readonly string[];
    variant?: "ruler" | "diamonds" | "ribbon";
    current: number;
    done: number;
    progress: number;
    status: "playing" | "paused" | "yielded" | "finished";
}>(), {variant: "ruler"});

const emit = defineEmits<{
    (event: "jump", index: number): void;
    (event: "pause"): void;
    (event: "resume"): void;
    (event: "replay"): void;
}>();

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const count = computed(() => Math.max(1, props.chapters.length));

/** 某一段画多满：看过的满，正在演的按进度，其余空。 */
function fill(index: number): number {
    if (index < props.done) return 1;
    return index === props.current ? clamp01(props.progress) : 0;
}

/** 整幕走了多少（书签版的通长金线）。 */
const overall = computed(() => {
    const head = Math.min(props.done, count.value);
    const partial = props.current >= head && props.current < count.value ? clamp01(props.progress) : 0;
    return (head + partial) / count.value;
});

/** 书签停在哪一段的正中：还没开始时在第一段，演完以后在最后一段。 */
const bookmark = computed(() => (Math.min(count.value - 1, Math.max(0, props.current)) + 0.5) / count.value);

const held = computed(() => props.status === "paused" || props.status === "yielded");
</script>

<template>
    <div class="cr" :class="[`cr--${variant}`, {'cr--held': held}]" :data-cr-status="status">
        <div class="cr-body">
            <nav class="cr-track" aria-label="第一幕的章节">
                <ol class="cr-list" :style="{'--cr-count': String(chapters.length)}">
                    <li v-for="(chapter, index) in chapters" :key="index" class="cr-item" :class="{'is-done': index < done, 'is-current': index === current}" :style="{'--cr-p': String(fill(index))}">
                        <button type="button" class="cr-chapter" :aria-current="index === current ? 'step' : undefined" @click="emit('jump', index)">
                            <span class="cr-title">{{ chapter }}</span>
                            <span class="cr-mark" aria-hidden="true">
                                <span class="cr-base"></span>
                                <span class="cr-fill"></span>
                                <span class="cr-tip"></span>
                                <span class="cr-ring"></span>
                                <span class="cr-gem"></span>
                            </span>
                        </button>
                    </li>
                </ol>
                <span v-if="variant === 'ribbon'" class="cr-spine" :style="{'--cr-overall': String(overall), '--cr-at': String(bookmark)}" aria-hidden="true">
                    <span class="cr-spine__fill"></span>
                    <svg class="cr-bookmark" viewBox="0 0 14 26" width="16" height="30">
                        <path d="M0.5,0 H13.5 V25 L7,19.5 L0.5,25 Z" class="cr-bookmark__silk" />
                        <path d="M2.4,0 V22.4 M11.6,0 V22.4" class="cr-bookmark__edge" />
                    </svg>
                </span>
            </nav>

            <div class="cr-controls">
                <Transition name="cr-swap" mode="out-in">
                    <button v-if="status === 'playing'" key="pause" type="button" class="cr-icon" aria-label="暂停" title="暂停" @click="emit('pause')">
                        <span class="i-lucide-pause" aria-hidden="true"></span>
                    </button>
                    <button v-else-if="status === 'paused'" key="resume" type="button" class="cr-icon" aria-label="继续" title="继续" @click="emit('resume')">
                        <span class="i-lucide-play" aria-hidden="true"></span>
                    </button>
                    <button v-else-if="status === 'yielded'" key="yielded" type="button" class="cr-icon cr-icon--resume" @click="emit('resume')">
                        <span class="i-lucide-play" aria-hidden="true"></span>
                        继续演示
                    </button>
                </Transition>
                <button type="button" class="cr-icon" :class="{'cr-icon--lit': status === 'finished'}" aria-label="从头再看" title="从头再看" @click="emit('replay')">
                    <span class="i-lucide-rotate-ccw" aria-hidden="true"></span>
                </button>
            </div>
        </div>
    </div>
</template>

<style scoped>
/* 进度要能过渡（换段、补满、退回时接上），注册成数：没注册的自定义属性只能跳。名字带前缀：@property 是全局的。 */
@property --cr-p {
    syntax: "<number>";
    inherits: true;
    initial-value: 0;
}

@property --cr-overall {
    syntax: "<number>";
    inherits: true;
    initial-value: 0;
}

@property --cr-at {
    syntax: "<number>";
    inherits: true;
    initial-value: 0;
}

/*
 * 颜色缺省是压在暗绒桌布上的夜色：看过的是金，正在演的是亮金，还没到的标题是半透的象牙色、线是暗金。
 * 外面可以在根上覆盖 `--cr-gold`、`--cr-gold-light`、`--cr-dim`、`--cr-ink`（白天的窄屏压在亮石墙上）。
 * 根是尺寸容器：条窄于 560 时标题收紧；不超过 360 时条尾挪到下面一行。
 * `--cr-tail` 是条尾挂在右边时连同空隙最宽要多少（让开以后的“继续演示”加从头再看，量的是 130，加上 18 的空隙与一点余量）：
 * 外面定条宽时两边各留出它，留不出来就把条收到 360 以下，让条尾挪下去，条尾才不会伸出外面的框（写法见同名 .md）。
 */
.cr {
    --cr-tail: 156px;
    --cr-gold: #c99a5b;
    --cr-gold-light: #f0c987;
    --cr-dim: rgb(240 201 135 / 0.3);
    --cr-ink: rgb(247 242 236 / 0.46);
    --cr-glow: rgb(240 201 135 / 0.5);
    --cr-ease: cubic-bezier(0.22, 1, 0.36, 1);
    --cr-serif: "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", "STSong", serif;
    container-type: inline-size;
}

/* 条尾挂在标题那一行的右边、不占它的宽：条尾换成更宽的“继续演示”时，六段不跟着挪。 */
.cr-body {
    position: relative;
}

.cr-track {
    position: relative;
    min-width: 0;
}

.cr-list {
    display: grid;
    grid-template-columns: repeat(var(--cr-count), minmax(0, 1fr));
    margin: 0;
    padding: 0;
    list-style: none;
}

.cr-item {
    transition: --cr-p 420ms var(--cr-ease);
}

.cr-chapter {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 7px;
    width: 100%;
    padding: 2px 0 4px;
    border: 0;
    border-radius: 4px;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
}

.cr-chapter:focus-visible {
    outline: 1.5px solid var(--cr-gold-light);
    outline-offset: 2px;
}

.cr-title {
    display: block;
    overflow: hidden;
    color: var(--cr-ink);
    font-family: var(--cr-serif);
    font-size: 13px;
    letter-spacing: 0.14em;
    text-align: center;
    text-overflow: clip;
    white-space: nowrap;
    transition:
        color 420ms ease,
        text-shadow 420ms ease;
}

.is-done .cr-title {
    color: var(--cr-gold);
}

.is-current .cr-title,
.cr-chapter:hover .cr-title {
    color: var(--cr-gold-light);
}

.is-current .cr-title {
    text-shadow: 0 0 12px var(--cr-glow);
}

.cr-mark {
    position: relative;
    display: block;
    height: 9px;
}

.cr-base,
.cr-fill,
.cr-tip,
.cr-ring,
.cr-gem {
    position: absolute;
    display: block;
}

/* ── 古籍标尺：每格一截底线，右端一粒菱形；正在演的那一格一道亮金光丝往右推，前端一粒微光 ── */

.cr--ruler .cr-base,
.cr--ruler .cr-fill {
    top: 4px;
    right: 6px;
    left: 6px;
    height: 1px;
}

.cr--ruler .cr-base {
    background: repeating-linear-gradient(90deg, var(--cr-dim) 0 3px, transparent 3px 7px);
}

.cr--ruler .is-done .cr-base,
.cr--ruler .is-current .cr-base {
    background: var(--cr-dim);
}

.cr--ruler .cr-fill {
    top: 3.5px;
    height: 2px;
    background: linear-gradient(90deg, var(--cr-gold), var(--cr-gold-light));
    clip-path: inset(0 calc((1 - var(--cr-p)) * 100%) 0 0);
}

.cr--ruler .is-done .cr-fill {
    top: 4px;
    height: 1px;
    background: var(--cr-gold);
}

.cr--ruler .cr-tip {
    top: 4.5px;
    left: calc(6px + (100% - 12px) * var(--cr-p));
    width: 12px;
    height: 12px;
    margin: -6px 0 0 -6px;
    border-radius: 50%;
    background: radial-gradient(circle, #fff7df 0 1.4px, rgb(240 201 135 / 0.75) 2.2px, transparent 70%);
    opacity: 0;
    transition: opacity 300ms ease;
}

.cr--ruler .is-current:not(.is-done) .cr-tip {
    opacity: 1;
    animation: cr-breathe 1.8s ease-in-out infinite alternate;
}

.cr--ruler .cr-gem {
    top: 1px;
    right: -3.5px;
    width: 7px;
    height: 7px;
    border: 1px solid var(--cr-dim);
    transform: rotate(45deg);
    transition:
        background-color 420ms ease,
        border-color 420ms ease,
        box-shadow 420ms ease;
}

.cr--ruler .is-done .cr-gem {
    border-color: var(--cr-gold);
    background: var(--cr-gold);
    box-shadow: 0 0 6px var(--cr-glow);
}

/* 标尺的起点：第一格左端也有一粒，开演以后点亮。 */
.cr--ruler .cr-item:first-child .cr-mark::before {
    position: absolute;
    top: 1px;
    left: -3.5px;
    width: 7px;
    height: 7px;
    border: 1px solid var(--cr-gold);
    content: "";
    transform: rotate(45deg);
    transition: background-color 420ms ease;
}

.cr--ruler .cr-item:first-child.is-done .cr-mark::before,
.cr--ruler .cr-item:first-child.is-current .cr-mark::before {
    background: var(--cr-gold);
}

.cr--ruler .cr-ring {
    display: none;
}

/* ── 菱形与进度环：每段一粒菱形，正在演的那一粒外面一圈细金环按进度画满；菱形之间一条极淡的细线 ── */

.cr--diamonds .cr-mark {
    height: 22px;
}

.cr--diamonds .cr-fill,
.cr--diamonds .cr-tip {
    display: none;
}

.cr--diamonds .cr-base {
    top: 50%;
    right: calc(-50% + 13px);
    left: calc(50% + 13px);
    height: 1px;
    background: var(--cr-dim);
    opacity: 0.55;
}

.cr--diamonds .cr-item:last-child .cr-base {
    display: none;
}

.cr--diamonds .is-done .cr-base {
    background: var(--cr-gold);
    opacity: 0.5;
}

.cr--diamonds .cr-gem {
    top: 50%;
    left: 50%;
    width: 8px;
    height: 8px;
    margin: -4px 0 0 -4px;
    border: 1px solid var(--cr-dim);
    transform: rotate(45deg);
    transition:
        background-color 420ms ease,
        border-color 420ms ease,
        box-shadow 420ms ease,
        transform 420ms var(--cr-ease);
}

.cr--diamonds .is-done .cr-gem {
    border-color: var(--cr-gold);
    background: var(--cr-gold);
}

.cr--diamonds .is-current .cr-gem {
    border-color: var(--cr-gold-light);
    background: var(--cr-gold-light);
    box-shadow: 0 0 8px var(--cr-glow);
    transform: rotate(45deg) scale(1.12);
}

.cr--diamonds .cr-ring {
    top: 50%;
    left: 50%;
    width: 22px;
    height: 22px;
    margin: -11px 0 0 -11px;
    border-radius: 50%;
    background: conic-gradient(var(--cr-gold-light) calc(var(--cr-p) * 1turn), rgb(240 201 135 / 0.14) 0);
    opacity: 0;
    transition: opacity 300ms ease;
    mask: radial-gradient(farthest-side, transparent calc(100% - 1.6px), #000 calc(100% - 1.3px));
}

.cr--diamonds .is-current:not(.is-done) .cr-ring {
    opacity: 1;
}

/* ── 赤红书签：标题下一条通长金线按整幕的进度填满，书签挂在正在演的标题下面，换段时滑过去 ── */

.cr--ribbon {
    padding-bottom: 18px;
}

.cr--ribbon .cr-mark {
    height: 6px;
}

.cr--ribbon .cr-base,
.cr--ribbon .cr-fill,
.cr--ribbon .cr-tip,
.cr--ribbon .cr-ring,
.cr--ribbon .cr-gem {
    display: none;
}

.cr-spine {
    position: absolute;
    right: 0;
    bottom: 6px;
    left: 0;
    height: 1px;
    background: var(--cr-dim);
    transition:
        --cr-overall 700ms var(--cr-ease),
        --cr-at 700ms var(--cr-ease);
    pointer-events: none;
}

.cr-spine__fill {
    position: absolute;
    inset: -0.5px 0;
    background: linear-gradient(90deg, var(--cr-gold), var(--cr-gold-light));
    clip-path: inset(0 calc((1 - var(--cr-overall)) * 100%) 0 0);
}

.cr-bookmark {
    position: absolute;
    top: -3px;
    left: calc(var(--cr-at) * 100%);
    display: block;
    margin-left: -8px;
    overflow: visible;
    filter: drop-shadow(0 3px 4px rgb(0 0 0 / 0.45));
}

.cr-bookmark__silk {
    fill: #8c1626;
}

.cr-bookmark__edge {
    fill: none;
    stroke: var(--cr-gold-light);
    stroke-width: 0.8;
    stroke-opacity: 0.85;
}

/* ── 停下：光丝定格、压暗，光点熄掉 ── */

.cr--held .is-current .cr-fill,
.cr--held .is-current .cr-ring,
.cr--held .cr-spine__fill {
    filter: saturate(0.45) brightness(0.62);
}

.cr--held .cr-tip {
    opacity: 0 !important;
    animation: none !important;
}

/* ── 条尾的两个细线图标；访客动过工作台时暂停键换成亮一些的“继续演示” ── */

.cr-controls {
    position: absolute;
    top: 50%;
    left: calc(100% + 18px);
    display: flex;
    align-items: center;
    gap: 6px;
    transform: translateY(-50%);
}

.cr-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 26px;
    height: 26px;
    padding: 0;
    border: 1px solid rgb(240 201 135 / 0.24);
    border-radius: 999px;
    background: rgb(20 10 14 / 0.3);
    color: rgb(240 201 135 / 0.6);
    font-family: var(--cr-serif);
    font-size: 12.5px;
    letter-spacing: 0.1em;
    white-space: nowrap;
    cursor: pointer;
    transition:
        color 200ms ease,
        border-color 200ms ease,
        box-shadow 200ms ease;
}

.cr-icon:hover {
    border-color: rgb(240 201 135 / 0.55);
    color: var(--cr-gold-light);
}

.cr-icon:focus-visible {
    outline: 1.5px solid var(--cr-gold-light);
    outline-offset: 2px;
}

.cr-icon span {
    width: 12px;
    height: 12px;
}

.cr-icon--resume {
    padding: 0 13px 0 10px;
    border-color: rgb(240 201 135 / 0.62);
    color: var(--cr-gold-light);
    animation: cr-call 2.6s ease-in-out infinite alternate;
}

.cr-icon--lit {
    border-color: rgb(240 201 135 / 0.5);
    color: var(--cr-gold-light);
}

.cr-swap-enter-active,
.cr-swap-leave-active {
    transition:
        opacity 220ms ease,
        transform 260ms var(--cr-ease);
}

.cr-swap-enter-from,
.cr-swap-leave-to {
    opacity: 0;
    transform: scale(0.86);
}

@keyframes cr-breathe {
    from {
        transform: scale(0.8);
        opacity: 0.75;
    }
    to {
        transform: scale(1.1);
        opacity: 1;
    }
}

@keyframes cr-call {
    from {
        box-shadow: 0 0 0 rgb(240 201 135 / 0);
    }
    to {
        box-shadow: 0 0 16px rgb(240 201 135 / 0.32);
    }
}

@container (max-width: 560px) {
    .cr-title {
        font-size: 11.5px;
        letter-spacing: 0.04em;
    }
}

@container (max-width: 360px) {
    .cr-controls {
        position: static;
        justify-content: center;
        margin-top: 8px;
        transform: none;
    }
}

@media (prefers-reduced-motion: reduce) {
    .cr-item,
    .cr-spine {
        transition: none;
    }

    .cr-tip,
    .cr-icon--resume {
        animation: none !important;
    }
}
</style>
