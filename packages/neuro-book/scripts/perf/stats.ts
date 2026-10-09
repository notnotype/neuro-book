/**
 * 性能测量（w00017 t72）的纯函数：分位数汇总、RPC 帧分类与请求计数。不碰浏览器、磁盘与时间，供 `files-perf.ts` 与
 * 测试共用。
 */

export interface Summary {
    readonly count: number;
    readonly min: number;
    readonly p50: number;
    readonly p95: number;
    readonly max: number;
}

/** 最近秩分位数（不插值）：p95 是排序后第 ⌈0.95·n⌉ 个值。没有样本时抛错，免得报出 0。 */
export function percentile(values: ReadonlyArray<number>, fraction: number): number {
    if (values.length === 0) throw new RangeError("没有样本");
    if (fraction <= 0 || fraction > 1) throw new RangeError(`分位数要在 (0, 1] 内：${String(fraction)}`);
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.ceil(fraction * sorted.length) - 1] as number;
}

export function summarize(values: ReadonlyArray<number>): Summary {
    const round = (value: number): number => Math.round(value * 10) / 10;
    return {
        count: values.length,
        min: round(Math.min(...values)),
        p50: round(percentile(values, 0.5)),
        p95: round(percentile(values, 0.95)),
        max: round(Math.max(...values)),
    };
}

/**
 * 浏览器发出的一个 RPC 帧（JSON 文本）归到哪一类：请求按 `合同 方法`，订阅按 `合同 subscribe`；握手、确认、取消
 * 订阅等其它帧不计。解析不了的帧返回 null（不是 RPC 的文本）。
 */
export function classifyFrame(payload: string): string | null {
    let value: unknown;
    try {
        value = JSON.parse(payload);
    } catch {
        // 二进制或非 JSON 的帧不是本协议的请求：不计入请求数。
        return null;
    }
    if (typeof value !== "object" || value === null) return null;
    const frame = value as {type?: unknown; contract?: unknown; method?: unknown};
    if (frame.type === "request" && typeof frame.contract === "string" && typeof frame.method === "string") return `${frame.contract} ${frame.method}`;
    if (frame.type === "subscribe" && typeof frame.contract === "string") return `${frame.contract} subscribe`;
    return null;
}

/** 按类别计数。 */
export function countBy(kinds: ReadonlyArray<string>): Readonly<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const kind of kinds) counts[kind] = (counts[kind] ?? 0) + 1;
    return counts;
}

/** V8 CPU profile（CDP `Profiler.stop` 与 `bun --cpu-prof` 的格式）里需要的部分。 */
export interface CpuProfile {
    readonly nodes: ReadonlyArray<{readonly id: number; readonly callFrame: {readonly functionName: string; readonly url: string; readonly lineNumber: number}}>;
    readonly samples?: ReadonlyArray<number>;
    readonly timeDeltas?: ReadonlyArray<number>;
}

/** 按自身时间排序的热点函数（毫秒）；`(idle)` 与 `(program)` 一类的伪节点照常列出，由读的人判断。 */
export function hotspots(profile: CpuProfile, limit = 30): ReadonlyArray<{readonly name: string; readonly selfMs: number}> {
    const self = new Map<number, number>();
    const samples = profile.samples ?? [];
    const deltas = profile.timeDeltas ?? [];
    for (let index = 0; index < samples.length; index += 1) self.set(samples[index] as number, (self.get(samples[index] as number) ?? 0) + (deltas[index] ?? 0));
    const byName = new Map<string, number>();
    for (const node of profile.nodes) {
        const micros = self.get(node.id) ?? 0;
        if (micros === 0) continue;
        const file = node.callFrame.url.split("/").pop() ?? "";
        const name = `${node.callFrame.functionName || "(匿名)"} ${file}:${String(node.callFrame.lineNumber + 1)}`;
        byName.set(name, (byName.get(name) ?? 0) + micros);
    }
    return [...byName.entries()].sort((left, right) => right[1] - left[1]).slice(0, limit).map(([name, micros]) => ({name, selfMs: Math.round(micros / 100) / 10}));
}
