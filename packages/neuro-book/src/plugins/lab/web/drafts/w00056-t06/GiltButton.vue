<script setup lang="ts">
/**
 * 首页的按钮（同名 .md，w00056 t06 第 8 轮定为 B“皮面烫金”）：主按钮是深红皮面加烫金框与四角角花，次按钮只有细金框与四角。
 * 烫金框是一个伪元素（直角，渐变的边框图：圆角时 border-image 不跟着弯）；反光是叠在同一位置的第二道框，边框图换成一团跟着指针走的径向光。
 */
withDefaults(defineProps<{
    href?: string;
    primary?: boolean;
    size?: "regular" | "small";
    day?: boolean;
    glint?: boolean;
}>(), {href: "#", primary: false, size: "regular", day: false, glint: false});
</script>

<template>
    <a :href="href" class="gb" :class="{'gb--primary': primary, 'gb--small': size === 'small', 'gb--day': day}">
        <i class="gb__corner gb__corner--tl" aria-hidden="true"></i>
        <i class="gb__corner gb__corner--tr" aria-hidden="true"></i>
        <i class="gb__corner gb__corner--br" aria-hidden="true"></i>
        <i class="gb__corner gb__corner--bl" aria-hidden="true"></i>
        <i v-if="glint" class="gb__glint" aria-hidden="true"></i>
        <span class="gb__text"><slot /></span>
    </a>
</template>

<style scoped>
/*
 * 颜色：皮面 #8e1828 到 #3e0610；烫金是鎏金渐变，白天换古铜（浅底上亮金看不出）。角花是一段弯线加一粒圆点，画成数据地址的 SVG，
 * 颜色写死在里面，昼夜各一份。
 */
.gb {
    --gb-gilt: linear-gradient(135deg, #fff1c8 0%, #e2b866 22%, #8a5c1c 48%, #f2d491 70%, #a8762f 100%);
    --gb-corner: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M1 11V4.5Q1 1 4.5 1H11' fill='none' stroke='%23e8c27a' stroke-width='1.2'/%3E%3Ccircle cx='4.2' cy='4.2' r='1.3' fill='%23e8c27a'/%3E%3C/svg%3E");
    --gb-frame-inset: 0px;
    --gb-corner-inset: -3px;
    --gb-ease: cubic-bezier(0.22, 1, 0.36, 1);
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 48px;
    padding: 0 28px;
    border-radius: 3px;
    background: transparent;
    color: #f3e6cc;
    font-family: "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", "STSong", serif;
    font-size: 15px;
    letter-spacing: 0.14em;
    text-decoration: none;
    white-space: nowrap;
    cursor: pointer;
    transition:
        transform 160ms var(--gb-ease),
        box-shadow 260ms var(--gb-ease),
        background-color 260ms var(--gb-ease);
}

.gb::before,
.gb__glint {
    position: absolute;
    inset: var(--gb-frame-inset);
    border: 1px solid transparent;
    content: "";
    transition:
        inset 260ms var(--gb-ease),
        opacity 260ms var(--gb-ease);
}

/* 烫金的细框。 */
.gb::before {
    border-image: var(--gb-gilt) 1;
    opacity: 0.85;
}

/* 反光：同一道框，边框图是一团跟着指针走的暖光（首屏场景写 `--sx-glint-x`、`--sx-glint-y`）。 */
.gb__glint {
    border-image: radial-gradient(72px 40px at calc(50% + var(--sx-glint-x, 0) * 60%) calc(50% + var(--sx-glint-y, 0) * 110%), rgb(255 248 222 / 0.95), rgb(255 232 180 / 0.35) 45%, transparent 75%) 1;
    mix-blend-mode: screen;
    pointer-events: none;
}

.gb__corner {
    position: absolute;
    width: 11px;
    height: 11px;
    background: no-repeat center / contain var(--gb-corner);
}

.gb__corner--tl {
    top: var(--gb-corner-inset);
    left: var(--gb-corner-inset);
}

.gb__corner--tr {
    top: var(--gb-corner-inset);
    right: var(--gb-corner-inset);
    transform: rotate(90deg);
}

.gb__corner--br {
    right: var(--gb-corner-inset);
    bottom: var(--gb-corner-inset);
    transform: rotate(180deg);
}

.gb__corner--bl {
    bottom: var(--gb-corner-inset);
    left: var(--gb-corner-inset);
    transform: rotate(270deg);
}

.gb__text {
    position: relative;
}

/* 主按钮：哑光深红皮面，烫金框收进去 5px，角花在框外的皮面上，字是金的。 */
.gb--primary {
    --gb-frame-inset: 5px;
    --gb-corner-inset: 2px;
    background: radial-gradient(130% 160% at 30% 10%, #8e1828, #5e0c18 58%, #3e0610);
    box-shadow:
        inset 0 1px 0 rgb(255 222 200 / 0.16),
        inset 0 -2px 6px rgb(0 0 0 / 0.35),
        0 10px 26px rgb(0 0 0 / 0.36);
}

.gb--primary .gb__text {
    background: linear-gradient(180deg, #fff1c8, #e2b866 55%, #b8883e);
    background-clip: text;
    color: transparent;
    font-weight: 600;
}

/* 受光的微变：框往外展一像素、亮半档，皮面提温，一圈淡暖晕。 */
.gb:hover {
    --gb-frame-inset: -1px;
}

.gb--primary:hover {
    --gb-frame-inset: 4px;
    background: radial-gradient(130% 160% at 30% 10%, #9c1d2e, #66101c 58%, #420812);
    box-shadow:
        inset 0 1px 0 rgb(255 222 200 / 0.2),
        inset 0 -2px 6px rgb(0 0 0 / 0.35),
        0 0 20px rgb(240 201 135 / 0.2),
        0 10px 26px rgb(0 0 0 / 0.36);
}

.gb:hover::before {
    opacity: 1;
}

.gb:active {
    transform: translateY(1px);
}

.gb:focus-visible {
    outline: 2px solid #e8c27a;
    outline-offset: 4px;
}

.gb--small {
    height: 38px;
    padding: 0 18px;
    font-size: 13.5px;
    letter-spacing: 0.08em;
}

/* 白天：金换古铜；次按钮垫一层浅羊皮纸色、字换深墨，不然细框融进亮的石墙。 */
.gb--day {
    --gb-gilt: linear-gradient(135deg, #c99a52 0%, #8a5c1c 30%, #5e3c10 52%, #a8762f 74%, #6f4a17 100%);
    --gb-corner: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M1 11V4.5Q1 1 4.5 1H11' fill='none' stroke='%238a5c1c' stroke-width='1.2'/%3E%3Ccircle cx='4.2' cy='4.2' r='1.3' fill='%238a5c1c'/%3E%3C/svg%3E");
    color: #2e1f12;
}

.gb--day:not(.gb--primary) {
    background: rgb(250 244 230 / 0.86);
    box-shadow: 0 8px 18px rgb(64 38 18 / 0.16);
}

.gb--day:not(.gb--primary):hover {
    background: rgb(253 249 238 / 0.94);
    box-shadow:
        0 0 16px rgb(255 236 196 / 0.6),
        0 8px 18px rgb(64 38 18 / 0.16);
}

.gb--day.gb--primary {
    --gb-gilt: linear-gradient(135deg, #fff1c8 0%, #e2b866 22%, #8a5c1c 48%, #f2d491 70%, #a8762f 100%);
    --gb-corner: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M1 11V4.5Q1 1 4.5 1H11' fill='none' stroke='%23e8c27a' stroke-width='1.2'/%3E%3Ccircle cx='4.2' cy='4.2' r='1.3' fill='%23e8c27a'/%3E%3C/svg%3E");
    box-shadow:
        inset 0 1px 0 rgb(255 222 200 / 0.16),
        inset 0 -2px 6px rgb(0 0 0 / 0.3),
        0 8px 20px rgb(64 38 18 / 0.26);
}

.gb--day:focus-visible {
    outline-color: #8a5c1c;
}

@media (prefers-reduced-motion: reduce) {
    .gb,
    .gb::before,
    .gb__glint {
        transition: none;
    }
}
</style>
