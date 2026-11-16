/**
 * Skill 的依赖是否就绪（docs/specs/agent/skills.md 输出 3 与“副作用与数据”的初始化标记）。标记写在 `node_modules` 里，与
 * 装好的依赖同生共死；判断只比标记与现状，不实际运行脚本。
 */

import {readFile} from "node:fs/promises";
import {join} from "node:path";

import type {SkillProblem} from "../../shared/skills";

export const PACKAGE_FILE = "package.json";
export const LOCK_FILE = "bun.lock";
export const MARKER_FILE = join("node_modules", ".nbook-skill-deps.json");
export const MARKER_SCHEMA = 1;

/** `package.json` 里影响安装的字段。 */
const INSTALL_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies", "overrides", "resolutions", "patchedDependencies", "trustedDependencies"] as const;

export interface SkillDepsMarker {
    readonly schema: typeof MARKER_SCHEMA;
    readonly runtime: "bun";
    /** `installInputs` 的结果。 */
    readonly inputs: string;
    /** `currentPlatform()` 的结果。 */
    readonly platform: string;
    /** 装它的 Bun 版本。 */
    readonly bun: string;
    readonly installedAt: string;
    /** 安装失败或被中断时的原因；有它就不算就绪。 */
    readonly error?: {readonly code: "install-failed"; readonly detail: string} | {readonly code: "interrupted"};
}

export const currentPlatform = (): string => `${process.platform}-${process.arch}`;

const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";

async function readOptional(path: string): Promise<string | null> {
    try {
        return await readFile(path, "utf8");
    } catch (error) {
        if (missing(error)) return null;
        throw error;
    }
}

/**
 * 安装的输入：`package.json` 里影响安装的字段加 `bun.lock` 的原文，取哈希。没有 `package.json` 为 null（不用初始化）。
 * `package.json` 读不懂时用它的原文：改好之前标记总对不上，Skill 停在未初始化。
 */
export async function installInputs(directory: string): Promise<string | null> {
    const manifest = await readOptional(join(directory, PACKAGE_FILE));
    if (manifest === null) return null;
    let picked: unknown = manifest;
    try {
        const parsed = JSON.parse(manifest) as Record<string, unknown>;
        picked = Object.fromEntries(INSTALL_FIELDS.filter((field) => parsed[field] !== undefined).map((field) => [field, parsed[field]]));
    } catch {
        // 读不懂的 package.json 按原文算，见上。
    }
    const lock = await readOptional(join(directory, LOCK_FILE));
    return new Bun.CryptoHasher("sha256").update(JSON.stringify({manifest: picked, lock})).digest("hex");
}

/** 读标记；没有、读不懂或 `schema` 不认识都为 null（按没有标记算）。 */
export async function readMarker(directory: string): Promise<SkillDepsMarker | null> {
    const text = await readOptional(join(directory, MARKER_FILE)).catch(() => null);
    if (text === null) return null;
    try {
        const marker = JSON.parse(text) as Partial<SkillDepsMarker>;
        return marker.schema === MARKER_SCHEMA && typeof marker.inputs === "string" && typeof marker.platform === "string" ? (marker as SkillDepsMarker) : null;
    } catch {
        return null;
    }
}

export type Readiness =
    | {readonly kind: "no-deps"}
    | {readonly kind: "ready"}
    | {readonly kind: "needs-init"; readonly problem?: SkillProblem};

/** 依赖是否就绪：没有 `package.json` 不用初始化；标记与现状一致、平台相同、没有 `error` 才就绪。 */
export async function readiness(directory: string): Promise<Readiness> {
    const inputs = await installInputs(directory);
    if (inputs === null) return {kind: "no-deps"};
    const marker = await readMarker(directory);
    if (marker === null) return {kind: "needs-init"};
    if (marker.error !== undefined) return {kind: "needs-init", problem: marker.error};
    return marker.inputs === inputs && marker.platform === currentPlatform() ? {kind: "ready"} : {kind: "needs-init"};
}
