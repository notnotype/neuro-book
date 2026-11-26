/**
 * 任务定义：任务原文、站点与种子、允许的写接口、带权重的条目。
 * 种子是定义的一部分：同一题每次运行看到同一份数据（题集当固定的，见设计稿“怎么算接近”）。
 *
 * `taskVersion` 盖住“执行者看到的东西”：任务原文与设置、站点模块、它的页面与资源、站点共用的服务与零件，改了任何一处
 * 版本就变，旧运行不再与新的放在一起算（续跑与报表都按版本拒收）。判分逻辑不进版本：报表总按当前的规则对运行记录重判，
 * 修判分不必重跑。上面这些都没变、又要让旧运行作废时（少见），把 `revision` 加 1。
 */

import {createHash} from "node:crypto";
import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";

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

const SITES_DIR = join(import.meta.dir, "../sites");
/** 每个站都用到的部件：改了它们，每个站给执行者看的东西都可能变。 */
const SHARED_SITE_FILES = ["server.ts", "kit.ts", "assets.ts"];
const siteHashes = new Map<string, string>();

/** 一个站点的源文件（站点模块、页面与资源、共用部件）的内容哈希；同一目录同一站在进程里只算一次。 */
export function siteSourceHash(site: string, dir: string = SITES_DIR): string {
    const key = `${dir}\0${site}`;
    const cached = siteHashes.get(key);
    if (cached !== undefined) return cached;
    const pages = readdirSync(join(dir, "pages", site), {recursive: true, withFileTypes: true})
        .filter((entry) => entry.isFile())
        .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1));
    const hash = createHash("sha256");
    for (const file of [...SHARED_SITE_FILES, `${site}.ts`, ...pages].sort()) hash.update(file).update("\0").update(readFileSync(join(dir, file))).update("\0");
    const digest = hash.digest("hex");
    siteHashes.set(key, digest);
    return digest;
}

/** 任务的版本：原文（地址换成占位）、种子、修订号、类型、允许的写接口、时限、条目与权重，加上站点源文件的哈希。 */
export function taskVersion(task: TaskDefinition): string {
    const body = JSON.stringify({id: task.id, site: task.site.name, seed: task.seed, revision: task.revision, kind: task.kind, allowedWrites: task.allowedWrites, timeLimitSec: task.timeLimitSec, instruction: task.instruction({main: "{main}", editor: "{editor}"}), items: task.items.map((item) => [item.id, item.weight]), siteSource: siteSourceHash(task.site.name)});
    return createHash("sha256").update(body).digest("hex").slice(0, 16);
}
