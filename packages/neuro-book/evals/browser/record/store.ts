/**
 * 运行目录的布局与续跑：`<out>/<taskId>/<model>/<arm>/a<attempt>/try-<n>/`。
 *
 * 一次重复（attempt）可能有几回实际运行（try）：评测部件或上游出错时重跑一回，旧的保留，最多 `MAX_TRIES` 回。
 * 续跑只看每个 attempt 最后一回：它有计分的结局就算完成；不计分、或中途被打断（没有 score.json）就再跑一回。
 *
 * 一回运行的目录里，`job/`、`workspace/`、`executor/` 绑进执行者的沙箱（只读、可写、可写），其余文件只由调度器写，
 * 执行者写不到；所以续跑看到的 `score.json` 一定是调度器写的。
 */

import {mkdir, readdir, readFile, rename, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";

import type {Static, TSchema} from "typebox";
import {Value} from "typebox/value";

import {isCounted} from "./outcome";
import {ScoreSchema} from "./schema";
import type {Arm} from "./schema";

/** 一个 attempt 最多跑几回（首回加 3 回重跑）。 */
export const MAX_TRIES = 4;

export interface AttemptKey {
    readonly taskId: string;
    readonly model: string;
    readonly arm: Arm;
    readonly attempt: number;
}

const SEGMENT = /^[a-z0-9][a-z0-9._-]*$/u;

function segment(value: string, label: string): string {
    if (!SEGMENT.test(value)) throw new Error(`${label} is not a safe path segment: ${JSON.stringify(value)}`);
    return value;
}

export function attemptDir(out: string, key: AttemptKey): string {
    if (!Number.isInteger(key.attempt) || key.attempt < 1) throw new Error(`attempt must be a positive integer: ${key.attempt}`);
    return join(out, segment(key.taskId, "taskId"), segment(key.model, "model"), segment(key.arm, "arm"), `a${key.attempt}`);
}

/** 一回运行目录里的各个位置。 */
export function tryLayout(dir: string) {
    return {
        dir,
        job: join(dir, "job"),
        workspace: join(dir, "workspace"),
        executor: join(dir, "executor"),
        shots: join(dir, "shots"),
        ready: join(dir, "ready.json"),
        progress: join(dir, "progress.jsonl"),
        stdout: join(dir, "executor-stdout.jsonl"),
        stderr: join(dir, "executor-stderr.txt"),
        record: join(dir, "record.json"),
        score: join(dir, "score.json"),
    } as const;
}

export type TryLayout = ReturnType<typeof tryLayout>;

export function tryDir(attempt: string, n: number): string {
    return join(attempt, `try-${n}`);
}

export type AttemptState =
    | {readonly kind: "settled"; readonly try: number}
    | {readonly kind: "run"; readonly nextTry: number}
    | {readonly kind: "exhausted"; readonly tries: number};

/** 这个 attempt 还要不要跑、下一回是第几回。 */
export async function attemptState(attempt: string): Promise<AttemptState> {
    let names: string[];
    try {
        names = await readdir(attempt);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return {kind: "run", nextTry: 1};
        throw error;
    }
    const tries = names.map((name) => /^try-(\d+)$/u.exec(name)?.[1]).filter((n): n is string => n !== undefined).map(Number);
    if (tries.length === 0) return {kind: "run", nextTry: 1};
    const latest = Math.max(...tries);
    const score = await readJson(join(tryDir(attempt, latest), "score.json"), ScoreSchema);
    if (score !== null && isCounted(score.outcome)) return {kind: "settled", try: latest};
    return latest >= MAX_TRIES ? {kind: "exhausted", tries: latest} : {kind: "run", nextTry: latest + 1};
}

/** 先写同目录的临时文件再改名：中途被打断时，读的人看到的要么是旧文件，要么是完整的新文件。 */
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), {recursive: true});
    const temp = join(dirname(path), `.${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}.tmp`);
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
    await rename(temp, path);
}

/** 读一个 JSON 文件并按 schema 校验；文件不在为 null，形状不对抛错（不悄悄当成没有）。 */
export async function readJson<S extends TSchema>(path: string, schema: S): Promise<Static<S> | null> {
    let text: string;
    try {
        text = await readFile(path, "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
    }
    const value: unknown = JSON.parse(text);
    if (!Value.Check(schema, value)) {
        const first = [...Value.Errors(schema, value)][0];
        throw new Error(`${path} does not match its schema: ${first === undefined ? "unknown" : `${first.instancePath} ${first.message}`}`);
    }
    return value;
}
