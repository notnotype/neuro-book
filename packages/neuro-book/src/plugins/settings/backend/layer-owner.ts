/**
 * 一层的拥有者（docs/specs/settings/configuration.md 输出 4、5、9–14、18、19，“状态与转换”）：读文件、逐键校验、维护
 * 层快照、串行处理重读与写入、监视外部修改。本实例的入口与别的实例（经远程服务）都经它写入，两条路一样按内核
 * 填写的调用方身份核对声明者；用户编辑只经远程服务到达，核对调用方是不是拥有者自己的插件。
 *
 * 重读与写入在同一个串行队列里：较早开始的重读不会在写入之后发布旧内容。写入成功后立即按新文本发布，监视器随后
 * 带回的同一内容比较后不再发布（输出 10）。
 *
 * 整份读写（`readText`、`writeText`，输出 24）也排在这个队列里。文本的修订号是原始文本的摘要，与层快照的修订号分开：
 * 层快照只在解析结果变了时换，只改注释、格式时不换；文本的修订号随任何文本变化换，经 `subscribeText` 通知设置文件视图。
 */

import {createHash, randomUUID} from "node:crypto";


import type {DiagnosticsService} from "@notnotype/nb-runtime/diagnostics";
import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";
import type {ConsumerIdentity} from "@notnotype/nb-runtime/services";

import type {SettingLayer, SettingsFailure, WrittenSettingDeclaration} from "nbook/shared/settings";

import {canonical, expectationHolds, sameContent, userEditProblem, writeProblem} from "../shared/layers";
import type {DeclaredSetting, LayerContent, LayerEdit, LayerProblem, LayerSnapshot, LayerTextRead, LayerTextWrite, LayerWriteResult, WriteProblem} from "../shared/layers";
import {readLayerFile, writeLayerFile} from "./layer-file";
import {editLayerText, parseLayerText} from "../shared/layer-text";
import {watchLayer} from "./layer-watch";
import type {LayerWatch} from "./layer-watch";

/** 最后一次文件事件之后静止多久再重读（VS Code 的用户配置同样以 50 毫秒合并）。 */
export const RELOAD_DELAY_MS = 50;

export interface LayerOwnerOptions {
    readonly path: string;
    readonly layer: SettingLayer;
    /** 每次重读与写入时取当前已接受的声明。 */
    readonly declarations: () => ReadonlyMap<string, DeclaredSetting>;
    readonly clock: RuntimeClock;
    readonly diagnostics: DiagnosticsService;
    /** 拥有这一层的插件（`nbook.settings`）：诊断记在它名下，用户编辑只接受它自己、没有经过代理的请求。 */
    readonly source: string;
    /** 写进层快照的文件路径（configuration.md 输出 23）；缺省时快照不带路径。 */
    readonly shownPath?: string;
}

export type OwnerWriteResult = LayerWriteResult;

/** 文本的修订号：文件原始字节的 SHA-256（给字符串时按 UTF-8 编码）。文件不存在时就是空字节的摘要。 */
export function textRevision(content: string | Uint8Array): string {
    return typeof content === "string" ? createHash("sha256").update(content, "utf8").digest("hex") : createHash("sha256").update(content).digest("hex");
}

/** 是不是合法的 UTF-8：整份读写只处理合法的文本，替换字符会让写回改掉用户文件里的字节。 */
function isUtf8(bytes: Uint8Array): boolean {
    try {
        new TextDecoder("utf-8", {fatal: true}).decode(bytes);
        return true;
    } catch {
        return false;
    }
}

export interface LayerOwner {
    /** 第一次读完并开始监视后完成；之前 `snapshot()` 是空层。 */
    readonly ready: Promise<void>;
    snapshot(): LayerSnapshot;
    /** 之后的每次发布调用一次；返回取消函数。 */
    subscribe(listener: (snapshot: LayerSnapshot) => void): () => void;
    /** 声明者的写入：只写调用方插件自己声明的项（输出 11）。 */
    write(consumer: ConsumerIdentity, key: string, edit: LayerEdit): Promise<OwnerWriteResult>;
    /** 用户编辑：写任何已声明项，调用方必须是 `source` 插件自己、没有经过代理（输出 19）。 */
    userEdit(consumer: ConsumerIdentity, key: string, edit: LayerEdit): Promise<OwnerWriteResult>;
    /** 整份读这一层的文件（输出 24）；调用方的核对同用户编辑。 */
    readText(consumer: ConsumerIdentity): Promise<LayerTextRead>;
    /** 整份写：`revision` 是读出时的修订号，文件之后被改过为 `conflict`；文本不合格为 `invalid-text`，带位置。 */
    writeText(consumer: ConsumerIdentity, text: string, revision: string): Promise<LayerTextWrite>;
    /** 当前文本的修订号；第一次读完之前为 null。 */
    textRevision(): string | null;
    /** 之后文本每变一次调用一次；返回取消函数。 */
    subscribeText(listener: (revision: string) => void): () => void;
    /** 拒绝新的读写，等已接纳的写入结算，关闭监视。幂等。 */
    close(): Promise<void>;
}

export function createLayerOwner(options: LayerOwnerOptions): LayerOwner {
    const boot = randomUUID();
    let seq = 0;
    const located = options.shownPath === undefined ? {} : {path: options.shownPath};
    let current: LayerSnapshot = {status: "ok", revision: {boot, seq}, values: Object.freeze({}), problems: Object.freeze([]), ...located};
    const listeners = new Set<(snapshot: LayerSnapshot) => void>();
    let currentText: string | null = null;
    const textListeners = new Set<(revision: string) => void>();
    let closed = false;
    let closing: Promise<void> | null = null;
    /** 已经记过诊断的被丢弃键（规范化文本）：同一份文件内容只记一次。 */
    let reportedProblems = canonical([]);

    const record = (level: "info" | "warn", event: string, message: string, data?: unknown, error?: unknown): void => {
        options.diagnostics.record({level, event, message, data, error, source: {plugin: options.source}});
    };

    /** 队列里的任务不抛：意外异常记诊断，免得一个任务卡住后面的。 */
    const enqueue = <T>(task: () => Promise<T>, fallback: T): Promise<T> => {
        const run = tail.then(task).catch((error: unknown) => {
            record("warn", "settings.layer.task-failed", "Reading or writing the settings layer failed", {layer: options.layer}, error);
            return fallback;
        });
        tail = run;
        return run;
    };

    /** 内容变了才换修订号、发布；返回当前快照。 */
    const publish = (next: LayerContent): LayerSnapshot => {
        if (sameContent(next, current)) return current;
        seq += 1;
        current = Object.freeze({...next, ...located, revision: Object.freeze({boot, seq})});
        for (const listener of [...listeners]) {
            try {
                listener(current);
            } catch (error) {
                record("warn", "settings.layer.listener-failed", "A settings layer subscription failed", {layer: options.layer}, error);
            }
        }
        return current;
    };

    /** 读到或写成了这份文本（原始字节，或刚写下的文本）：修订号变了就通知设置文件视图。 */
    const noteText = (content: string | Uint8Array): void => {
        const revision = textRevision(content);
        if (revision === currentText) return;
        currentText = revision;
        for (const listener of [...textListeners]) {
            try {
                listener(revision);
            } catch (error) {
                record("warn", "settings.layer.listener-failed", "A settings layer subscription failed", {layer: options.layer}, error);
            }
        }
    };

    /** 由文件文本算出下一份快照：无效时保留上一份有效内容；被丢弃的键同一份内容只记一次诊断。 */
    const fromText = (text: string): LayerContent => {
        const parsed = parseLayerText(text, keysOf(options.declarations()), options.layer);
        if (parsed.status === "invalid") return {status: "invalid", values: current.values, problems: current.problems, detail: parsed.detail, reason: parsed.reason, position: parsed.position};
        reportProblems(parsed.problems);
        return {status: "ok", values: parsed.values, problems: parsed.problems};
    };

    const reportProblems = (problems: ReadonlyArray<LayerProblem>): void => {
        const text = canonical(problems);
        if (text === reportedProblems) return;
        reportedProblems = text;
        if (problems.length > 0) record("warn", "settings.layer.dropped", "Keys in the settings file were dropped", {layer: options.layer, problems});
    };

    const reload = async (): Promise<void> => {
        if (closed) return;
        const read = await readLayerFile(options.path);
        if (read.ok) noteText(read.bytes);
        const before = current;
        const next: LayerContent = read.ok ? fromText(read.text) : {status: "invalid", values: current.values, problems: current.problems, detail: read.detail};
        const after = publish(next);
        if (after !== before) {
            const changed = changedKeys(before.values, after.values);
            if (after.status === "invalid" && before.status === "ok") record("warn", "settings.layer.invalid", "The settings file is now invalid; keeping the last valid content", {layer: options.layer, detail: after.status === "invalid" ? after.detail : ""});
            if (changed.length > 0) record("info", "settings.layer.changed", "The settings file was changed externally", {layer: options.layer, keys: changed});
        }
    };

    const report = (event: string, error: unknown): void => record("warn", event, "Reading, writing or watching the settings file failed", {layer: options.layer}, error);
    let watcher: LayerWatch | null = null;
    const ready = (async () => {
        // 先监视、再读：读之后才开始监视的话，中间的修改会漏掉。
        watcher = watchLayer({path: options.path, clock: options.clock, delayMs: RELOAD_DELAY_MS, onChange: () => void enqueue(reload, undefined), report});
        await watcher.started;
        await reload();
    })();
    /** 串行队列的尾：第一次读完之前接纳的写入排在它后面。 */
    let tail: Promise<unknown> = ready.catch(() => undefined);

    const write = async (consumer: ConsumerIdentity, key: string, edit: LayerEdit): Promise<OwnerWriteResult> => {
        const result = await admitAndWrite(key, edit, () => writeProblem(consumer.plugin, key, options.declarations().get(key), edit, options.layer));
        record(result.ok ? "info" : "warn", "settings.write", "Setting written", {key, layer: options.layer, plugin: consumer.plugin, via: consumer.via?.plugin ?? null, code: result.ok ? "ok" : result.code});
        return result;
    };

    /** 用户编辑不核对声明者，调用方是这条路径唯一的授权：先于其它核对，别的调用方不论输入一律 denied。 */
    const userEditDenied = (consumer: ConsumerIdentity): WriteProblem | null => {
        if (consumer.plugin === options.source && consumer.via === null) return null;
        return {code: "denied", detail: `用户编辑只接受 ${options.source} 自己、没有经过代理的请求`};
    };

    const userEdit = async (consumer: ConsumerIdentity, key: string, edit: LayerEdit): Promise<OwnerWriteResult> => {
        const result = await admitAndWrite(key, edit, () => userEditDenied(consumer) ?? userEditProblem(key, options.declarations().get(key), edit, options.layer));
        record(result.ok ? "info" : "warn", "settings.write", "Setting written (user edit)", {key, layer: options.layer, plugin: consumer.plugin, via: consumer.via?.plugin ?? null, code: result.ok ? "ok" : result.code, userEdit: true});
        return result;
    };

    const admitAndWrite = (key: string, edit: LayerEdit, admission: () => WriteProblem | null): Promise<OwnerWriteResult> | OwnerWriteResult => {
        if (closed) return {ok: false, code: "unavailable", detail: "配置层的拥有者已停止"};
        const problem = admission();
        if (problem !== null) return {ok: false, ...problem};
        // 核对通过即接纳：同步排进队列，之后的停止会等它走完（“时序与寿命”第 4 条）。
        return enqueue(async (): Promise<OwnerWriteResult> => {
            const written = await writeLayerFile(options.path, (text) => {
                // 以磁盘上的当前文本为准：层快照可能还没跟上刚修好或刚改坏的文件。
                const parsed = parseLayerText(text, keysOf(options.declarations()), options.layer);
                if (parsed.status === "invalid") return {ok: false, code: "layer-invalid", detail: `配置文件当前无效：${parsed.detail}`};
                if (!expectationHolds(edit.expect, parsed.values, key)) return {ok: false, code: "conflict", detail: `配置项 ${key} 的当前值不是期望的值`};
                const edited = editLayerText(text, key, edit);
                return edited.ok ? edited : {ok: false, code: "write-failed", detail: edited.detail};
            }, report);
            if (!written.ok) {
                // 写入前读到的文件可能与快照不同（例如刚被改坏）：按它更新快照，免得别处还以为能写。
                if (written.code === "layer-invalid") await reload();
                return {ok: false, code: written.code as SettingsFailure, detail: written.detail};
            }
            noteText(written.text);
            return {ok: true, snapshot: publish(fromText(written.text))};
        }, {ok: false, code: "write-failed", detail: "配置写入出错"});
    };

    const readText = async (consumer: ConsumerIdentity): Promise<LayerTextRead> => {
        if (closed) return {ok: false, code: "unavailable", detail: "配置层的拥有者已停止"};
        const denied = userEditDenied(consumer);
        if (denied !== null) return {ok: false, ...denied};
        return enqueue(async (): Promise<LayerTextRead> => {
            const read = await readLayerFile(options.path);
            if (!read.ok) return {ok: false, code: "read-failed", detail: read.detail};
            noteText(read.bytes);
            if (!isUtf8(read.bytes)) return {ok: false, code: "read-failed", detail: "设置文件不是合法的 UTF-8 文本"};
            return {ok: true, text: read.text, revision: textRevision(read.bytes), exists: read.exists};
        }, {ok: false, code: "read-failed", detail: "读取设置文件出错"});
    };

    const writeText = async (consumer: ConsumerIdentity, text: string, revision: string): Promise<LayerTextWrite> => {
        if (closed) return {ok: false, code: "unavailable", detail: "配置层的拥有者已停止"};
        const denied = userEditDenied(consumer);
        if (denied !== null) return {ok: false, ...denied};
        const result = await enqueue(async (): Promise<LayerTextWrite> => {
            // 比对与解析都以磁盘上的当前文本为准：`writeLayerFile` 持锁后会用锁里读到的文本再做一次。
            const written = await writeLayerFile(options.path, (_current, bytes) => {
                if (textRevision(bytes) !== revision) return {ok: false, code: "conflict", detail: "文件在读出之后被别处改过"};
                const parsed = parseLayerText(text, keysOf(options.declarations()), options.layer);
                if (parsed.status === "invalid") return {ok: false, code: "invalid-text", detail: parsed.reason, position: parsed.position};
                return {ok: true, text};
            }, report);
            if (!written.ok) return {ok: false, code: written.code as SettingsFailure, detail: written.detail, ...(written.position === undefined ? {} : {position: written.position})};
            noteText(written.text);
            return {ok: true, revision: textRevision(written.text), snapshot: publish(fromText(written.text))};
        }, {ok: false, code: "write-failed", detail: "配置写入出错"});
        record(result.ok ? "info" : "warn", "settings.write", "Settings file written whole", {layer: options.layer, plugin: consumer.plugin, code: result.ok ? "ok" : result.code, text: true});
        return result;
    };

    return {
        ready,
        snapshot: () => current,
        subscribe: (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        write,
        userEdit,
        readText,
        writeText,
        textRevision: () => currentText,
        subscribeText: (listener) => {
            textListeners.add(listener);
            return () => {
                textListeners.delete(listener);
            };
        },
        close: () => {
            closing ??= (async () => {
                closed = true;
                watcher?.close();
                listeners.clear();
                textListeners.clear();
                await tail;
            })();
            return closing;
        },
    };
}

function keysOf(declarations: ReadonlyMap<string, DeclaredSetting>): ReadonlyMap<string, WrittenSettingDeclaration> {
    return new Map([...declarations].map(([key, declared]) => [key, declared.declaration]));
}

function changedKeys(before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>): string[] {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].filter((key) => canonical(before[key]) !== canonical(after[key])).sort();
}
