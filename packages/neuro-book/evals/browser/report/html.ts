/**
 * 报表的 HTML：投影与私有报告共用一份版式。投影只拿 `Summary` 画（只有数值与枚举）；
 * 私有报告另加“逐回明细”一节，画最终回答、证据与附注。
 */

import {OUTCOME_KINDS} from "../record/schema";
import {escapeHtml} from "../sites/kit";
import type {Report, Summary} from "./report";

const ARM_LABEL: Readonly<Record<string, string>> = {"browser-use": "browser-use", nbook: "NeuroBook"};

function fixed(value: number | null, digits = 1): string {
    return value === null ? "—" : value.toFixed(digits);
}

function count(value: number | null): string {
    return value === null ? "—" : Math.round(value).toLocaleString("en-US");
}

function seconds(ms: number | null): string {
    return ms === null ? "—" : `${(ms / 1000).toFixed(1)} 秒`;
}

function percent(value: number | null): string {
    return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function groupLabel(group: {model: string; arm: string}): string {
    return `${escapeHtml(group.model)} <span class="arm">${escapeHtml(ARM_LABEL[group.arm] ?? group.arm)}</span>`;
}

/** 均分后面画一条 0 到 100 的刻度：区间是浅色的一段，均分是一道竖线。 */
function scoreBar(mean: number | null, interval: {lower: number; upper: number} | null): string {
    if (mean === null) return "";
    const band = interval === null ? "" : `<span class="band" style="left:${interval.lower}%;width:${Math.max(0.5, interval.upper - interval.lower)}%"></span>`;
    return `<span class="bar">${band}<span class="mark" style="left:${mean}%"></span></span>`;
}

function overview(summary: Summary): string {
    const rows = summary.groups.map((group) => `<tr>
<th scope="row">${groupLabel(group)}</th>
<td class="num strong">${fixed(group.meanScore)}</td>
<td class="bar-cell">${scoreBar(group.meanScore, group.interval)}</td>
<td class="num">${group.interval === null ? "—" : `${fixed(group.interval.lower)} 到 ${fixed(group.interval.upper)}`}</td>
<td class="num">${percent(group.fullCorrect)}</td>
<td class="num">${group.counted} / ${group.attempts}</td>
<td class="num">${count(group.usage.medianInput)}</td>
<td class="num">${count(group.usage.medianCacheRead)}</td>
<td class="num">${count(group.usage.medianOutput)}</td>
<td class="num">${count(group.usage.medianRequests)}</td>
<td class="num">${seconds(group.medianWallMs)}</td>
<td class="num">${group.injectionZeroed}</td>
</tr>`).join("\n");
    return `<section>
<h2>各模型的均分与用量</h2>
<table class="overview">
<thead><tr><th>模型</th><th class="num">均分</th><th></th><th class="num">95% 区间</th><th class="num">满分</th><th class="num">计分 / 格</th><th class="num">输入中位数</th><th class="num">其中缓存读</th><th class="num">输出中位数</th><th class="num">请求数</th><th class="num">用时</th><th class="num">注入清零</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</section>`;
}

function perTask(summary: Summary): string {
    const taskIds = summary.tasks.map((task) => task.taskId);
    const header = summary.groups.map((group) => `<th>${groupLabel(group)}</th>`).join("");
    const rows = taskIds.map((taskId) => {
        const cells = summary.groups.map((group) => {
            const task = group.tasks.find((entry) => entry.taskId === taskId);
            if (task === undefined) return `<td class="empty">—</td>`;
            const runs = task.scores.map((score) => `<span class="run s${score === 100 ? "full" : score === 0 ? "zero" : "part"}">${Math.round(score)}</span>`).join("");
            return `<td><span class="num strong">${fixed(task.mean)}</span><span class="runs">${runs}</span></td>`;
        }).join("");
        return `<tr><th scope="row"><code>${escapeHtml(taskId)}</code></th>${cells}</tr>`;
    }).join("\n");
    return `<section>
<h2>逐题</h2>
<table class="tasks"><thead><tr><th>题</th>${header}</tr></thead><tbody>${rows}</tbody></table>
</section>`;
}

function repeats(summary: Summary): string {
    const blocks = summary.repeats.map((entry) => {
        if (entry.advice === null) return `<p><strong>${escapeHtml(entry.model)}</strong>：每题不到 2 次，算不出波动。</p>`;
        const {advice} = entry;
        const rows = advice.estimates.flatMap((estimate) => (["power", "halfWidth"] as const).map((method) => {
            const recommended = method === advice.recommended.method && estimate.allSameVariance === advice.recommended.allSameVariance;
            const values = estimate[method];
            return `<tr${recommended ? ` class="recommended"` : ""}><th scope="row">${method === "power" ? "功效法（80%）" : "半宽法"}</th><td>${estimate.allSameVariance === "zero" ? "记 0" : "保守下界"}</td><td class="num">${fixed(Math.sqrt(estimate.meanVariance))}</td><td class="num">${values.T8 ?? "—"}</td><td class="num">${values.T24 ?? "—"}</td></tr>`;
        })).join("");
        const notes = [
            advice.allSameTasks.length > 0 ? `全同分的题：${advice.allSameTasks.map((id) => `<code>${escapeHtml(id)}</code>`).join("、")}` : "",
            advice.insufficientTasks.length > 0 ? `不到 2 次、没进估算：${advice.insufficientTasks.map((id) => `<code>${escapeHtml(id)}</code>`).join("、")}` : "",
        ].filter((line) => line !== "").map((line) => `<p class="aside">${line}</p>`).join("");
        return `<div class="repeat"><h3>${escapeHtml(entry.model)}</h3>
<table><thead><tr><th>算法</th><th>全同分的题</th><th class="num">每题标准差</th><th class="num">8 题</th><th class="num">24 题</th></tr></thead><tbody>${rows}</tbody></table>${notes}</div>`;
    }).join("\n");
    return `<section>
<h2>每题要跑几次</h2>
<div class="repeats">${blocks}</div>
</section>`;
}

function paired(summary: Summary): string {
    if (summary.paired.length === 0) return "";
    const rows = summary.paired.map((entry) => `<tr><th scope="row">${escapeHtml(entry.model)}</th><td class="num strong">${fixed(entry.meanDiff)}</td><td class="num">${fixed(entry.interval.lower)} 到 ${fixed(entry.interval.upper)}</td><td class="num">${entry.inputMedianRatio === null ? "—" : entry.inputMedianRatio.toFixed(2)}</td><td class="num">${entry.pairedTasks.length}</td><td>${entry.unpairedTasks.map((id) => `<code>${escapeHtml(id)}</code>`).join("、") || "—"}</td></tr>`).join("");
    return `<section>
<h2>NeuroBook 减 browser-use</h2>
<table><thead><tr><th>模型</th><th class="num">均分差</th><th class="num">95% 区间</th><th class="num">输入中位数之比</th><th class="num">配对的题</th><th>缺配对</th></tr></thead><tbody>${rows}</tbody></table>
</section>`;
}

function outcomes(summary: Summary): string {
    const header = OUTCOME_KINDS.map((kind) => `<th class="num"><code>${kind}</code></th>`).join("");
    const rows = summary.groups.map((group) => `<tr><th scope="row">${groupLabel(group)}</th>${OUTCOME_KINDS.map((kind) => `<td class="num${group.outcomes[kind] === 0 ? " zero-count" : ""}">${group.outcomes[kind]}</td>`).join("")}<td class="num">${group.retriedAttempts}</td><td class="num">${group.exhaustedAttempts}</td><td class="num">${group.incompleteAttempts}</td><td class="num">${seconds(group.medianObserverMs)}</td></tr>`).join("");
    return `<section>
<h2>结局</h2>
<table class="outcomes"><thead><tr><th>模型</th>${header}<th class="num">重跑过</th><th class="num">跑满未计分</th><th class="num">没跑完</th><th class="num">截图耗时</th></tr></thead><tbody>${rows}</tbody></table>
</section>`;
}

function details(report: Report): string {
    const rows = report.attempts.flatMap((attempt) => attempt.tries.map((entry) => {
        const items = entry.items.map((item) => `<li class="${item.status}"><code>${escapeHtml(item.id)}</code> ${escapeHtml(item.evidence)}</li>`).join("");
        const notes = entry.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("");
        return `<tr>
<th scope="row"><code>${escapeHtml(attempt.taskId)}</code><br>${escapeHtml(attempt.model)} ${escapeHtml(ARM_LABEL[attempt.arm] ?? attempt.arm)} a${attempt.attempt} 第 ${entry.try} 回</th>
<td><code>${escapeHtml(entry.outcome?.kind ?? "—")}</code>${entry.outcome?.detail ? `<br><span class="aside">${escapeHtml(entry.outcome.detail)}</span>` : ""}</td>
<td class="num strong">${fixed(entry.score, 0)}${entry.zeroedBy === null ? "" : `<br><span class="aside">清零前 ${fixed(entry.rawScore, 0)}</span>`}</td>
<td><ul class="items">${items}</ul>${notes === "" ? "" : `<ul class="notes">${notes}</ul>`}</td>
<td class="answer">${escapeHtml(entry.finalAnswer ?? "—")}</td>
</tr>`;
    })).join("\n");
    return `<section>
<h2>逐回明细</h2>
<table class="details"><thead><tr><th>运行</th><th>结局</th><th class="num">分</th><th>判分条目</th><th>最终回答</th></tr></thead><tbody>${rows}</tbody></table>
</section>`;
}

const STYLE = `
:root { color-scheme: light; --ink: #1d2433; --muted: #5d6778; --line: #d9dee7; --soft: #f3f5f9; --accent: #2f5fd0; --good: #2e7d4f; --bad: #b3412e; --part: #a87412; }
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.55 "Noto Sans SC", "PingFang SC", system-ui, sans-serif; color: var(--ink); background: #fff; }
main { max-width: 1200px; margin: 0 auto; padding: 32px 28px 64px; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 16px; margin: 36px 0 10px; }
h3 { font-size: 14px; margin: 0 0 6px; }
.meta { color: var(--muted); margin: 0; }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
thead th { font-weight: 600; color: var(--muted); font-size: 12px; border-bottom-color: var(--ink); }
tbody th { font-weight: 500; white-space: nowrap; }
.num { text-align: right; white-space: nowrap; }
.strong { font-weight: 600; }
.arm { color: var(--muted); font-size: 12px; margin-left: 4px; }
code { font-size: 12px; }
.bar-cell { width: 140px; padding-top: 12px; }
.bar { position: relative; display: block; height: 8px; background: var(--soft); border-radius: 4px; }
.band { position: absolute; top: 0; bottom: 0; background: color-mix(in srgb, var(--accent) 28%, transparent); border-radius: 4px; }
.mark { position: absolute; top: -3px; bottom: -3px; width: 2px; margin-left: -1px; background: var(--accent); }
.runs { display: inline-flex; gap: 3px; margin-left: 10px; }
.run { min-width: 26px; text-align: center; font-size: 11px; border-radius: 3px; padding: 0 3px; }
.sfull { background: color-mix(in srgb, var(--good) 16%, transparent); color: var(--good); }
.szero { background: color-mix(in srgb, var(--bad) 14%, transparent); color: var(--bad); }
.spart { background: color-mix(in srgb, var(--part) 16%, transparent); color: var(--part); }
.empty, .zero-count { color: #b5bccb; }
.repeats { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 20px; }
.recommended th, .recommended td { background: color-mix(in srgb, var(--accent) 8%, transparent); font-weight: 600; }
.aside { color: var(--muted); font-size: 12px; margin: 6px 0 0; }
.details td { font-size: 13px; }
.items, .notes { margin: 0; padding-left: 16px; }
.items .violated { color: var(--bad); }
.notes { color: var(--muted); margin-top: 6px; }
.answer { max-width: 320px; white-space: pre-wrap; }
`;

/** 画报表。`report` 为 null 时只画投影（不含逐回明细），给入库与 nbdev 发布用。 */
export function renderReportHtml(summary: Summary, report: Report | null): string {
    const versions = Object.entries(summary.versions).map(([key, values]) => `${escapeHtml(key)} ${values.map(escapeHtml).join("、")}`).join("；");
    return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>浏览器 Agent 评测</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>浏览器 Agent 评测</h1>
<p class="meta">${escapeHtml(summary.generatedAt.slice(0, 16).replace("T", " "))} UTC；${summary.tasks.length} 道题；${versions}</p>
${overview(summary)}
${paired(summary)}
${perTask(summary)}
${repeats(summary)}
${outcomes(summary)}
${report === null ? "" : details(report)}
</main>
</body>
</html>
`;
}
