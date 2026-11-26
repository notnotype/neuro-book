/**
 * 快照的耗时（计划第 5 片的测量，预算：工作台规模 50 毫秒以内）。只在 `NB_PAGE_AGENT_PERF=1` 时跑：
 * 耗时随机器负载起伏，不作为每次都跑的断言；数字打到输出里，记进 Task 证据。
 */

import {expect, test} from "@playwright/test";

import {openFixture} from "./page";

test.skip(process.env.NB_PAGE_AGENT_PERF !== "1", "只在测量时跑");

/** 50 组，每组 5 个按钮、3 个输入框、2 个链接，各包 8 层 div，夹着说明文字与图标：约 500 个可交互元素、6000 多个节点。 */
function workbenchLikePage(): string {
    const nest = (html: string, depth: number): string => (depth === 0 ? html : `<div class="d${String(depth)}">${nest(html, depth - 1)}</div>`);
    const icon = `<svg width="12" height="12" aria-hidden="true"><path d="M0 0h12v12H0z"/></svg>`;
    const group = (index: number): string => {
        const buttons = Array.from({length: 5}, (_, n) => nest(`<button title="动作 ${String(n)}">${icon}<span>按钮 ${String(index)}-${String(n)}</span></button>`, 4)).join("");
        const inputs = Array.from({length: 3}, (_, n) => nest(`<label>字段 ${String(n)} <input value="值 ${String(n)}"></label>`, 4)).join("");
        const links = Array.from({length: 2}, (_, n) => nest(`<a href="#g${String(index)}-${String(n)}">链接 ${String(n)}</a><p>一段说明文字，不可交互。</p>`, 4)).join("");
        return `<section aria-label="组 ${String(index)}" style="display:inline-block;width:240px;vertical-align:top">${nest(buttons + inputs + links, 4)}</section>`;
    };
    return `<main style="height:100vh;overflow:auto">${Array.from({length: 50}, (_, index) => group(index)).join("")}</main>`;
}

test("500 个可交互元素的快照耗时", async ({page}) => {
    await openFixture(page, workbenchLikePage());
    const stats = await page.evaluate(() => {
        const nodes = document.getElementsByTagName("*").length;
        const runs: number[] = [];
        let listed = 0;
        for (let round = 0; round < 7; round += 1) {
            const start = performance.now();
            const result = window.agent.snapshot({maxTokens: 8000});
            runs.push(performance.now() - start);
            if (!("ok" in result)) listed = result.elements.length;
        }
        return {nodes, listed, runs};
    });
    const sorted = [...stats.runs].sort((a, b) => a - b);
    console.log(JSON.stringify({nodes: stats.nodes, listed: stats.listed, first: Math.round(stats.runs[0]!), median: Math.round(sorted[3]!), max: Math.round(sorted[6]!)}));
    expect(stats.listed).toBeGreaterThan(0);
});
