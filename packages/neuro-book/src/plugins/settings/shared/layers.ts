/**
 * 层快照与合成：拥有者发布层快照，每个实例按本实例可用的层合成有效值（docs/specs/settings/configuration.md 输出 5、6、10）。
 * 两端共用，不碰文件。
 */

import type {SettingDeclaration, SettingLayer, SettingSource} from "nbook/shared/settings";

/** 拥有者进程的启动标识加进程内单调递增的序号；只有启动标识相同的两个修订号可以比较先后。 */
export interface Revision {
    readonly boot: string;
    readonly seq: number;
}

export interface LayerProblem {
    readonly key: string;
    readonly reason: "invalid-value" | "layer-not-allowed";
}

/** 一层的公开状态。`values` 只含已声明、符合 schema、本层允许的键，深冻结。 */
export type LayerSnapshot =
    | {readonly status: "ok"; readonly revision: Revision; readonly values: Readonly<Record<string, unknown>>; readonly problems: ReadonlyArray<LayerProblem>}
    /** 文件当前无效：`values` 与 `problems` 是上一份有效内容的（启动时即无效则为空），写入一律拒绝。 */
    | {readonly status: "invalid"; readonly revision: Revision; readonly values: Readonly<Record<string, unknown>>; readonly problems: ReadonlyArray<LayerProblem>; readonly detail: string};

/**
 * 收到的快照能不能替换当前的：同一启动标识下序号更大才替换，写入结果与订阅推送乱序到达时不倒退。启动标识不同说明
 * 拥有者换了进程（重新订阅到了新的拥有者），以新的为准。
 */
export function supersedes(next: Revision, current: Revision | null): boolean {
    if (current === null || next.boot !== current.boot) return true;
    return next.seq > current.seq;
}

/**
 * 两份快照是否在公开内容上相同（状态、键值、被丢弃的键、无效原因），不看修订号：拥有者重读后都相同时不发布
 * （输出 10）。值都是 JSON，按规范化的 JSON 文本比较。
 */
export function sameContent(left: LayerSnapshot, right: LayerSnapshot): boolean {
    return canonical(contentOf(left)) === canonical(contentOf(right));
}

function contentOf(snapshot: LayerSnapshot): unknown {
    return snapshot.status === "ok"
        ? {status: "ok", values: snapshot.values, problems: snapshot.problems}
        : {status: "invalid", values: snapshot.values, problems: snapshot.problems, detail: snapshot.detail};
}

/** 键按码元顺序排列的 JSON 文本；值只来自 JSON 文本或已校验的 JSON 值。 */
export function canonical(value: unknown): string {
    return JSON.stringify(value, (_key, item: unknown) => {
        if (typeof item !== "object" || item === null || Array.isArray(item)) return item;
        const record = item as Record<string, unknown>;
        return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]));
    });
}

/** 一个键在本实例的有效值：允许的层里最具体的那一层的值，没有则取默认值（输出 6）。对象整体覆盖，不合并。 */
export function effectiveOf(key: string, declaration: SettingDeclaration, layers: Readonly<Partial<Record<SettingLayer, Readonly<Record<string, unknown>>>>>): {readonly value: unknown; readonly source: SettingSource} {
    for (const layer of ["project", "user"] as const) {
        const values = layers[layer];
        if (values === undefined || !declaration.layers.includes(layer) || !Object.hasOwn(values, key)) continue;
        return {value: values[key], source: layer};
    }
    return {value: declaration.default, source: "default"};
}
