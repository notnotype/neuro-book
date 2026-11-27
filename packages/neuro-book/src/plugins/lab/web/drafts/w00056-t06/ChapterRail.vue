<script setup lang="ts">
/**
 * 一幕的章节条（同名 .md，w00056 t06 第 7 轮出了三版，第 8 轮开发者选定古籍标尺；第 13 轮第二幕也用它）：纯显示，演到哪、这一段走了多少由页面给。
 * 每一段是一个按钮：标题，下面一截底线与光丝、右端一粒菱形。进度写成注册过的自定义属性（`--cr-p`），换段、补满、退回时由过渡接上。
 * 换了一组章节（换幕）时整行按新的一组重挂，几段从左往右依次亮出来。
 */
import {computed} from "vue";

const props = withDefaults(defineProps<{
    chapters: readonly string[];
    current: number;
    done: number;
    progress: number;
    status: "playing" | "paused" | "yielded" | "finished";
    /** 读屏念的名字（“第一幕的章节”）。 */
    label?: string;
}>(), {label: "章节"});

const emit = defineEmits<{
    (event: "jump", index: number): void;
    (event: "pause"): void;
    (event: "resume"): void;
    (event: "replay"): void;
}>();

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** 某一段画多满：看过的满，正在演的按进度，其余空。 */
function fill(index: number): number {
    if (index < props.done) return 1;
    return index === props.current ? clamp01(props.progress) : 0;
}

const held = computed(() => props.status === "paused" || props.status === "yielded");
</script>

<template>
    <div class="cr" :class="{'cr--held': held}" :data-cr-status="status">
        <div class="cr-body">
            <nav class="cr-track" :aria-label="label">
                <ol :key="chapters.join('/')" class="cr-list" :style="{'--cr-count': String(chapters.length)}">
                    <li v-for="(chapter, index) in chapters" :key="index" class="cr-item" :class="{'is-done': index < done, 'is-current': index === current}" :style="{'--cr-p': String(fill(index)), '--cr-i': String(index)}">
                        <button type="button" class="cr-chapter" :aria-current="index === current ? 'step' : undefined" @click="emit('jump', index)">
                            <span class="cr-title">{{ chapter }}</span>
                            <span class="cr-mark" aria-hidden="true">
                                <span class="cr-base"></span>
                                <span class="cr-fill"></span>
                                <span class="cr-tip"></span>
                                <span class="cr-gem"></span>
                            </span>
                        </button>
                    </li>
                </ol>
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

/*
 * 颜色缺省是压在暗绒桌布上的夜色：看过的是金，正在演的是亮金，还没到的标题是半透的象牙色、线是暗金。
 * 外面可以在根上覆盖 `--cr-gold`、`--cr-gold-light`、`--cr-dim`、`--cr-ink`、`--cr-glow`、`--cr-plate`、`--cr-tip-core`（白天压在亮的桌布与石墙上）。
 * 条尾按钮的边与字从 `--cr-gold-light` 调出来，跟着一起换。
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
    /* 条尾按钮的底：夜里是压在暗绒上的一点暗，白天的宿主换成亮一些的纸色。 */
    --cr-plate: rgb(20 10 14 / 0.3);
    /* 光丝前端那粒微光的芯：夜里是近白的金，白天换成深铜才看得见。 */
    --cr-tip-core: #fff7df;
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
    animation: cr-enter 360ms var(--cr-ease) calc(var(--cr-i) * 70ms) both;
}

/* 一组章节挂上来时（第一次显出、换幕）：从左往右依次浮上来，五段约 0.65 秒走完（@designer 第 12 轮：章节条依次点亮）。 */
@keyframes cr-enter {
    from {
        opacity: 0;
        transform: translateY(4px);
    }
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
.cr-gem {
    position: absolute;
    display: block;
}

/* ── 古籍标尺：每格一截底线，右端一粒菱形；正在演的那一格一道亮金光丝往右推，前端一粒微光（@designer 第 7 轮） ── */

.cr-base,
.cr-fill {
    top: 4px;
    right: 6px;
    left: 6px;
    height: 1px;
}

.cr-base {
    background: repeating-linear-gradient(90deg, var(--cr-dim) 0 3px, transparent 3px 7px);
}

.is-done .cr-base,
.is-current .cr-base {
    background: var(--cr-dim);
}

.cr-fill {
    top: 3.5px;
    height: 2px;
    background: linear-gradient(90deg, var(--cr-gold), var(--cr-gold-light));
    clip-path: inset(0 calc((1 - var(--cr-p)) * 100%) 0 0);
}

.is-done .cr-fill {
    top: 4px;
    height: 1px;
    background: var(--cr-gold);
}

.cr-tip {
    top: 4.5px;
    left: calc(6px + (100% - 12px) * var(--cr-p));
    width: 12px;
    height: 12px;
    margin: -6px 0 0 -6px;
    border-radius: 50%;
    background: radial-gradient(circle, var(--cr-tip-core) 0 1.4px, color-mix(in srgb, var(--cr-gold-light) 75%, transparent) 2.2px, transparent 70%);
    opacity: 0;
    transition: opacity 300ms ease;
}

.is-current:not(.is-done) .cr-tip {
    opacity: 1;
    animation: cr-breathe 1.8s ease-in-out infinite alternate;
}

.cr-gem {
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

.is-done .cr-gem {
    border-color: var(--cr-gold);
    background: var(--cr-gold);
    box-shadow: 0 0 6px var(--cr-glow);
}

/* 标尺的起点：第一格左端也有一粒，开演以后点亮。 */
.cr-item:first-child .cr-mark::before {
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

.cr-item:first-child.is-done .cr-mark::before,
.cr-item:first-child.is-current .cr-mark::before {
    background: var(--cr-gold);
}

/* ── 停下：光丝定格、压暗，光点熄掉 ── */

.cr--held .is-current .cr-fill {
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
    border: 1px solid color-mix(in srgb, var(--cr-gold-light) 24%, transparent);
    border-radius: 999px;
    background: var(--cr-plate);
    color: color-mix(in srgb, var(--cr-gold-light) 62%, transparent);
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
    border-color: color-mix(in srgb, var(--cr-gold-light) 55%, transparent);
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
    border-color: color-mix(in srgb, var(--cr-gold-light) 62%, transparent);
    color: var(--cr-gold-light);
    animation: cr-call 2.6s ease-in-out infinite alternate;
}

.cr-icon--lit {
    border-color: color-mix(in srgb, var(--cr-gold-light) 50%, transparent);
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
        box-shadow: 0 0 0 transparent;
    }
    to {
        box-shadow: 0 0 16px var(--cr-glow);
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
    .cr-item {
        transition: none;
        animation: none;
    }

    .cr-tip,
    .cr-icon--resume {
        animation: none !important;
    }
}
</style>
