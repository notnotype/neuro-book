/**
 * 项目登记表：`<状态根>/projects.json`，列出已登记项目的 id、短名与当前路径。只由本服务端进程写入，
 * 进程内串行，写临时文件后改名替换；每次读取都读文件，用户修好或删掉坏掉的登记表后无需重启。
 * 行为合同见 docs/specs/runtime/projects.md（输出第 1、2 条）。
 */

import {randomUUID} from "node:crypto";
import {mkdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import {basename, join} from "node:path";

import type {ProjectRecord, ProjectRegisterResult, ProjectRegistryRead} from "nbook/shared/projects";

import {checkProjectDirectory, isProjectId, readProjectIdentity, writeProjectIdentity} from "./identity";

export const PROJECT_REGISTRY_FILE = "projects.json";

export interface ProjectRegistry {
    /** 登记文件的位置；只写进服务端日志，不发给浏览器。 */
    readonly file: string;
    /** 按登记顺序。 */
    list(): Promise<ProjectRegistryRead<ReadonlyArray<ProjectRecord>>>;
    /** 按引用解析：先比 id、再比短名；没有为 null。 */
    resolve(reference: string): Promise<ProjectRegistryRead<ProjectRecord | null>>;
    register(path: string): Promise<ProjectRegisterResult>;
}

/** 目录名转短名：小写，非 `[a-z0-9-]` 换成 `-`，合并连续的 `-` 并去掉首尾的 `-`；为空时用 `project`。 */
export function shortNameBase(directory: string): string {
    const name = basename(directory).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    return name === "" ? "project" : name;
}

function uniqueName(base: string, taken: ReadonlySet<string>): string {
    if (!taken.has(base)) return base;
    for (let suffix = 2; ; suffix += 1) {
        const candidate = `${base}-${String(suffix)}`;
        if (!taken.has(candidate)) return candidate;
    }
}

function isRecord(value: unknown): value is ProjectRecord {
    const record = value as Partial<Record<keyof ProjectRecord, unknown>> | null;
    return typeof record === "object" && record !== null && isProjectId(record.id) && typeof record.name === "string" && typeof record.path === "string";
}

export function createProjectRegistry(options: {readonly stateRoot: string; readonly cwd: string}): ProjectRegistry {
    const file = join(options.stateRoot, PROJECT_REGISTRY_FILE);
    // 写入串行：读出、改、写回之间不能插进另一次登记，否则两次登记会互相覆盖或取到同一个短名。
    let queue: Promise<unknown> = Promise.resolve();

    async function read(): Promise<ProjectRegistryRead<ReadonlyArray<ProjectRecord>>> {
        let text: string;
        try {
            text = await readFile(file, "utf8");
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return {ok: true, value: []};
            throw error;
        }
        let value: unknown;
        try {
            value = JSON.parse(text);
        } catch (error) {
            if (!(error instanceof SyntaxError)) throw error;
            return {ok: false, reason: "registry-invalid", detail: "项目登记表不是合法的 JSON"};
        }
        const registry = value as {readonly schema?: unknown; readonly projects?: unknown} | null;
        if (typeof registry !== "object" || registry === null || registry.schema !== 1 || !Array.isArray(registry.projects) || !registry.projects.every(isRecord)) {
            return {ok: false, reason: "registry-invalid", detail: "项目登记表的结构不符（应为 {schema: 1, projects: [{id: UUID, name, path}]}）"};
        }
        return {ok: true, value: registry.projects.map(({id, name, path}) => ({id, name, path}))};
    }

    async function write(projects: ReadonlyArray<ProjectRecord>): Promise<void> {
        await mkdir(options.stateRoot, {recursive: true});
        const temporary = `${file}.${randomUUID()}.tmp`;
        try {
            await writeFile(temporary, `${JSON.stringify({schema: 1, projects}, null, 2)}\n`);
            await rename(temporary, file);
        } finally {
            await rm(temporary, {force: true});
        }
    }

    async function register(input: string): Promise<ProjectRegisterResult> {
        // 先读登记表：它坏了就不碰项目目录，不留下身份文件之类的副作用。
        const current = await read();
        if (!current.ok) return current;
        const projects = current.value;
        const checked = await checkProjectDirectory(input, options);
        if (!checked.ok) return checked;
        const path = checked.path;
        const atPath = projects.find((project) => project.path === path);
        const identity = await readProjectIdentity(path);
        if (identity.status === "invalid") return {ok: false, reason: "identity-invalid", detail: identity.detail};

        let id: string;
        if (identity.status === "found") {
            id = identity.id;
        } else if (atPath !== undefined) {
            // 已登记的目录丢了身份文件：按登记表里的 id 重建，仍是同一个项目。
            const restored = await writeIdentity(path, atPath.id);
            if (!restored.ok) return restored;
            id = restored.id;
        } else {
            const created = await writeIdentity(path, randomUUID());
            if (!created.ok) return created;
            id = created.id;
        }

        const byId = projects.find((project) => project.id === id);
        if (byId !== undefined && byId.path === path) return {ok: true, project: byId};
        if (atPath !== undefined && atPath.id !== id) {
            return {ok: false, reason: "identity-conflict", detail: `目录 ${path} 已登记为另一个项目（${atPath.name}），而它的身份文件写的是别的 id`};
        }
        if (byId !== undefined) {
            // 原路径下仍是同一个 id：这是一份副本，不是移动。
            const original = await readProjectIdentity(byId.path);
            if (original.status === "found" && original.id === id) {
                return {ok: false, reason: "identity-conflict", detail: `这个目录是已登记项目 ${byId.name}（${byId.path}）的副本；删除副本里的 .nbook/project.json 后可作为新项目登记`};
            }
            const moved = {...byId, path};
            return save(projects.map((project) => (project.id === id ? moved : project)), moved);
        }
        const added = {id, name: uniqueName(shortNameBase(path), new Set(projects.map((project) => project.name))), path};
        return save([...projects, added], added);
    }

    async function save(projects: ReadonlyArray<ProjectRecord>, project: ProjectRecord): Promise<ProjectRegisterResult> {
        try {
            await write(projects);
        } catch (error) {
            return {ok: false, reason: "write-failed", detail: `写入项目登记表失败：${error instanceof Error ? error.message : String(error)}`};
        }
        return {ok: true, project};
    }

    return {
        file,
        list: read,
        async resolve(reference) {
            const current = await read();
            if (!current.ok) return current;
            return {ok: true, value: current.value.find((project) => project.id === reference) ?? current.value.find((project) => project.name === reference) ?? null};
        },
        register(path) {
            const result = queue.then(() => register(path));
            // 队列只管先后；这次登记的失败由 `result` 交给调用方。
            queue = result.catch(() => undefined);
            return result;
        },
    };
}

async function writeIdentity(path: string, id: string): Promise<{readonly ok: true; readonly id: string} | {readonly ok: false; readonly reason: "identity-invalid" | "write-failed"; readonly detail: string}> {
    let written;
    try {
        written = await writeProjectIdentity(path, id);
    } catch (error) {
        return {ok: false, reason: "write-failed", detail: `写入项目身份文件失败：${error instanceof Error ? error.message : String(error)}`};
    }
    if (written.status === "found") return {ok: true, id: written.id};
    return {ok: false, reason: "identity-invalid", detail: written.status === "invalid" ? written.detail : "项目身份文件写入后读不到"};
}
