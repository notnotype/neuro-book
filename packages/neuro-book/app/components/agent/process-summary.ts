import type {ViewText} from "./agent-view.types";
import type {ChainSummary, TurnMetrics} from "./conversation-turns";

/** 摘要行的文案：概括各段与危险色提醒，调用方翻译后用“ · ”连接。 */
export type ProcessDescription = {
    parts: ViewText[];
    alert: ViewText | null;
};

/** 读和改写成一句话；两者都有时共用“文件”，读起来像人说的而不是统计表。 */
function filesPhrase(read: number, changed: number): ViewText | null {
    if (read > 0 && changed > 0) {
        return {key: "agentView.process.files.readChanged", params: {read, changed}};
    }
    if (read > 0) {
        return {key: "agentView.process.files.read", params: {count: read}};
    }
    if (changed > 0) {
        return {key: "agentView.process.files.changed", params: {count: changed}};
    }
    return null;
}

function failedAlert(failed: number): ViewText | null {
    return failed > 0 ? {key: "agentView.process.failed", params: {count: failed}} : null;
}

/** 一条思维链：思考、读改了哪些文件、其余操作的次数；什么都没有时退回“过程”。 */
export function describeChain(summary: ChainSummary): ProcessDescription {
    const parts: ViewText[] = [];
    if (summary.thinking) {
        parts.push({key: "agentView.process.thinking"});
    }
    const files = filesPhrase(summary.filesRead, summary.filesChanged);
    if (files !== null) {
        parts.push(files);
    }
    if (summary.others > 0) {
        parts.push({key: files === null ? "agentView.process.actions" : "agentView.process.others", params: {count: summary.others}});
    }
    if (parts.length === 0) {
        parts.push({key: "agentView.process.fallback"});
    }
    return {parts, alert: failedAlert(summary.failed)};
}

/** 整轮过程：以“过程”开头，写总操作次数与读改文件数，让人判断值不值得展开。 */
export function describeTurn(metrics: TurnMetrics): ProcessDescription {
    const parts: ViewText[] = [{key: "agentView.process.fallback"}];
    if (metrics.steps > 0) {
        parts.push({key: "agentView.process.actions", params: {count: metrics.steps}});
    }
    const files = filesPhrase(metrics.filesRead, metrics.filesChanged);
    if (files !== null) {
        parts.push(files);
    }
    return {parts, alert: failedAlert(metrics.failed)};
}
