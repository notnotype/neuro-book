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
                    <code class="tier-id">{{ tier.id }}</code>
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
            <p><strong>实验说明：</strong></p>
            <ul>
                <li>切换顶栏的「桌面」到「自定义图片」或「极光」，选一张色彩复杂的图，再看哪一档读得清。</li>
                <li>「浮层」那一档是 FormSelect 的下拉菜单**在变量里登记的值**（14%），但 FormSelect 实际用了内联覆盖（65% 面板底）。</li>
                <li>「窄条」不开模糊，是故意的：它在面板**里面**，外面已经有一层面了，里面再糊一遍会读成两层玻璃叠在一起。</li>
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
