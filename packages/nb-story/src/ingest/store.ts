/**
 * 抽取记录（docs/specs/story/ingest.md 的“副作用与数据”）：`<书库>/.ingest/<书 id>/` 里放原文、用量与瞬时状态；
 * `<书库>/.locks/<书 id>.lock` 是这个 id 的抽取锁。
 *
 * 这里没有任何“已提交”的事实：提交到第几章、已提交的草稿与整理结果都在书目录里，跟书的数据在同一次改名里生效
 * （core/library.ts 的 commitExtraction）。所以进程在任何时刻被杀，这里的内容与书都不会互相矛盾：state.json 落后了
 * 只是显示旧的步骤，进度永远以书为准（status.ts）。
 *
 *   source.json    切好的原文与书名；有它即占用这个 id（第 1 章还没提交也算）
 *   usage.jsonl    每次 HTTP 尝试两行，只追加：发出前一行“开始”，结束后一行“结算”（用量、当时的单价）。只有开始
 *                  没有结算的，是进程在这次请求中途被杀：用量不知道，合计标为不完整
 *   activity.jsonl 任务与每章每次尝试的起止时间，只追加：用时按它算，作废的尝试也算在内
 *   state.json     瞬时状态：由谁运行、当前章与步骤、在等的重试、停下的原因
 *   bad-replies/   一步的回复两次都不成形时留下的原文（诊断用，里面有小说原文，不进状态与输出），最多留最近 20 个
 *
 * 锁文件放在不随抽取记录删除的 `.locks/` 里：flock 锁的是 inode，锁文件跟着记录一起删掉再建，就会出现两把互不
 * 排他的锁（w00024 t06 计划审查第 3 条）。
 */

import {randomUUID} from "node:crypto";
import {appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {tryLock, type FileLock} from "@notnotype/nb-flock";

import type {BookFeatures, SourceChapter} from "../core/dataset";
import {StoryError, systemErrorCode} from "../core/errors";
import type {Library} from "../core/library";
import type {BadReplyRecord, Step} from "./chapter";

export interface IngestSource {
    id: string;
    title: string;
    chapters: SourceChapter[];
    preambleChars: number;
    volumeLines: number;
    createdAt: string;
    /** 新建时定下的开关（w00024 t11 起写），之后不改。没有时按都开算（`featuresOf`）。 */
    features?: BookFeatures;
}

export type Price = {input: number; output: number; cacheRead?: number; currency: string};

/** 一次 HTTP 尝试的用量记账：发出前写 `start`，结束后写 `end`（同一个 `id`）。价格记下当时的，以后改了配置也不改历史费用。 */
export type UsageLine =
    | {kind: "start"; id: string; run: string; chapter: number; step: Step; attempt: number; at: string}
    | {kind: "end"; id: string; run: string; chapter: number; step: Step; attempt: number; at: string; ms: number; input: number; output: number; cacheRead: number; complete: boolean; error: string | null; price: Price | null};

/** 任务与每章每次尝试的起止。章的 `outcome`：提交、停下、失败。 */
export type ActivityLine =
    | {kind: "run-start"; run: string; at: string}
    | {kind: "run-end"; run: string; at: string}
    | {kind: "chapter-start"; run: string; chapter: number; at: string}
    | {kind: "chapter-end"; run: string; chapter: number; at: string; outcome: "committed" | "stopped" | "failed"};

export type RunnerKind = "cli" | "serve";

/** 停下的原因：用户停止、失败（码与归类）、运行它的进程已退出。 */
export type StopReason = {kind: "user"} | {kind: "failed"; code: string; errorKind?: string; message: string} | {kind: "exited"};

export interface IngestState {
    /** 这次任务的编号：用量按它分“这次”与“历次”。 */
    run: string;
    runner: RunnerKind;
    pid: number;
    startedAt: string;
    /** `running` 只是“写下时在运行”；是否真在运行以锁为准（status.ts）。 */
    state: "running" | "stopped";
    chapter: number | null;
    step: Step | null;
    retry: {attempt: number; waitMs: number; until: string} | null;
    stopReason: StopReason | null;
    updatedAt: string;
}

const isMissing = (error: unknown) => systemErrorCode(error) === "ENOENT" || systemErrorCode(error) === "ENOTDIR";

/** `bad-replies/` 里最多留几个文件。 */
export const BAD_REPLY_KEEP = 20;

export class IngestStore {
    readonly #library: Library;
    readonly id: string;

    constructor(library: Library, id: string) {
        this.#library = library;
        this.id = id;
    }

    get dir(): string {
        return this.#library.ingestDir(this.id);
    }

    /** 拿这个 id 的抽取锁；别的任务（本进程或别的进程）正在运行时返回 null。 */
    async tryLock(): Promise<FileLock | null> {
        const dir = join(this.#library.root, ".locks");
        await mkdir(dir, {recursive: true});
        return tryLock(join(dir, `${this.id}.lock`));
    }

    async readSource(): Promise<IngestSource | null> {
        try {
            return JSON.parse(await readFile(join(this.dir, "source.json"), "utf8")) as IngestSource;
        } catch (error) {
            if (isMissing(error)) return null;
            throw error;
        }
    }

    /**
     * 占用这个 id：原文写进临时目录，整个改名成抽取记录目录。调用方持这个 id 的锁，导入也要拿同一把锁，所以这里看到
     * 没有同 id 的书，改名之前就不会冒出来。
     */
    async claim(source: IngestSource): Promise<void> {
        const book = await this.#library.readMeta(this.id).then(() => true, (error: unknown) => {
            if (error instanceof StoryError && error.code === "book_not_found") return false;
            throw error;
        });
        if (book) throw new StoryError("book_exists", `书 id ${this.id} 已被导入占用`);
        const parent = join(this.#library.root, ".ingest");
        await mkdir(parent, {recursive: true});
        const staging = join(parent, `.claim-${randomUUID()}`);
        await mkdir(staging);
        try {
            await writeFile(join(staging, "source.json"), JSON.stringify(source));
            await rename(staging, this.dir);
        } catch (error) {
            await rm(staging, {recursive: true, force: true});
            const code = systemErrorCode(error);
            if (code === "ENOTEMPTY" || code === "EEXIST") throw new StoryError("book_exists", `书 id ${this.id} 已被占用`, {cause: error});
            throw error;
        }
    }

    /** 追加新章：整份替换 source.json。调用方持锁。 */
    async replaceSource(source: IngestSource): Promise<void> {
        const temp = join(this.dir, `source.json.${randomUUID()}.tmp`);
        await writeFile(temp, JSON.stringify(source));
        await rename(temp, join(this.dir, "source.json"));
    }

    async appendUsage(line: UsageLine): Promise<void> {
        await appendFile(join(this.dir, "usage.jsonl"), `${JSON.stringify(line)}\n`);
    }

    async appendActivity(line: ActivityLine): Promise<void> {
        await appendFile(join(this.dir, "activity.jsonl"), `${JSON.stringify(line)}\n`);
    }

    readUsage(): Promise<UsageLine[]> {
        return this.readLines<UsageLine>("usage.jsonl");
    }

    readActivity(): Promise<ActivityLine[]> {
        return this.readLines<ActivityLine>("activity.jsonl");
    }

    private async readLines<T>(name: string): Promise<T[]> {
        try {
            const text = await readFile(join(this.dir, name), "utf8");
            // 进程在写一行的中间被杀，最后一行可能不完整：只取完整的行。
            return text.split("\n").flatMap(line => {
                if (line === "") return [];
                try {
                    return [JSON.parse(line) as T];
                } catch {
                    return [];
                }
            });
        } catch (error) {
            if (isMissing(error)) return [];
            throw error;
        }
    }

    async writeState(state: IngestState): Promise<void> {
        const temp = join(this.dir, `state.json.${randomUUID()}.tmp`);
        await writeFile(temp, JSON.stringify(state));
        await rename(temp, join(this.dir, "state.json"));
    }

    /**
     * 存一份坏回复，返回它相对书库的路径。先写临时文件再改名，强杀时留下的要么是旧的完整文件、要么是新的完整文件；
     * 写完后把最旧的多余文件删到只剩 `BAD_REPLY_KEEP` 个。它只是诊断：调用方拿到异常时不让抽取失败（job.ts）。
     */
    async writeBadReply(record: BadReplyRecord): Promise<string> {
        const dir = join(this.dir, "bad-replies");
        await mkdir(dir, {recursive: true});
        const name = `${record.chapter}-${record.step}${record.subject ? `-${record.subject}` : ""}.json`;
        const temp = join(dir, `${name}.${randomUUID()}.tmp`);
        await writeFile(temp, JSON.stringify(record, null, 2));
        await rename(temp, join(dir, name));
        // 文件已经发布：清理多余的旧文件出了岔子（并发删除、磁盘错误）不能让调用方以为这一份没留下。同一本书的任务由 id 锁
        // 保证只有一个，所以不会有两个清理者；按 mtime 排序只是“最近写下”的近似，不求精确。
        try {
            const kept = await Promise.all((await readdir(dir)).filter(file => file.endsWith(".json")).map(async file => ({file, at: (await stat(join(dir, file))).mtimeMs})));
            kept.sort((a, b) => b.at - a.at || (a.file < b.file ? -1 : 1));
            for (const old of kept.slice(BAD_REPLY_KEEP)) await rm(join(dir, old.file), {force: true});
        } catch (error) {
            console.error(`清理 ${this.id} 的旧坏回复失败：${error instanceof Error ? error.message : String(error)}`);
        }
        return join(".ingest", this.id, "bad-replies", name);
    }

    async readState(): Promise<IngestState | null> {
        try {
            return JSON.parse(await readFile(join(this.dir, "state.json"), "utf8")) as IngestState;
        } catch (error) {
            if (isMissing(error)) return null;
            throw error;
        }
    }

}
