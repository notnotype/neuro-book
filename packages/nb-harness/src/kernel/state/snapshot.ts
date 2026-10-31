/**
 * 扩展的片：每个作用域一份快照“扩展 id → 片名 → 值”。归约只看自己的片，返回同作用域片的补丁（extensions.md 输出 5–9）。
 * 没有任何一片变化时返回同一个快照对象：path 上每个节点都记一份快照，靠共享省内存。
 *
 * `ctx.set` 写的是 `<扩展 id>/stateSet` 事件，由这里直接归约，不派发给扩展的 `reduce`。
 */

import type {LogEvent, Scope} from "../api/index.js";
import {deepFreeze} from "./freeze.js";

export type Slices = Readonly<Record<string, unknown>>;
export type Snapshot = Readonly<Record<string, Slices>>;

/** 归约需要的那部分扩展声明（装配结果给出）。 */
export interface Reducer {
    readonly id: string;
    readonly slices: Readonly<Record<string, {readonly scope: Scope; readonly initial: unknown; readonly resetOnCompaction: boolean}>>;
    readonly reduce: Readonly<Record<string, (event: LogEvent, state: Slices) => Readonly<Record<string, unknown>> | undefined | void>>;
}

export const STATE_SET = "stateSet";

export interface ReduceProblem {
    readonly extension: string;
    readonly event: LogEvent;
    readonly error: unknown;
}

export function initialSnapshot(reducers: readonly Reducer[], scope: Scope, freeze: boolean): Snapshot {
    const snapshot: Record<string, Slices> = {};
    for (const reducer of reducers) {
        const slices: Record<string, unknown> = {};
        for (const [name, spec] of Object.entries(reducer.slices)) if (spec.scope === scope) slices[name] = spec.initial;
        snapshot[reducer.id] = slices;
    }
    return freeze ? deepFreeze(snapshot) : snapshot;
}

/** 这条事件在这个扩展的 `reduce` 表里的键：内核事件与自己的事件用短名，别人的事件用全名。 */
function keyFor(reducer: Reducer, type: string): string {
    return type.startsWith(`${reducer.id}/`) && type.indexOf("/", reducer.id.length + 1) < 0 ? type.slice(reducer.id.length + 1) : type;
}

export function reduceSnapshot(reducers: readonly Reducer[], snapshot: Snapshot, event: LogEvent, scope: Scope, options: {freeze: boolean; onProblem: (problem: ReduceProblem) => void}): Snapshot {
    let next: Record<string, Slices> | undefined;
    for (const reducer of reducers) {
        const current = snapshot[reducer.id] ?? {};
        let patch: Readonly<Record<string, unknown>> | undefined | void;
        if (event.type === `${reducer.id}/${STATE_SET}`) {
            const data = event.data as {slice: string; value: unknown};
            patch = {[data.slice]: data.value};
        } else if (event.type === "compaction") {
            patch = Object.fromEntries(Object.entries(reducer.slices).filter(([, spec]) => spec.scope === scope && spec.resetOnCompaction).map(([name, spec]) => [name, spec.initial]));
        } else {
            const fn = reducer.reduce[keyFor(reducer, event.type)];
            if (fn === undefined) continue;
            // 归约出错不能挡住日志：事件已经写下，叶子必须前进；这次补丁不用，重放时同样出错、同样不用，结果确定。
            try {
                patch = fn(event, current);
            } catch (error) {
                options.onProblem({extension: reducer.id, event, error});
                continue;
            }
        }
        if (patch === undefined || patch === null) continue;
        let changed: Record<string, unknown> | undefined;
        for (const [name, value] of Object.entries(patch)) {
            // 只认这个作用域里声明过的片：挂错作用域在类型上已是编译错误，JavaScript 作者写错时这里忽略。
            if (reducer.slices[name]?.scope !== scope || Object.is(current[name], value)) continue;
            (changed ??= {...current})[name] = options.freeze ? deepFreeze(value) : value;
        }
        if (changed !== undefined) (next ??= {...snapshot})[reducer.id] = options.freeze ? Object.freeze(changed) : changed;
    }
    if (next === undefined) return snapshot;
    return options.freeze ? Object.freeze(next) : next;
}
