<script setup lang="ts">
/**
 * 5 档面对照板：把库里登记的 5 档表面角色并排摆出来，用于挑选哪一档适合大面积 chrome。
 * 每一档显示它的实际配方（不透明度、模糊）和一段示例文本，判据是**背景复杂时文字能不能读**。
 */

type SurfaceTier = {
    id: string;
    label: string;
    surface: string;
    blur: string;
    note: string;
    /** 库里没登记这一档，它是某个组件自己内联写的 */
    unregistered?: boolean;
};

const tiers: SurfaceTier[] = [
    {
        id: "toolbar",
        label: "工具栏",
        surface: "var(--toolbar-surface)",
        blur: "var(--glass-blur, none)",
        note: "顶栏、应用条。nbook·昼 30% + blur(8px) sat(190%) bright(1.12)",
    },
    {
        id: "sidebar",
        label: "侧栏",
        surface: "var(--sidebar-surface)",
        blur: "var(--glass-blur, none)",
        note: "导航栏。nbook·昼 26% + 同上",
    },
    {
        id: "overlay",
        label: "浮层",
        surface: "var(--overlay-surface)",
        blur: "var(--overlay-blur)",
        note: "下拉、菜单、对话框。nbook·昼 14% + blur(8px) sat(190%) bright(1.14)",
    },
    {
        id: "strip",
        label: "窄条",
        surface: "var(--strip-surface)",
        blur: "none",
        note: "面板里的操作条、表头。nbook·昼 38%，不模糊",
    },
    {
        id: "panel",
        label: "面板",
        surface: "var(--panel-surface)",
        blur: "none",
        note: "正文、数据面板。nbook·昼 100% 实心",
    },
    {
        /*
         * 这一档不在库里。它是 FormSelect 用内联 style 写死的，也是实测下来唯一
         * 能在复杂背景上读清文字的配方——所以它是「盒子规范」要登记的那一档。
         *
         * 与上面四档玻璃的三处差别，每一处都指向可读性：
         *   面 65% 而不是 14–38%    —— 透明度是可读性预算，不是风格旋钮
         *   底取 --bg-panel 而不是 --bg-sidebar —— 暖而亮的底比冷底更托得住文字
         *   饱和 130% / 亮度 1.0    —— 190% + 1.14 是在**增强背景**，等于让背景和文字抢注意力
         */
        id: "select-actual",
        label: "下拉实测",
        surface: "color-mix(in srgb, var(--bg-panel) 65%, transparent)",
        blur: "blur(8px) saturate(130%) brightness(1.0)",
        note: "FormSelect 内联写死的值。65% 面板底 + blur(8px) sat(130%) bright(1.0)",
        unregistered: true,
    },
];

</script>

<template>
    <div class="surface-tier-demo">
        <p class="demo-intro">
            5 档表面角色，从左到右：最透 → 实心。每一档下面有它在 nbook·昼 的实际取值。
            <strong>判据：背景复杂时，这一档的文字能不能读。</strong>
        </p>

        <div class="tier-grid">
            <div
                v-for="tier in tiers"
                :key="tier.id"
                class="tier-card"
                :style="{
                    background: tier.surface,
                    backdropFilter: tier.blur,
                    WebkitBackdropFilter: tier.blur,
                }"
            >
                <div class="tier-header">
                    <h3 class="tier-label">{{ tier.label }}</h3>
                    <code v-if="tier.unregistered" class="tier-flag">库里没登记</code>
                    <code v-else class="tier-id">{{ tier.id }}</code>
                </div>

                <p class="tier-sample">
                    一段用来判断可读性的示例文本。如果背景底纹从字后面浮上来、
                    以至于你得盯着看才能认出这是什么字，这一档就不适合铺在大面上。
                </p>

                <dl class="tier-meta">
                    <dt>取值</dt>
                    <dd class="tier-note">{{ tier.note }}</dd>
                </dl>
            </div>
        </div>

        <div class="demo-note">
            <p><strong>实测结论（2026-09-02，复杂照片背景下）：</strong></p>
            <ul>
                <li><strong>前四档全部读不了</strong>——工具栏 30%、侧栏 26%、浮层 14%、窄条 38%，都要盯着才能认出字。</li>
                <li><strong>只有「下拉实测」那一档读得清</strong>，而它库里根本没登记，是 FormSelect 用内联 style 写死的。</li>
                <li>三处差别都指向可读性：面 65%、底取暖而亮的 <code>--bg-panel</code>、饱和降到 130% 且亮度不加。</li>
                <li><strong>饱和 190% 是在增强背景</strong>，等于让背景和文字抢注意力——这是前四档读不了的主因，不只是透明度。</li>
            </ul>
        </div>
    </div>
</template>

<style scoped>
.surface-tier-demo {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding: var(--space-6);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    line-height: var(--leading-ui);
    color: var(--text-main);
}

.demo-intro {
    padding: var(--space-4);
    border-left: 3px solid var(--accent-main);
    background: var(--bg-subtle);
    border-radius: var(--radius-control);
}

.tier-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: var(--space-5);
}

.tier-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-5);
    border: var(--border-w) solid var(--panel-outline, var(--divider));
    border-radius: var(--radius-panel);
    /* 这里故意不给 box-shadow，让 5 档只在面色和模糊上有差别，投影不干扰判断 */
    min-height: 320px;
}

.tier-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    padding-bottom: var(--space-3);
    border-bottom: var(--border-w) solid var(--divider);
}

.tier-label {
    font-size: var(--text-md);
    font-weight: var(--weight-semibold);
    color: var(--text-main);
}

.tier-id {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-muted);
}

/* 最后一档不是库里的角色，标出来防止被当成第 6 个可选项直接消费 */
.tier-flag {
    padding: 0 var(--space-2);
    border-radius: var(--radius-control);
    background: color-mix(in srgb, var(--status-warning) 22%, transparent);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--text-main);
}

.tier-sample {
    flex: 1;
    color: var(--text-main);
    line-height: var(--leading-reading);
}

.tier-meta {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-top: var(--space-3);
    border-top: var(--border-w) solid var(--divider);
    font-size: var(--text-xs);
}

.tier-meta dt {
    font-weight: var(--weight-medium);
    color: var(--text-muted);
}

.tier-note {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--text-secondary);
    line-height: 1.6;
}

.demo-note {
    padding: var(--space-5);
    background: var(--bg-subtle);
    border-radius: var(--radius-control);
    font-size: var(--text-sm);
}

.demo-note strong {
    display: block;
    margin-bottom: var(--space-3);
    color: var(--text-main);
}

.demo-note ul {
    margin: 0;
    padding-left: var(--space-5);
}

.demo-note li {
    margin-top: var(--space-2);
    color: var(--text-secondary);
}
</style>
