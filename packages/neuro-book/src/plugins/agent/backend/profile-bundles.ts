/**
 * 用户级 Profile（docs/specs/agent/contributions.md 输出 9–12）：`<状态根>/user/profiles/<名>.profile.tsx`，key 是 `user.<名>`。
 *
 * 用户的源文件在运行期打包：`Bun.build` 把它连同导入的本地文件打成一个文件，外部模块只有宿主模块表里的；导入了表外的
 * 裸说明符以 `module-not-shared` 失败（与第三方插件同一条检查）。包按内容哈希命名、先写临时文件再改名，导入前删掉上一个包的
 * 模块缓存条目，旧的包没人引用后才能回收（t05 第三轮的实测）。这是 `runtime/plugin-code-loading.md`“不在运行期编译”的例外，
 * 只对用户自己写的 Profile。
 *
 * 每个 Profile 一个状态机：已发布的包、进行中的打包、最近一次失败。文件事件只记“要重新打包”，同一 Profile 同时只打一个包，
 * 打包期间又有变化就丢掉这次的结果再打一次，旧包不会盖过新包。打包或求值失败时继续用上一次成功的包。
 */

import {createHash} from "node:crypto";
import {existsSync, watch} from "node:fs";
import type {FSWatcher} from "node:fs";
import {mkdir, readdir, rename, rm, writeFile} from "node:fs/promises";
import {basename, dirname, join, resolve} from "node:path";

import type {AnyProfile} from "@notnotype/nb-harness/kernel/contracts";

import {allowedSpecifier, registerHostModules} from "nbook/plugin-platform/backend/loader";

import type {UserProfiles} from "./profiles";
import {USER_PROFILE_PREFIX} from "./profiles";
import type {ToolRequirements} from "./tools";

const SUFFIX = ".profile.tsx";
const JSX_SOURCE = "@notnotype/nb-plugin-sdk/agent";
/** 内核 `defineProfile` 打的标记（`Symbol.for`，宿主与用户包里是同一个）。 */
const PROFILE_MARK = Symbol.for("nb-harness.kernel.profile");

interface Published {
    readonly profile: AnyProfile;
    readonly hash: string;
    readonly file: string;
    /** 包里用到的源文件（绝对路径），文件变了就重新打包。 */
    readonly inputs: readonly string[];
}

interface State {
    readonly name: string;
    readonly key: string;
    published: Published | null;
    error: string | null;
    /** 进行中的打包；完成时若 `dirty` 又被置上，结果丢掉、再打一次。 */
    building: Promise<void> | null;
    dirty: boolean;
}

export interface ProfileBundlesOptions {
    readonly stateRoot: string;
    readonly sharedModules: ReadonlyArray<string>;
    readonly hostModules: () => Promise<Readonly<Record<string, object>>>;
    /** 这些 key 的 Profile 发布了新包、删掉了或从来没成功过。 */
    readonly changed: (keys: readonly string[]) => void;
    readonly report: (code: string, message: string, data?: Readonly<Record<string, unknown>>) => void;
}

export class ProfileBundles implements UserProfiles {
    readonly #states = new Map<string, State>();
    readonly #watchers = new Map<string, FSWatcher>();
    readonly #directory: string;
    readonly #cache: string;
    #stopping = false;

    constructor(private readonly options: ProfileBundlesOptions) {
        this.#directory = join(options.stateRoot, "user", "profiles");
        this.#cache = join(options.stateRoot, "agent", "cache", "profiles");
    }

    /** 扫一遍目录、打出全部的包、开始监听；之后清掉不再被引用的旧包。 */
    async start(): Promise<void> {
        await mkdir(this.#directory, {recursive: true});
        await mkdir(this.#cache, {recursive: true});
        this.#watchDirectory(this.#directory);
        const names = (await readdir(this.#directory)).filter((file) => file.endsWith(SUFFIX)).map((file) => file.slice(0, -SUFFIX.length));
        await Promise.all(names.map((name) => this.#schedule(name)));
        await this.#pruneCache();
    }

    /** 停止（sessions.md 输出 14 第 2 步）：停监听，等进行中的打包结束，结果丢掉、不发布。 */
    async stop(): Promise<void> {
        this.#stopping = true;
        for (const watcher of this.#watchers.values()) watcher.close();
        this.#watchers.clear();
        await Promise.all([...this.#states.values()].map((state) => state.building));
    }

    list(): ReturnType<UserProfiles["list"]> {
        return [...this.#states.values()].flatMap((state) => {
            if (state.published === null && state.error === null) return [];
            const profile = state.published?.profile as (AnyProfile & {name?: string; description?: string; tools?: Partial<ToolRequirements>}) | undefined;
            return [{
                key: state.key,
                name: profile?.name ?? state.name,
                description: profile?.description ?? "",
                tools: {required: profile?.tools?.required ?? [], optional: profile?.tools?.optional ?? []},
                usable: state.published !== null,
                ...(state.error === null ? {} : {error: state.error}),
            }];
        });
    }

    resolve(key: string): AnyProfile | undefined {
        return this.#states.get(key)?.published?.profile;
    }

    /** 等全部进行中的打包结束（测试与停止用）。 */
    async settled(): Promise<void> {
        while ([...this.#states.values()].some((state) => state.building !== null)) {
            await Promise.all([...this.#states.values()].map((state) => state.building));
        }
    }

    #schedule(name: string): Promise<void> {
        if (this.#stopping) return Promise.resolve();
        const key = `${USER_PROFILE_PREFIX}${name}`;
        let state = this.#states.get(key);
        if (state === undefined) this.#states.set(key, (state = {name, key, published: null, error: null, building: null, dirty: false}));
        state.dirty = true;
        if (state.building !== null) return state.building;
        const target = state;
        target.building = (async () => {
            while (target.dirty && !this.#stopping) {
                target.dirty = false;
                await this.#build(target);
            }
        })().finally(() => {
            target.building = null;
        });
        return target.building;
    }

    async #build(state: State): Promise<void> {
        const source = join(this.#directory, `${state.name}${SUFFIX}`);
        if (!existsSync(source)) {
            // 源文件删了：从目录里去掉，用它的会话进只读。
            this.#states.delete(state.key);
            if (state.published !== null || state.error !== null) this.options.changed([state.key]);
            return;
        }
        let outcome: {readonly ok: true; readonly published: Published} | {readonly ok: false; readonly error: string};
        try {
            outcome = await this.#bundle(state, source);
        } catch (error) {
            outcome = {ok: false, error: error instanceof Error ? error.message : String(error)};
        }
        // 打包期间又有变化（或开始停止）：这次的结果作废。
        if (state.dirty || this.#stopping) return;
        if (!outcome.ok) {
            const hadNothing = state.published === null && state.error === null;
            state.error = outcome.error;
            this.options.report("user-profile-failed", `profile ${state.key} failed to build or load; ${state.published === null ? "it is unavailable" : "the previous build stays in use"}`, {profile: state.key, error: outcome.error});
            if (hadNothing) this.options.changed([state.key]);
            return;
        }
        const previous = state.published;
        state.published = outcome.published;
        state.error = null;
        this.#watchInputs(outcome.published.inputs);
        if (previous?.hash !== outcome.published.hash) this.options.changed([state.key]);
    }

    async #bundle(state: State, source: string): Promise<{readonly ok: true; readonly published: Published} | {readonly ok: false; readonly error: string}> {
        const built = await Bun.build({
            entrypoints: [source],
            target: "bun",
            format: "esm",
            // 包一律不打进来、留作外部引用：共享模块由宿主给，别的包在下面的检查里以 module-not-shared 失败，不会从状态根往上
            // 找到某份 node_modules 打进来（开发时状态根在仓库里，几乎总能找到）。
            packages: "external",
            jsx: {runtime: "automatic", importSource: JSX_SOURCE, development: false},
            metafile: true,
            throw: false,
        } as Parameters<typeof Bun.build>[0]);
        if (!built.success || built.outputs[0] === undefined) {
            return {ok: false, error: built.logs.map((log) => String(log.message ?? log)).join("\n") || "build failed"};
        }
        const code = await built.outputs[0].text();
        for (const item of new Bun.Transpiler({loader: "js"}).scanImports(code)) {
            if (!allowedSpecifier(item.path, this.options.sharedModules)) return {ok: false, error: `module-not-shared: ${item.path} is not one of the modules NeuroBook shares with profiles`};
        }
        const hash = createHash("sha256").update(code).digest("hex").slice(0, 12);
        const bundleFile = join(this.#cache, `${state.name}-${hash}.js`);
        if (!existsSync(bundleFile)) {
            const temporary = `${bundleFile}.${String(process.pid)}.tmp`;
            await writeFile(temporary, code);
            await rename(temporary, bundleFile);
        }
        await registerHostModules(this.options.hostModules);
        if (state.published !== null && state.published.file !== bundleFile) delete require.cache[state.published.file];
        delete require.cache[bundleFile];
        // 应用包检查认这一处计算出来的导入（scripts/pack-app.ts 的 ALLOWED_DYNAMIC_IMPORTS），改写法时两边一起改。
        const module = (await import(bundleFile)) as {default?: unknown};
        const profile = module.default as (AnyProfile & {readonly [PROFILE_MARK]?: boolean}) | undefined;
        if (profile === undefined || profile === null || typeof profile !== "object" || profile[PROFILE_MARK] !== true) {
            return {ok: false, error: "profile-invalid-export: the default export is not the result of defineProfile"};
        }
        if (profile.id !== state.key) return {ok: false, error: `profile-invalid-export: the profile id must be ${state.key} (the file name decides it), got ${profile.id}`};
        const metafile = (built as unknown as {metafile?: {inputs?: Record<string, unknown>}}).metafile;
        const inputs = Object.keys(metafile?.inputs ?? {}).map((path) => resolve(path));
        // 生效的版本带包的内容哈希：改了任何一个源文件，打开着的会话写 code-updated、已提交的轮重新渲染（输出 10）。
        return {ok: true, published: {profile: {...profile, version: `${profile.version}+${hash}`} as AnyProfile, hash, file: bundleFile, inputs: inputs.length > 0 ? inputs : [source]}};
    }

    /** 文件事件只作“可能变了”的信号：编辑器先写临时文件再改名、一次保存多个事件，都只合并成一次打包。 */
    #watchDirectory(directory: string): void {
        if (this.#watchers.has(directory) || this.#stopping) return;
        try {
            const watcher = watch(directory, (_event, file) => this.#onChange(directory, file === null ? null : String(file)));
            watcher.on("error", (error) => this.options.report("user-profile-watch-failed", `watching ${directory} failed`, {message: error.message}));
            this.#watchers.set(directory, watcher);
        } catch (error) {
            this.options.report("user-profile-watch-failed", `watching ${directory} failed`, {message: error instanceof Error ? error.message : String(error)});
        }
    }

    #watchInputs(inputs: readonly string[]): void {
        for (const input of inputs) this.#watchDirectory(dirname(input));
    }

    #onChange(directory: string, file: string | null): void {
        if (this.#stopping) return;
        const changed = file === null ? null : join(directory, file);
        if (directory === this.#directory && file !== null && file.endsWith(SUFFIX)) void this.#schedule(file.slice(0, -SUFFIX.length));
        for (const state of [...this.#states.values()]) {
            if (changed === null || state.published?.inputs.includes(changed) === true) void this.#schedule(state.name);
        }
    }

    async #pruneCache(): Promise<void> {
        const keep = new Set([...this.#states.values()].flatMap((state) => (state.published === null ? [] : [basename(state.published.file)])));
        for (const file of await readdir(this.#cache)) {
            if (keep.has(file)) continue;
            try {
                await rm(join(this.#cache, file), {force: true});
            } catch (error) {
                this.options.report("user-profile-prune-failed", `removing the old bundle ${file} failed`, {message: error instanceof Error ? error.message : String(error)});
            }
        }
    }
}
