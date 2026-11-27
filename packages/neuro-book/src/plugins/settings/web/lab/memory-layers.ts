/**
 * 设置场景的配置层：内存里的层拥有者（docs/specs/settings/configuration.md 的层快照与写入合同），给 Lab 与组件测试的局部
 * 宿主用。真实的拥有者读写文件、跑在服务端与项目子进程里，浏览器里起不来；这里按同样的合同交出层快照、按同样的顺序核对
 * 写入（`writeProblem`、`userEditProblem`），场景可以把它切到无效、断开或让写入失败。文件文本也在内存里，给了初始文本时
 * 层的值、被丢弃的键与无效都由它解析出来：单键写入用真实拥有者同一套文本编辑（`editLayerText`），整份读写与“别处改了”
 * 用同一套解析（`parseLayerText`），内容没变时不发布层快照（只改注释时只通知文本）。修订号是不透明的记号（这里用文本的
 * FNV 摘要，真实拥有者用原始字节的 SHA-256），界面只比较相等。
 *
 * 它同时充当窗口的连接：断开时结束订阅（实例把这一层记为不可达），重新连上时实例按连接回到在线重新订阅，与浏览器宿主
 * 的重连一样。
 */

import type {ConsumerIdentity} from "@notnotype/nb-runtime/services";

import type {LayerLink} from "nbook/plugins/settings/shared/instance";
import {editLayerText, parseLayerText} from "nbook/plugins/settings/shared/layer-text";
import {expectationHolds, sameContent, userEditProblem, writeProblem} from "nbook/plugins/settings/shared/layers";
import type {DeclaredSetting, LayerContent, LayerEdit, LayerProblem, LayerSnapshot, LayerWriteResult} from "nbook/plugins/settings/shared/layers";
import type {LayerEditor, LayerFile} from "nbook/plugins/settings/shared/remote-link";
import type {WindowConnection, WindowConnectionState} from "nbook/shared/host";
import {freezeJson} from "nbook/shared/settings";
import type {SettingLayer, SettingsFailure} from "nbook/shared/settings";

export interface MemoryLayerOptions {
    readonly layer: SettingLayer;
    readonly declarations: ReadonlyMap<string, DeclaredSetting>;
    readonly connection: MemoryConnection;
    readonly values?: Readonly<Record<string, unknown>>;
    /** 一开始就无效：`values` 是上一份有效内容。 */
    readonly invalid?: string;
    /** 一开始就连不上。 */
    readonly unreachable?: boolean;
    /** 层快照带的文件路径；缺省不带。 */
    readonly path?: string;
    /** 文件文本；缺省由 `values` 写成（四格缩进），没有值时是空文件。 */
    readonly text?: string;
}

export interface MemoryLayer {
    readonly link: LayerLink;
    readonly editor: LayerEditor;
    /** 设置文件视图读写的这一层文件。 */
    readonly file: LayerFile;
    /** 之后的写入都以这个失败码结束；null 恢复正常。 */
    failWrites(code: SettingsFailure | null): void;
    /** 文件改坏（给原因）或修好（null）。 */
    setInvalid(detail: string | null): void;
    /** 连不上：结束订阅，写入为 unavailable；`false` 恢复，经连接回到在线让实例重新订阅。 */
    setUnreachable(unreachable: boolean): void;
    /** 当前文件里的键值，给测试核对。 */
    values(): Readonly<Record<string, unknown>>;
    /** 当前文件文本。 */
    text(): string;
    /** 在“别处”改文件（同外部编辑器）：按新文本重读，坏了就记为无效、保留上一份值。 */
    setText(text: string): void;
    /** 之后的整份读取取到调用那一刻的文本，但等放行才返回（模拟链路上读取与文本事件乱序）；返回放行函数。 */
    holdReads(): () => void;
}

/** 窗口的连接状态：内存层断开、恢复时切换，实例据此重新订阅。 */
export interface MemoryConnection {
    readonly connection: WindowConnection;
    set(state: WindowConnectionState): void;
}

export function memoryConnection(): MemoryConnection {
    let current: WindowConnectionState = "online";
    const listeners = new Set<(state: WindowConnectionState) => void>();
    return {
        connection: {
            state: () => current,
            onChange: (listener) => {
                listeners.add(listener);
                return () => {
                    listeners.delete(listener);
                };
            },
        },
        set: (state) => {
            if (state === current) return;
            current = state;
            for (const listener of [...listeners]) listener(state);
        },
    };
}

let boots = 0;

/** 内存文件的修订号：FNV-1a 加长度。只要文本不同就不同到足够看出“被改过”，不需要密码学强度。 */
function revisionOf(text: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
    return `${hash.toString(16)}-${String(text.length)}`;
}

function textOf(values: Readonly<Record<string, unknown>>): string {
    return Object.keys(values).length === 0 ? "" : `${JSON.stringify(values, null, 4)}\n`;
}

export function memoryLayer(options: MemoryLayerOptions): MemoryLayer {
    const boot = `memory-${options.layer}-${String((boots += 1))}`;
    let seq = 0;
    let values: Readonly<Record<string, unknown>> = freezeJson({...options.values});
    let invalid: string | null = options.invalid ?? null;
    let unreachable = options.unreachable ?? false;
    let failure: SettingsFailure | null = null;
    let text = options.text ?? textOf(values);
    let problems: ReadonlyArray<LayerProblem> = [];
    /** 文件在不在：真实存在的空文件也算在（只靠文本是不是空串分不出来）。 */
    let exists = options.text !== undefined || text !== "";
    /** 改坏之前的文本：修好时换回来。 */
    let beforeInvalid: string | null = null;
    const watchers = new Set<(revision: string) => void>();
    let hold: Promise<void> | null = null;
    const keys = new Map([...options.declarations].map(([key, declared]) => [key, declared.declaration]));
    // 给了初始文本：值与被丢弃的键都从它来，与真实拥有者读文件一样。
    if (options.text !== undefined) {
        const parsed = parseLayerText(options.text, keys, options.layer);
        if (parsed.status === "ok") {
            values = parsed.values;
            problems = parsed.problems;
        } else invalid = parsed.detail;
    }
    // 一开始就无效：文本同样是坏的（去掉最后的右花括号），修好时换回来。
    if (invalid !== null && options.text === undefined) {
        beforeInvalid = text;
        text = text.replace(/\}\s*$/u, "") || "{";
    }
    const subscribers = new Set<{readonly onSnapshot: (snapshot: LayerSnapshot) => void; readonly onEnd: (reason: string, retry: boolean) => void}>();
    // 一开始就连不上：连接先离线，恢复时回到在线，实例才会重新订阅。
    if (unreachable) options.connection.set("offline");

    /** 无效时的原因与位置从文件文本解析出来（同真实拥有者，configuration.md 输出 5）；文本其实合格时（只切了状态）没有。 */
    const content = (): LayerContent => {
        if (invalid === null) return {status: "ok", values, problems};
        const parsed = parseLayerText(text, keys, options.layer);
        return parsed.status === "invalid"
            ? {status: "invalid", values, problems, detail: invalid, reason: parsed.reason, position: parsed.position}
            : {status: "invalid", values, problems, detail: invalid};
    };

    const snapshot = (): LayerSnapshot => {
        const located = options.path === undefined ? {} : {path: options.path};
        return {...content(), revision: {boot, seq}, ...located};
    };

    let published: LayerContent = content();

    /** 内容变了才换修订号、发布（同真实拥有者）；返回当前快照。 */
    const publish = (): LayerSnapshot => {
        const next = content();
        if (sameContent(next, published)) return snapshot();
        published = next;
        seq += 1;
        const current = snapshot();
        for (const subscriber of [...subscribers]) subscriber.onSnapshot(current);
        return current;
    };

    const changeText = (next: string): void => {
        if (next === text) return;
        text = next;
        for (const watcher of [...watchers]) watcher(revisionOf(text));
    };

    const apply = (key: string, edit: LayerEdit, problem: {readonly code: SettingsFailure; readonly detail: string} | null): LayerWriteResult => {
        if (unreachable) return {ok: false, code: "unavailable", detail: "内存层已断开"};
        if (problem !== null) return {ok: false, ...problem};
        if (invalid !== null) return {ok: false, code: "layer-invalid", detail: `配置文件当前无效：${invalid}`};
        if (failure !== null) return {ok: false, code: failure, detail: "场景让写入失败"};
        if (!expectationHolds(edit.expect, values, key)) return {ok: false, code: "conflict", detail: `配置项 ${key} 的当前值不是期望的值`};
        const next = {...values};
        if (edit.kind === "set") next[key] = edit.value;
        else delete next[key];
        values = freezeJson(next);
        const edited = editLayerText(text, key, edit);
        changeText(edited.ok ? edited.text : textOf(values));
        exists = true;
        return {ok: true, snapshot: publish()};
    };

    /** 按文件文本重读：合格时换成它的值，坏了记为无效、保留上一份值。 */
    const reread = (): void => {
        const parsed = parseLayerText(text, keys, options.layer);
        if (parsed.status === "ok") {
            values = parsed.values;
            problems = parsed.problems;
            invalid = null;
        } else invalid = parsed.detail;
        publish();
    };

    return {
        link: {
            subscribe: async (onSnapshot, onEnd) => {
                if (unreachable) return {ok: false, code: "unavailable", detail: "内存层已断开", retry: true};
                const subscriber = {onSnapshot, onEnd};
                subscribers.add(subscriber);
                onSnapshot(snapshot());
                return {ok: true, release: () => void subscribers.delete(subscriber)};
            },
            write: async (consumer: ConsumerIdentity, key, edit) => apply(key, edit, writeProblem(consumer.plugin, key, options.declarations.get(key), edit, options.layer)),
        },
        editor: {
            edit: async (key, edit) => apply(key, edit, userEditProblem(key, options.declarations.get(key), edit, options.layer)),
        },
        file: {
            read: async () => {
                if (unreachable) return {ok: false, code: "unavailable", detail: "内存层已断开"};
                const current = text;
                if (hold !== null) await hold;
                return {ok: true, text: current, revision: revisionOf(current), exists};
            },
            write: async (next, revision) => {
                if (unreachable) return {ok: false, code: "unavailable", detail: "内存层已断开"};
                if (failure !== null) return {ok: false, code: failure, detail: "场景让写入失败"};
                if (revision !== revisionOf(text)) return {ok: false, code: "conflict", detail: "文件在读出之后被别处改过"};
                const parsed = parseLayerText(next, keys, options.layer);
                if (parsed.status === "invalid") return {ok: false, code: "invalid-text", detail: parsed.reason, position: parsed.position};
                beforeInvalid = null;
                changeText(next);
                exists = true;
                values = parsed.values;
                problems = parsed.problems;
                invalid = null;
                return {ok: true, revision: revisionOf(text), snapshot: publish()};
            },
            watch: (onRevision) => {
                watchers.add(onRevision);
                onRevision(revisionOf(text));
                return () => void watchers.delete(onRevision);
            },
        },
        failWrites: (code) => {
            failure = code;
        },
        setInvalid: (detail) => {
            // 文本跟着改坏（去掉最后的右花括号）或换回改坏之前的样子：设置文件视图里看到的与层的状态一致。
            if (detail !== null && beforeInvalid === null) {
                beforeInvalid = text;
                changeText(text.replace(/\}\s*$/u, "") || "{");
            } else if (detail === null && beforeInvalid !== null) {
                changeText(beforeInvalid);
                beforeInvalid = null;
            }
            invalid = detail;
            publish();
        },
        setUnreachable: (next) => {
            if (next === unreachable) return;
            unreachable = next;
            if (next) {
                for (const subscriber of [...subscribers]) subscriber.onEnd("disconnected", true);
                subscribers.clear();
                // 文本事件的订阅同样随断开结束（同远程链路），恢复后要调用方重新订阅。
                watchers.clear();
                options.connection.set("offline");
            } else {
                options.connection.set("online");
            }
        },
        values: () => values,
        text: () => text,
        holdReads: () => {
            let release: () => void = () => undefined;
            hold = new Promise<void>((resolve) => {
                release = resolve;
            });
            return () => {
                hold = null;
                release();
            };
        },
        setText: (next) => {
            beforeInvalid = null;
            changeText(next);
            exists = true;
            reread();
        },
    };
}
