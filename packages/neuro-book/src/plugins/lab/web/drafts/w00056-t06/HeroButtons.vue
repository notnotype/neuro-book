<script setup lang="ts">
/**
 * 首页按钮的几版样式（同名 .md，w00056 t06 第 6 轮）：四版各一行，夜与昼各一格。只是给开发者挑的样张，按钮不跳转。
 * 颜色与首页同一套：赤红 #871222 系给主按钮，鎏金渐变给线，夜里的字是象牙色，白天是深墨。
 */
import NeuroBookMark from "nbook/ui/brand/NeuroBookMark.vue";

const VARIANTS = [
    {id: "a", name: "A 双线金边", note: "现版精修"},
    {id: "b", name: "B 皮面烫金", note: "四角角花，金字"},
    {id: "c", name: "C 书脊签", note: "修长签条，单金框"},
    {id: "d", name: "D 封蜡", note: "羊皮纸签条，火漆印"},
] as const;
const SCENES = [
    {id: "night", name: "夜"},
    {id: "day", name: "昼"},
] as const;
</script>

<template>
    <div class="hb">
        <div class="hb-head" aria-hidden="true">
            <span></span>
            <span v-for="scene in SCENES" :key="scene.id" class="hb-head__scene">{{ scene.name }}</span>
        </div>
        <section v-for="variant in VARIANTS" :key="variant.id" class="hb-row" :data-hb-variant="variant.id">
            <div class="hb-row__label">
                <p class="hb-row__name">{{ variant.name }}</p>
                <p class="hb-row__note">{{ variant.note }}</p>
            </div>
            <div v-for="scene in SCENES" :key="scene.id" class="hb-cell" :class="`hb-cell--${scene.id}`">
                <a href="#" class="hb-cta hb-cta--primary" :class="`hb-cta--${variant.id}`" @click.prevent>
                    <span v-if="variant.id === 'd'" class="hb-seal" aria-hidden="true"><NeuroBookMark decorative class="hb-seal__mark" /></span>
                    <template v-if="variant.id === 'b'">
                        <i class="hb-corner hb-corner--tl" aria-hidden="true"></i>
                        <i class="hb-corner hb-corner--tr" aria-hidden="true"></i>
                        <i class="hb-corner hb-corner--br" aria-hidden="true"></i>
                        <i class="hb-corner hb-corner--bl" aria-hidden="true"></i>
                    </template>
                    <span class="hb-cta__text">下载 NeuroBook</span>
                </a>
                <a href="#" class="hb-cta" :class="`hb-cta--${variant.id}`" @click.prevent>
                    <template v-if="variant.id === 'b'">
                        <i class="hb-corner hb-corner--tl" aria-hidden="true"></i>
                        <i class="hb-corner hb-corner--tr" aria-hidden="true"></i>
                        <i class="hb-corner hb-corner--br" aria-hidden="true"></i>
                        <i class="hb-corner hb-corner--bl" aria-hidden="true"></i>
                    </template>
                    <span class="hb-cta__text">在 GitHub 上看看</span>
                </a>
            </div>
        </section>
    </div>
</template>

<style scoped>
.hb {
    --hb-gilt: linear-gradient(135deg, #fff1c8 0%, #e2b866 22%, #8a5c1c 48%, #f2d491 70%, #a8762f 100%);
    --hb-gold: #e8c27a;
    --hb-crimson: #871222;
    --hb-ease: cubic-bezier(0.22, 1, 0.36, 1);
    --hb-serif: "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", "STSong", serif;
    display: grid;
    gap: 14px;
    min-height: 100%;
    padding: 28px;
    /* 按自己的宽度换版式（Lab 的画布比浏览器窗口窄，媒体查询量的是窗口）。 */
    container-type: inline-size;
    background: #2a2420;
    color: #efe6d6;
    font-family: var(--font-ui);
}

.hb-head,
.hb-row {
    display: grid;
    grid-template-columns: 150px repeat(2, minmax(0, 1fr));
    gap: 14px;
    align-items: stretch;
}

.hb-head__scene {
    color: rgb(239 230 214 / 0.6);
    font-size: 13px;
    text-align: center;
}

.hb-row__label {
    align-self: center;
}

.hb-row__name {
    margin: 0;
    font-family: var(--hb-serif);
    font-size: 16px;
    font-weight: 600;
}

.hb-row__note {
    margin: 4px 0 0;
    color: rgb(239 230 214 / 0.6);
    font-size: 12.5px;
}

.hb-cell {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 30px 20px;
    border-radius: 10px;
}

/* 两种底：夜是首页暗夜圣殿的底，昼是午后抄经室的石墙。 */
.hb-cell--night {
    background:
        radial-gradient(70% 90% at 50% 0%, rgb(74 38 58 / 0.55), transparent 70%),
        #160e12;
}

.hb-cell--day {
    background:
        radial-gradient(70% 90% at 20% 0%, rgb(255 247 226 / 0.7), transparent 70%),
        #c3b59c;
}

/* ── 共用：衬线字、字距，受光的微变与按下的下沉 ── */

.hb-cta {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    height: 48px;
    padding: 0 30px;
    border: 1px solid transparent;
    font-family: var(--hb-serif);
    font-size: 15px;
    letter-spacing: 0.14em;
    text-decoration: none;
    white-space: nowrap;
    cursor: pointer;
    transition:
        transform 160ms var(--hb-ease),
        box-shadow 260ms var(--hb-ease),
        filter 260ms var(--hb-ease),
        background-color 260ms var(--hb-ease);
}

.hb-cta:active {
    transform: translateY(1px);
}

.hb-cta:focus-visible {
    outline: 2px solid var(--hb-gold);
    outline-offset: 4px;
}

.hb-cta__text {
    position: relative;
}

/* ── A 双线金边：外一道鎏金边、里一道细金线，两端金菱形压在边线上 ── */

.hb-cta--a {
    border-radius: 4px;
    background:
        linear-gradient(rgb(24 15 19 / 0.7), rgb(24 15 19 / 0.7)) padding-box,
        var(--hb-gilt) border-box;
    box-shadow:
        inset 0 0 0 3px rgb(14 8 10 / 0.55),
        inset 0 0 0 4px rgb(240 201 135 / 0.32),
        0 10px 26px rgb(0 0 0 / 0.34);
    color: #f3e6cc;
}

.hb-cta--a::before,
.hb-cta--a::after {
    position: absolute;
    top: 50%;
    width: 8px;
    height: 8px;
    content: "";
    background: var(--hb-gilt);
    box-shadow: 0 0 6px rgb(240 201 135 / 0.45);
    transform: translateY(-50%) rotate(45deg);
    transition: transform 260ms var(--hb-ease), box-shadow 260ms var(--hb-ease);
}

.hb-cta--a::before {
    left: -4.5px;
}

.hb-cta--a::after {
    right: -4.5px;
}

.hb-cta--a.hb-cta--primary {
    background:
        linear-gradient(180deg, #a01d31, #6c0e1c) padding-box,
        var(--hb-gilt) border-box;
    color: #fff3dc;
}

.hb-cta--a:hover {
    box-shadow:
        inset 0 0 0 3px rgb(14 8 10 / 0.5),
        inset 0 0 0 4px rgb(240 201 135 / 0.62),
        0 0 20px rgb(240 201 135 / 0.24),
        0 10px 26px rgb(0 0 0 / 0.34);
}

.hb-cta--a:hover::before,
.hb-cta--a:hover::after {
    box-shadow: 0 0 10px rgb(240 201 135 / 0.7);
    transform: translateY(-50%) rotate(45deg) scale(1.18);
}

.hb-cta--a.hb-cta--primary:hover {
    background:
        linear-gradient(180deg, #b0263a, #7a1222) padding-box,
        var(--hb-gilt) border-box;
}

.hb-cell--day .hb-cta--a:not(.hb-cta--primary) {
    background:
        linear-gradient(rgb(250 244 232 / 0.9), rgb(250 244 232 / 0.9)) padding-box,
        var(--hb-gilt) border-box;
    box-shadow:
        inset 0 0 0 3px rgb(255 251 242 / 0.7),
        inset 0 0 0 4px rgb(168 118 47 / 0.4),
        0 8px 20px rgb(64 38 18 / 0.18);
    color: #3b2614;
}

/* ── B 皮面烫金：哑光深红皮面，一圈烫金细框，四角角花 ── */

.hb-cta--b {
    padding: 0 28px;
    border-radius: 3px;
    background: transparent;
    color: #f3e6cc;
}

.hb-cta--b.hb-cta--primary {
    background: radial-gradient(130% 160% at 30% 10%, #8e1828, #5e0c18 58%, #3e0610);
    box-shadow:
        inset 0 1px 0 rgb(255 222 200 / 0.16),
        inset 0 -2px 6px rgb(0 0 0 / 0.35),
        0 10px 26px rgb(0 0 0 / 0.36);
}

.hb-cta--b.hb-cta--primary .hb-cta__text {
    background: linear-gradient(180deg, #fff1c8, #e2b866 55%, #b8883e);
    background-clip: text;
    color: transparent;
    font-weight: 600;
}

/* 烫金的细框：直角，用渐变的边框图（圆角时 border-image 不跟着弯）。 */
.hb-cta--b::before {
    position: absolute;
    inset: 5px;
    content: "";
    border: 1px solid transparent;
    border-image: var(--hb-gilt) 1;
    opacity: 0.85;
    transition: inset 260ms var(--hb-ease), opacity 260ms var(--hb-ease);
}

.hb-cta--b:not(.hb-cta--primary)::before {
    inset: 0;
}

.hb-corner {
    position: absolute;
    width: 11px;
    height: 11px;
    background: no-repeat center / contain url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M1 11V4.5Q1 1 4.5 1H11' fill='none' stroke='%23e8c27a' stroke-width='1.2'/%3E%3Ccircle cx='4.2' cy='4.2' r='1.3' fill='%23e8c27a'/%3E%3C/svg%3E");
    transition: transform 260ms var(--hb-ease);
}

.hb-cta--primary .hb-corner--tl {
    top: 2px;
    left: 2px;
}

.hb-cta--primary .hb-corner--tr {
    top: 2px;
    right: 2px;
    transform: rotate(90deg);
}

.hb-cta--primary .hb-corner--br {
    right: 2px;
    bottom: 2px;
    transform: rotate(180deg);
}

.hb-cta--primary .hb-corner--bl {
    bottom: 2px;
    left: 2px;
    transform: rotate(270deg);
}

.hb-cta--b:not(.hb-cta--primary) .hb-corner--tl {
    top: -3px;
    left: -3px;
}

.hb-cta--b:not(.hb-cta--primary) .hb-corner--tr {
    top: -3px;
    right: -3px;
    transform: rotate(90deg);
}

.hb-cta--b:not(.hb-cta--primary) .hb-corner--br {
    right: -3px;
    bottom: -3px;
    transform: rotate(180deg);
}

.hb-cta--b:not(.hb-cta--primary) .hb-corner--bl {
    bottom: -3px;
    left: -3px;
    transform: rotate(270deg);
}

.hb-cta--b:hover::before {
    inset: 4px;
    opacity: 1;
}

.hb-cta--b:not(.hb-cta--primary):hover::before {
    inset: -1px;
}

.hb-cta--b.hb-cta--primary:hover {
    background: radial-gradient(130% 160% at 30% 10%, #9c1d2e, #66101c 58%, #420812);
    box-shadow:
        inset 0 1px 0 rgb(255 222 200 / 0.2),
        inset 0 -2px 6px rgb(0 0 0 / 0.35),
        0 0 20px rgb(240 201 135 / 0.2),
        0 10px 26px rgb(0 0 0 / 0.36);
}

.hb-cell--day .hb-cta--b:not(.hb-cta--primary) {
    color: #3b2614;
}

.hb-cell--day .hb-cta--b.hb-cta--primary {
    box-shadow:
        inset 0 1px 0 rgb(255 222 200 / 0.16),
        inset 0 -2px 6px rgb(0 0 0 / 0.3),
        0 8px 20px rgb(64 38 18 / 0.26);
}

/* ── C 书脊签：修长的赤红签条，极细单金框，字两侧各一小段金线 ── */

.hb-cta--c {
    height: 44px;
    padding: 0 22px;
    border-radius: 2px;
    background:
        linear-gradient(rgb(24 15 19 / 0.92), rgb(24 15 19 / 0.92)) padding-box,
        var(--hb-gilt) border-box;
    color: var(--hb-gold);
    letter-spacing: 0.2em;
}

.hb-cta--c.hb-cta--primary {
    background: linear-gradient(180deg, #961a2d, #66101c);
    box-shadow:
        inset 0 0 0 3px #66101c,
        inset 0 0 0 4px rgb(232 194 122 / 0.75),
        0 10px 24px rgb(0 0 0 / 0.34);
    color: #fff1d6;
}

/* 字两侧的金线用实色：渐变在 1px 高的线上一亮一暗，看着像两段虚线。 */
.hb-cta--c.hb-cta--primary::before,
.hb-cta--c.hb-cta--primary::after {
    width: 16px;
    height: 1px;
    content: "";
    background: #e8c27a;
    opacity: 0.9;
    transition: width 260ms var(--hb-ease);
}

.hb-cta--c.hb-cta--primary::before {
    order: -1;
}

.hb-cta--c:hover {
    filter: brightness(1.08);
}

.hb-cta--c.hb-cta--primary:hover::before,
.hb-cta--c.hb-cta--primary:hover::after {
    width: 20px;
}

.hb-cta--c.hb-cta--primary:hover {
    box-shadow:
        inset 0 0 0 3px #6e121f,
        inset 0 0 0 4px rgb(240 210 150 / 0.95),
        0 0 18px rgb(240 201 135 / 0.22),
        0 10px 24px rgb(0 0 0 / 0.34);
}

.hb-cell--day .hb-cta--c:not(.hb-cta--primary) {
    background:
        linear-gradient(rgb(250 244 232 / 0.96), rgb(250 244 232 / 0.96)) padding-box,
        var(--hb-gilt) border-box;
    color: #6f4a17;
}

/* ── D 封蜡：羊皮纸色的签条，主按钮左端压一枚火漆印 ── */

.hb-cta--d {
    padding: 0 28px;
    border-radius: 3px;
    border-color: rgb(138 92 28 / 0.55);
    background: linear-gradient(180deg, #f1e4c8, #dfcaa0);
    box-shadow:
        inset 0 1px 0 rgb(255 251 240 / 0.6),
        0 10px 24px rgb(0 0 0 / 0.3);
    color: #3b2614;
}

.hb-cta--d.hb-cta--primary {
    padding-left: 54px;
}

.hb-seal {
    position: absolute;
    top: 50%;
    left: -12px;
    display: grid;
    place-items: center;
    width: 50px;
    height: 50px;
    border-radius: 47% 53% 50% 50% / 52% 48% 52% 48%;
    background: radial-gradient(60% 60% at 38% 34%, #c8364a, #8f1426 62%, #5c0915);
    box-shadow:
        inset 0 0 0 3px rgb(92 9 21 / 0.55),
        inset 0 0 0 5px rgb(220 90 100 / 0.25),
        0 4px 10px rgb(0 0 0 / 0.35);
    transform: translateY(-50%) rotate(-8deg);
    transition: transform 260ms var(--hb-ease);
}

.hb-seal__mark {
    width: 26px;
    height: 26px;
    color: rgb(255 214 200 / 0.75);
}

.hb-cta--d:hover {
    background: linear-gradient(180deg, #f5e9cf, #e4d0a8);
    box-shadow:
        inset 0 1px 0 rgb(255 251 240 / 0.7),
        0 0 18px rgb(255 236 196 / 0.3),
        0 10px 24px rgb(0 0 0 / 0.3);
}

.hb-cta--d:hover .hb-seal {
    transform: translateY(-50%) rotate(-3deg) scale(1.04);
}

.hb-cell--day .hb-cta--d {
    box-shadow:
        inset 0 1px 0 rgb(255 251 240 / 0.6),
        0 8px 18px rgb(64 38 18 / 0.2);
}

@media (prefers-reduced-motion: reduce) {
    .hb-cta,
    .hb-cta::before,
    .hb-cta::after,
    .hb-corner,
    .hb-seal {
        transition: none;
    }
}

@container (max-width: 720px) {
    .hb-head,
    .hb-row {
        grid-template-columns: minmax(0, 1fr);
    }

    .hb-head {
        display: none;
    }
}
</style>
