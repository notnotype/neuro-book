<script setup lang="ts">
/**
 * 首页按钮的样张（同名 .md，w00056 t06）：第 6 轮出了四版给开发者挑，第 8 轮定为 B“皮面烫金”（`GiltButton`），
 * 这里只剩选定的那一版，夜与昼两种底、两种大小各摆一格。只是样张，按钮不跳转。
 */
import OAK from "./assets/oak.webp";
import GiltButton from "./GiltButton.vue";

const SCENES = [
    {id: "night", name: "夜", day: false},
    {id: "day", name: "昼", day: true},
] as const;
</script>

<template>
    <div class="hb">
        <!-- 样张里的按钮不跳转：点击在这一格上拦下。 -->
        <section v-for="scene in SCENES" :key="scene.id" class="hb-cell" :class="`hb-cell--${scene.id}`" :style="scene.day ? {'--hb-oak': `url(${OAK})`} : undefined" :aria-label="scene.name" @click.prevent>
            <div class="hb-pair">
                <GiltButton primary :day="scene.day">下载 NeuroBook</GiltButton>
                <GiltButton :day="scene.day">在 GitHub 上看看</GiltButton>
            </div>
            <div class="hb-pair">
                <GiltButton primary size="small" :day="scene.day">下载 NeuroBook</GiltButton>
                <GiltButton size="small" :day="scene.day">接着看世界引擎</GiltButton>
            </div>
        </section>
    </div>
</template>

<style scoped>
.hb {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
    min-height: 100%;
    padding: 28px;
    /* 按自己的宽度换版式（Lab 的画布比浏览器窗口窄，媒体查询量的是窗口）。 */
    container-type: inline-size;
    background: #2a2420;
}

.hb-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 22px;
    padding: 34px 20px;
    border-radius: 10px;
}

.hb-pair {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 16px;
}

/* 两种底：夜是首页暗夜圣殿的底，昼是午后抄经室的旧橡木桌面（第 9 轮的白天）。 */
.hb-cell--night {
    background:
        radial-gradient(70% 90% at 50% 0%, rgb(74 38 58 / 0.55), transparent 70%),
        #160e12;
}

.hb-cell--day {
    background:
        radial-gradient(70% 90% at 20% 0%, rgb(255 250 236 / 0.55), transparent 70%),
        var(--hb-oak) center / cover,
        #d1b18e;
}

@container (max-width: 720px) {
    .hb {
        grid-template-columns: minmax(0, 1fr);
    }
}
</style>
