/**
 * 把提示框的内容（`options.ts` 的 `Tooltip`）拼成元素交给 ECharts。用元素不用 HTML 字符串：名字来自目录，不经 `innerHTML`，
 * 以后换成别处来的字也不会被当成标记。
 */

import type {Tooltip} from "./options";

export function renderTooltip(tooltip: Tooltip): HTMLElement {
    const root = document.createElement("div");
    root.dataset.siteChartTooltip = "";
    const title = document.createElement("div");
    title.textContent = tooltip.title;
    title.style.marginBottom = "4px";
    root.append(title);
    for (const row of tooltip.rows) {
        const line = document.createElement("div");
        line.style.cssText = "display:flex;align-items:center;gap:6px";
        const key = document.createElement("span");
        key.style.cssText = `width:8px;height:8px;border-radius:50%;background:${row.color}`;
        const name = document.createElement("span");
        name.textContent = row.name;
        name.style.flex = "1";
        const value = document.createElement("span");
        value.textContent = row.value;
        value.style.cssText = "margin-left:16px;font-weight:600;font-variant-numeric:tabular-nums";
        line.append(key, name, value);
        root.append(line);
    }
    return root;
}
