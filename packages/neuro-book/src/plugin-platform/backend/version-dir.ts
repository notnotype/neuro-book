/**
 * 一个插件版本目录（或安装源文件夹）的读取：清单、入口文件、内容摘要。安装（`inventory.ts`）、启动盘点（`startup.ts`）与
 * 升级预览（`preview.ts`）共用。
 */

import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import {lstat, readdir, readFile, stat} from "node:fs/promises";
import {join, relative} from "node:path";

import {errno} from "@notnotype/nb-file-lock";
import type {ManifestFormat, PluginManifest} from "@notnotype/nb-runtime/plugin-manifest";

import {brief} from "./record";

/** 清单文件的大小上限；正常的 `package.json` 远小于它。 */
export const MANIFEST_LIMIT = 1024 * 1024;

/**
 * 版本目录全部文件的内容摘要（SHA-256 的前 16 个十六进制字符）：按相对路径排序，逐个并入路径、长度与内容。安装时已拒绝
 * 符号链接，这里遇到也跳过，不跟随。
 */
export async function directoryDigest(root: string): Promise<string> {
    const files: string[] = [];
    const walk = async (directory: string): Promise<void> => {
        for (const entry of await readdir(directory, {withFileTypes: true})) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) await walk(path);
            else if (entry.isFile()) files.push(path);
        }
    };
    await walk(root);
    const hash = createHash("sha256");
    // 逐块读：插件可能带几百 MB 的资源，整份读进内存会让启动的内存峰值等于最大的那个文件。
    for (const file of files.map((path) => relative(root, path)).sort()) {
        const path = join(root, file);
        hash.update(`${file}\0${String((await stat(path)).size)}\0`);
        for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
    }
    return hash.digest("hex").slice(0, 16);
}

export type ManifestFileRead =
    | {readonly ok: true; readonly raw: unknown; readonly manifest: PluginManifest}
    /** `raw` 是能解析出来时的 JSON，调用方据此给出比“清单无效”更具体的原因。 */
    | {readonly ok: false; readonly code: "manifest-invalid" | "path-rejected"; readonly detail: string; readonly problems?: ReadonlyArray<string>; readonly raw?: unknown};

/** 读插件文件夹根上的 `package.json` 并按第三方插件的规则校验清单；`package.json` 本身是符号链接时拒绝。 */
export async function installedManifest(directory: string, format: ManifestFormat): Promise<ManifestFileRead> {
    const file = join(directory, "package.json");
    let text: string;
    try {
        const info = await lstat(file);
        if (info.isSymbolicLink()) return {ok: false, code: "path-rejected", detail: "package.json 是符号链接"};
        if (!info.isFile()) return {ok: false, code: "manifest-invalid", detail: "插件文件夹根上没有 package.json"};
        if (info.size > MANIFEST_LIMIT) return {ok: false, code: "manifest-invalid", detail: `package.json 超过 ${String(MANIFEST_LIMIT)} 字节`};
        text = await readFile(file, "utf8");
    } catch (error) {
        return {ok: false, code: "manifest-invalid", detail: errno(error) === "ENOENT" ? "插件文件夹根上没有 package.json" : `读取 package.json 失败：${brief(error)}`};
    }
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        return {ok: false, code: "manifest-invalid", detail: "package.json 不是合法 JSON"};
    }
    const read = format.read(raw);
    if (read.status !== "valid") {
        const problems = read.problems.map((problem) => `${problem.path === "" ? "（根）" : problem.path}：${problem.message}`);
        // 启动时的“没有登记”原因只有这一句（不带问题列表），写出第一处问题。
        const more = problems.length > 1 ? `，另有 ${String(problems.length - 1)} 处` : "";
        return {ok: false, code: "manifest-invalid", detail: `清单有错误：${problems[0] ?? ""}${more}`, problems, raw};
    }
    return {ok: true, raw, manifest: read.manifest};
}

/** 清单里入口文件不是普通文件的那些 `main`。 */
export async function missingEntries(directory: string, manifest: PluginManifest): Promise<string[]> {
    const missing: string[] = [];
    for (const entry of manifest.entries) {
        try {
            if (!(await lstat(join(directory, entry.main))).isFile()) missing.push(entry.main);
        } catch {
            missing.push(entry.main);
        }
    }
    return missing;
}
