/**
 * 一层配置文件的读与写（docs/specs/settings/configuration.md 输出 13、14，“副作用与数据”）。
 *
 * 写入：先不持锁读一次，新文本与当前相同就直接成功，不建目录、不取锁、不碰文件（删除不存在的键没有副作用）；否则建好目录，
 * 经 `nbook/backend/locked-replace` 加锁替换（锁、重做与只读、权限位的规则见那里）。
 * - 写入锁是目标旁的 `<目标>.lock`（诊断插件也用 proper-lockfile）：同一份项目层可能被两个服务端同时写。
 * - 符号链接解析到最终目标，替换目标、不动链接；链接悬空时不写，免得把链接换成普通文件。
 */

import {lstat, mkdir, readFile, realpath} from "node:fs/promises";
import type {Stats} from "node:fs";
import {dirname} from "node:path";

import {describe, errno, replaceLocked} from "nbook/backend/locked-replace";

export {errno} from "nbook/backend/locked-replace";

export type LayerTarget =
    | {readonly kind: "file" | "missing"; readonly target: string}
    /** 链接的最终目标存在。 */
    | {readonly kind: "link"; readonly target: string}
    | {readonly kind: "dangling"};

/** 配置文件路径的落点：普通文件、还不存在、符号链接（解析到最终目标）、悬空链接。 */
export async function resolveTarget(path: string): Promise<LayerTarget> {
    let info: Stats;
    try {
        info = await lstat(path);
    } catch (error) {
        if (errno(error) === "ENOENT" || errno(error) === "ENOTDIR") return {kind: "missing", target: path};
        throw error;
    }
    if (!info.isSymbolicLink()) return {kind: "file", target: path};
    try {
        return {kind: "link", target: await realpath(path)};
    } catch (error) {
        if (errno(error) === "ENOENT" || errno(error) === "ENOTDIR") return {kind: "dangling"};
        throw error;
    }
}

export type ReadLayer = {readonly ok: true; readonly text: string} | {readonly ok: false; readonly detail: string};

/** 读文件文本：不存在（含悬空链接）为空文本；其它读取错误给出原因，由拥有者把层记为无效。 */
export async function readLayerFile(path: string): Promise<ReadLayer> {
    try {
        return {ok: true, text: await readFile(path, "utf8")};
    } catch (error) {
        if (errno(error) === "ENOENT" || errno(error) === "ENOTDIR") return {ok: true, text: ""};
        return {ok: false, detail: `无法读取：${describe(error)}`};
    }
}

/** 由当前文本算出新文本；不能写时给出原因（例如文件当前无效），原样作为写入失败交回。 */
export type Transform = (current: string) => {readonly ok: true; readonly text: string} | {readonly ok: false; readonly code: string; readonly detail: string};

export type WriteLayer = {readonly ok: true; readonly text: string} | {readonly ok: false; readonly code: string; readonly detail: string};

/**
 * 写一层：`transform` 在取锁前调用一次，持锁后每次重做时再各调用一次，必须是当前文本的纯函数。失败码 `write-failed`
 * 由本模块给出，其余来自 `transform`。
 * 收尾时的次要错误（释放锁、删临时文件）不改变结果，交给 `report` 记诊断（事件名带 `settings.` 前缀）。
 */
export async function writeLayerFile(path: string, transform: Transform, report: (event: string, error: unknown) => void): Promise<WriteLayer> {
    let target: LayerTarget;
    try {
        target = await resolveTarget(path);
    } catch (error) {
        return failed(`无法解析配置文件的位置：${describe(error)}`);
    }
    if (target.kind === "dangling") return failed(`${path} 是符号链接，目标不存在；不替换这个链接`);
    const file = target.target;
    // 不持锁的预读：新文本与当前相同时，这次写入在“读到的那一刻”已经完成，不必取锁。
    const unlocked = await readLayerFile(file);
    if (unlocked.ok) {
        const preview = transform(unlocked.text);
        if (!preview.ok) return preview;
        if (preview.text === unlocked.text) return {ok: true, text: unlocked.text};
    }
    try {
        await mkdir(dirname(file), {recursive: true});
    } catch (error) {
        return failed(`无法创建目录：${describe(error)}`);
    }
    const replaced = await replaceLocked<WriteLayer, string>(file, {
        lockPath: `${file}.lock`,
        decide: (current) => {
            const text = current === null ? "" : Buffer.from(current.bytes).toString("utf8");
            const next = transform(text);
            if (!next.ok || next.text === text) return {done: next.ok ? {ok: true, text} : next};
            return {write: next.text};
        },
        report: (event, error) => report(`settings.${event}`, error),
    });
    if (!replaced.ok) return failed(replaced.detail);
    if ("done" in replaced) return replaced.done;
    return {ok: true, text: replaced.written};
}

function failed(detail: string): {readonly ok: false; readonly code: "write-failed"; readonly detail: string} {
    return {ok: false, code: "write-failed", detail};
}
