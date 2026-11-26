<script setup lang="ts">
/**
 * 稿纸（t10 计划 3.6；t09 第 1、5、7 条）：登录、注册、同意条款、授权确认四页共用的版面。整页是一张稿纸，产品名与一行说明
 * 一格一字写在格子里，卡片的内容由默认插槽给。画法照 t09 的静态稿 `SitePaperFrame`，换掉了它的三处问题（计划 3.6“要换掉的三处”）。
 *
 * 格子画在 `.paper-sheet` 的伪元素上，伪元素向四周伸出 2080px（格子横向周期 40、纵向周期 52 的公倍数），所以格线的原点就是
 * `.paper-sheet` 的左上角：标题格、卡片都按整格的偏移排在它里面，页面怎么居中、怎么滚动，卡片的边都落在格线上，不用脚本算位置。
 * 伸出去的部分由根元素的 `overflow: clip` 裁掉，不撑出滚动条。
 */

import {RouterLink} from "vue-router";

import {useSiteText} from "../text";

const t = useSiteText();
</script>

<template>
    <div class="paper" data-site-paper>
        <div class="paper-sheet" data-site-paper-sheet>
            <div class="paper-body">
                <section class="paper-words" :aria-label="t('paper.label', {title: t('paper.title'), about: t('paper.about')})">
                    <div class="paper-cells paper-cells--title" aria-hidden="true">
                        <span v-for="(letter, index) in [...t('paper.title')]" :key="index" class="paper-cell" data-site-paper-cell>{{ letter }}</span>
                    </div>
                    <div class="paper-cells paper-cells--about" aria-hidden="true">
                        <span v-for="(char, index) in [...t('paper.about')]" :key="index" class="paper-cell" data-site-paper-cell>{{ char }}</span>
                        <!-- 印章里的字暂写 NB（t09 第 6 条）。 -->
                        <span class="paper-cell" data-site-paper-cell><span class="paper-seal" data-site-paper-seal>NB</span></span>
                    </div>
                </section>
                <main class="paper-card" data-site-paper-card>
                    <slot />
                </main>
            </div>
            <footer class="paper-foot">
                <RouterLink to="/privacy" class="paper-link">{{ t("legal.privacy.title") }}</RouterLink>
                <RouterLink to="/terms" class="paper-link">{{ t("legal.terms.title") }}</RouterLink>
            </footer>
        </div>
    </div>
</template>

<style scoped>
/* 根元素预留了滚动条的槽位（`app.css`），槽位画的是页面底色而不是这张纸：有稿纸的页面把底色换成纸色，右缘不留一条灰带。 */
:global(body:has([data-site-paper])) {
    background: var(--bg-panel);
}

.paper {
    --paper-cell: 40px;
    --paper-row: 52px;
    /* 伪元素伸出去的距离：要同时是 40 与 52 的整数倍，遮罩的周期才从 `.paper-sheet` 的左上角起算。 */
    --paper-bleed: 2080px;
    /* 伸出去的格子在这里被裁掉；`isolation` 让伪元素的 `z-index: -1` 画在纸的底色之上、内容之下。
       用 `clip` 不用 `hidden`：`hidden` 会让根元素成为滚动容器，卡片比视口高时裁掉下面的部分（计划 3.6 的第 2 处）。 */
    isolation: isolate;
    overflow: clip;
    display: flex;
    flex-direction: column;
    min-height: 100svh;
    background: var(--bg-panel);
    color: var(--text-main);
    font-family: var(--font-ui);
    font-size: var(--text-md);
    line-height: var(--leading-ui);
}

.paper-sheet {
    position: relative;
    display: flex;
    flex: 1;
    flex-direction: column;
    box-sizing: border-box;
    width: calc(var(--paper-cell) * 28);
    margin-inline: auto;
    padding-top: calc(var(--paper-row) * 5);
}

/* 遮罩只管形状（一格方格加一条行间空白），颜色由 `--site-paper-line` 给，换明暗只换变量。 */
.paper-sheet::before {
    content: "";
    position: absolute;
    z-index: -1;
    inset: calc(var(--paper-bleed) * -1);
    background: var(--site-paper-line);
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='52'%3E%3Cpath d='M0 .5H40M0 40.5H40M.5 0V41' fill='none' stroke='%23000'/%3E%3C/svg%3E") 0 0 / var(--paper-cell) var(--paper-row);
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='52'%3E%3Cpath d='M0 .5H40M0 40.5H40M.5 0V41' fill='none' stroke='%23000'/%3E%3C/svg%3E") 0 0 / var(--paper-cell) var(--paper-row);
    pointer-events: none;
}

/* 宽屏：左边 13 格写字，空 6 格，右边 9 格是卡片（定稿 r3/login 的版式）。 */
.paper-body {
    display: grid;
    grid-template-columns: calc(var(--paper-cell) * 13) 1fr calc(var(--paper-cell) * 9);
    align-items: start;
    padding-bottom: var(--paper-row);
}

.paper-words {
    grid-column: 1;
}

.paper-cells {
    display: flex;
    flex-wrap: wrap;
}

/* 产品名与说明之间空一行。 */
.paper-cells--title {
    margin-bottom: var(--paper-row);
}

.paper-cell {
    display: grid;
    place-items: center;
    box-sizing: border-box;
    width: var(--paper-cell);
    height: var(--paper-cell);
    margin-bottom: calc(var(--paper-row) - var(--paper-cell));
    font-family: var(--font-display);
    font-size: 24px;
    line-height: 1;
}

.paper-cells--title .paper-cell {
    font-size: 30px;
    font-weight: 600;
}

/* 印章的字在两种明暗下都是白的：印章色按白字的对比度定（`styles/site.css`）。 */
.paper-seal {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 3px;
    background: var(--site-paper-seal);
    color: #fff;
    font-family: var(--font-display);
    font-size: 14px;
    font-weight: 700;
    transform: rotate(-4deg);
}

.paper-card {
    grid-column: 3;
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    padding: 32px 32px 24px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: var(--bg-panel);
}

.paper-card :slotted(h1) {
    margin: 0 0 22px;
    font-family: var(--font-display);
    font-size: 22px;
    font-weight: 600;
    line-height: 1.3;
}

/* 页脚贴在纸的底部，左边对齐写字的那一列；底色挡住身后的格线，像写在行间。 */
.paper-foot {
    display: flex;
    align-self: flex-start;
    gap: 24px;
    margin-top: auto;
    margin-bottom: 40px;
    padding: 0 8px;
    background: var(--bg-panel);
    font-size: var(--text-sm);
}

.paper-link {
    color: var(--text-secondary);
    text-decoration: none;
    text-underline-offset: 3px;
}

.paper-link:hover {
    text-decoration-line: underline;
}

.paper-link:focus-visible {
    outline: 2px solid var(--accent-main);
    outline-offset: 2px;
    border-radius: 2px;
}

/* 中等宽度：字在上、卡片在下，13 格宽（说明连印章正好一行），卡片在第 2 格起、居中。 */
@media (max-width: 1199px) {
    .paper-sheet {
        width: calc(var(--paper-cell) * 13);
        padding-top: calc(var(--paper-row) * 2);
    }

    .paper-body {
        grid-template-columns: 1fr;
    }

    .paper-words,
    .paper-card {
        grid-column: 1;
    }

    .paper-card {
        width: calc(var(--paper-cell) * 9);
        margin: var(--paper-row) 0 0 calc(var(--paper-cell) * 2);
    }
}

/*
 * 手机：9 格宽（360px），说明折成两行，卡片紧接在下一行、与字同宽。390 宽时左右各留 15px。
 * 比 372px 更窄时宽度跟着视口缩，格线与卡片右边、产品名的折行不再对齐，这是已知限制（计划 3.6）。
 * 断点比计划写的 480 宽：中等宽度的 13 格要 520px，480 到 560 之间放不下。
 */
@media (max-width: 560px) {
    .paper-sheet {
        width: min(calc(var(--paper-cell) * 9), 100% - 12px);
        padding-top: var(--paper-row);
    }

    .paper-cells--title {
        margin-bottom: 0;
    }

    .paper-card {
        width: 100%;
        margin: 0;
        padding: 24px 24px 20px;
    }

    .paper-foot {
        align-self: center;
        margin-bottom: 20px;
    }
}
</style>
