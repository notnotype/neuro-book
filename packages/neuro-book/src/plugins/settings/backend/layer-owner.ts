/**
 * 一层的拥有者（docs/specs/settings/configuration.md 输出 4、5、9–14、18，“状态与转换”）：读文件、逐键校验、维护
 * 层快照、串行处理重读与写入、监视外部修改。本实例的入口与别的实例（经远程服务）都经它写入，两条路一样按内核
 * 填写的调用方身份核对声明者。
 *
 * 重读与写入在同一个串行队列里：较早开始的重读不会在写入之后发布旧内容。写入成功后立即按新文本发布，监视器随后
 * 带回的同一内容比较后不再发布（输出 10）。
 */

import {randomUUID} from "node:crypto";

import {Value} from "typebox/value";

import type {DiagnosticsService} from "@notnotype/nb-runtime/diagnostics";
import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";
import type {ConsumerIdentity} from "@notnotype/nb-runtime/services";

import {isJson} from "nbook/shared/settings";
import type {SettingDeclaration, SettingLayer, SettingsFailure} from "nbook/shared/settings";

import {canonical, sameContent} from "../shared/layers";
import type {LayerContent, LayerProblem, LayerSnapshot} from "../shared/layers";
import {readLayerFile, writeLayerFile} from "./layer-file";
import {editLayerText, parseLayerText} from "./layer-text";
import type {LayerEdit} from "./layer-text";
import {watchLayer} from "./layer-watch";
import type {LayerWatch} from "./layer-watch";

/** 最后一次文件事件之后静止多久再重读（VS Code 的用户配置同样以 50 毫秒合并）。 */
export const RELOAD_DELAY_MS = 50;

/** 一条已接受的声明与它的声明者。 */
export interface DeclaredSetting {
    readonly plugin: string;
    readonly declaration: SettingDeclaration;
}

export interface LayerOwnerOptions {
    readonly path: string;
    readonly layer: SettingLayer;
    /** 每次重读与写入时取当前已接受的声明。 */
    readonly declarations: () => ReadonlyMap<string, DeclaredSetting>;
    readonly clock: RuntimeClock;
    readonly diagnostics: DiagnosticsService;
    readonly source: string;
}

export type OwnerWriteResult = {readonly ok: true; readonly snapshot: LayerSnapshot} | {readonly ok: false; readonly code: SettingsFailure; readonly detail: string};

export interface LayerOwner {
    /** 第一次读完并开始监视后完成；之前 `snapshot()` 是空层。 */
    readonly ready: Promise<void>;
    snapshot(): LayerSnapshot;
    /** 之后的每次发布调用一次；返回取消函数。 */
    subscribe(listener: (snapshot: LayerSnapshot) => void): () => void;
    write(consumer: ConsumerIdentity, key: string, edit: LayerEdit): Promise<OwnerWriteResult>;
    /** 拒绝新的读写，等已接纳的写入结算，关闭监视。幂等。 */
    close(): Promise<void>;
}

export function createLayerOwner(options: LayerOwnerOptions): LayerOwner {
    const boot = randomUUID();
    let seq = 0;
    let current: LayerSnapshot = {status: "ok", revision: {boot, seq}, values: Object.freeze({}), problems: Object.freeze([])};
    const listeners = new Set<(snapshot: LayerSnapshot) => void>();
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
            record("warn", "settings.layer.task-failed", "配置层的读写出错", {layer: options.layer}, error);
            return fallback;
        });
        tail = run;
        return run;
    };

    /** 内容变了才换修订号、发布；返回当前快照。 */
    const publish = (next: LayerContent): LayerSnapshot => {
        if (sameContent(next, current)) return current;
        seq += 1;
        current = Object.freeze({...next, revision: Object.freeze({boot, seq})});
        for (const listener of [...listeners]) {
            try {
                listener(current);
            } catch (error) {
                record("warn", "settings.layer.listener-failed", "配置层的订阅出错", {layer: options.layer}, error);
            }
        }
        return current;
    };

    /** 由文件文本算出下一份快照：无效时保留上一份有效内容；被丢弃的键同一份内容只记一次诊断。 */
    const fromText = (text: string): LayerContent => {
        const parsed = parseLayerText(text, keysOf(options.declarations()), options.layer);
        if (parsed.status === "invalid") return {status: "invalid", values: current.values, problems: current.problems, detail: parsed.detail};
        reportProblems(parsed.problems);
        return {status: "ok", values: parsed.values, problems: parsed.problems};
    };

    const reportProblems = (problems: ReadonlyArray<LayerProblem>): void => {
        const text = canonical(problems);
        if (text === reportedProblems) return;
        reportedProblems = text;
        if (problems.length > 0) record("warn", "settings.layer.dropped", "配置文件里有键被丢弃", {layer: options.layer, problems});
    };

    const reload = async (): Promise<void> => {
        if (closed) return;
        const read = await readLayerFile(options.path);
        const before = current;
        const next: LayerContent = read.ok ? fromText(read.text) : {status: "invalid", values: current.values, problems: current.problems, detail: read.detail};
        const after = publish(next);
        if (after !== before) {
            const changed = changedKeys(before.values, after.values);
            if (after.status === "invalid" && before.status === "ok") record("warn", "settings.layer.invalid", "配置文件当前无效，保留上一份有效内容", {layer: options.layer, detail: after.status === "invalid" ? after.detail : ""});
            if (changed.length > 0) record("info", "settings.layer.changed", "配置文件被外部修改", {layer: options.layer, keys: changed});
        }
    };

    const report = (event: string, error: unknown): void => record("warn", event, "配置文件的读写或监视出错", {layer: options.layer}, error);
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
        const result = await admitAndWrite(consumer, key, edit);
        record(result.ok ? "info" : "warn", "settings.write", "配置写入", {key, layer: options.layer, plugin: consumer.plugin, via: consumer.via?.plugin ?? null, code: result.ok ? "ok" : result.code});
        return result;
    };

    const admitAndWrite = (consumer: ConsumerIdentity, key: string, edit: LayerEdit): Promise<OwnerWriteResult> | OwnerWriteResult => {
        if (closed) return {ok: false, code: "unavailable", detail: "配置层的拥有者已停止"};
        const declared = options.declarations().get(key);
        if (declared === undefined) return {ok: false, code: "undeclared", detail: `配置项 ${key} 没有被接受的声明`};
        if (consumer.plugin !== declared.plugin) return {ok: false, code: "denied", detail: `配置项 ${key} 由 ${declared.plugin} 声明，${consumer.plugin ?? "宿主"} 不能写`};
        if (edit.kind === "set" && (!isJson(edit.value) || !Value.Check(declared.declaration.schema, edit.value))) return {ok: false, code: "invalid-value", detail: `值不符合配置项 ${key} 的 schema`};
        if (!declared.declaration.layers.includes(options.layer)) return {ok: false, code: "layer-not-allowed", detail: `配置项 ${key} 不允许写 ${options.layer} 层`};
        // 核对通过即接纳：同步排进队列，之后的停止会等它走完（“时序与寿命”第 4 条）。
        return enqueue(async (): Promise<OwnerWriteResult> => {
            const written = await writeLayerFile(options.path, (text) => {
                // 以磁盘上的当前文本为准：层快照可能还没跟上刚修好或刚改坏的文件。
                const parsed = parseLayerText(text, keysOf(options.declarations()), options.layer);
                if (parsed.status === "invalid") return {ok: false, code: "layer-invalid", detail: `配置文件当前无效：${parsed.detail}`};
                const edited = editLayerText(text, key, edit);
                return edited.ok ? edited : {ok: false, code: "write-failed", detail: edited.detail};
            }, report);
            if (!written.ok) {
                // 写入前读到的文件可能与快照不同（例如刚被改坏）：按它更新快照，免得别处还以为能写。
                if (written.code === "layer-invalid") await reload();
                return {ok: false, code: written.code as SettingsFailure, detail: written.detail};
            }
            return {ok: true, snapshot: publish(fromText(written.text))};
        }, {ok: false, code: "write-failed", detail: "配置写入出错"});
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
        close: () => {
            closing ??= (async () => {
                closed = true;
                watcher?.close();
                listeners.clear();
                await tail;
            })();
            return closing;
        },
    };
}

function keysOf(declarations: ReadonlyMap<string, DeclaredSetting>): ReadonlyMap<string, SettingDeclaration> {
    return new Map([...declarations].map(([key, declared]) => [key, declared.declaration]));
}

function changedKeys(before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>): string[] {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].filter((key) => canonical(before[key]) !== canonical(after[key])).sort();
}
