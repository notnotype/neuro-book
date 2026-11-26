/**
 * 任务定义：任务原文、站点与种子、允许的写接口、带权重的条目。
 * 种子是定义的一部分：同一题每次运行看到同一份数据（题集当固定的，见设计稿“怎么算接近”）。
 * 改了题（原文、条目、站点的数据或页面）就把 `revision` 加 1，`taskVersion` 跟着变，旧运行不再与新的放在一起算。
 */

import {createHash} from "node:crypto";

import type {RunRecord, SiteEvidenceRecord} from "../record/schema";
import type {SiteDefinition} from "../sites/server";

export interface CheckInput<State> {
    /** 运行结束时站点的状态。 */
    readonly state: State;
    /** 同一个种子刚生成时的状态，用来对照“别的没动”。 */
    readonly initial: State;
    readonly evidence: SiteEvidenceRecord;
    /** `答案：` 行冒号后的文字；没有为 null。 */
    readonly answer: string | null;
    readonly finalAnswer: string | null;
    readonly record: RunRecord;
}

export interface TaskItem<State> {
    readonly id: string;
    readonly weight: number;
    check(input: CheckInput<State>): {readonly met: boolean; readonly evidence: string};
}

export interface TaskDefinition<State = unknown> {
    readonly id: string;
    readonly site: SiteDefinition<State>;
    readonly seed: number;
    readonly revision: number;
    /** `outcome` 只看结果，怎么做到的都行；`flow` 要求经过页面上的那几步（按页面协议取过凭据）。 */
    readonly kind: "outcome" | "flow";
    /** 允许的写接口（`方法 路径`）；不在里面的写请求计为没被要求的写操作。 */
    readonly allowedWrites: readonly string[];
    readonly timeLimitSec: number;
    instruction(urls: {readonly main: string; readonly editor: string}): string;
    readonly items: ReadonlyArray<TaskItem<State>>;
}

/** 载入时校验：条目 id 不重复，权重是正整数且合计 100。 */
export function defineTask<State>(task: TaskDefinition<State>): TaskDefinition<State> {
    const ids = new Set(task.items.map((item) => item.id));
    if (ids.size !== task.items.length) throw new Error(`${task.id}: duplicate item ids`);
    if (!task.items.every((item) => Number.isInteger(item.weight) && item.weight > 0)) throw new Error(`${task.id}: item weights must be positive integers`);
    const total = task.items.reduce((sum, item) => sum + item.weight, 0);
    if (total !== 100) throw new Error(`${task.id}: item weights total ${total}, not 100`);
    return task;
}

/** 任务的内容哈希：原文（地址换成占位）、种子、修订号、类型、允许的写接口、条目与权重。 */
export function taskVersion(task: TaskDefinition): string {
    const body = JSON.stringify({id: task.id, site: task.site.name, seed: task.seed, revision: task.revision, kind: task.kind, allowedWrites: task.allowedWrites, timeLimitSec: task.timeLimitSec, instruction: task.instruction({main: "{main}", editor: "{editor}"}), items: task.items.map((item) => [item.id, item.weight])});
    return createHash("sha256").update(body).digest("hex").slice(0, 16);
}
