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
import {link, mkdir, readdir, realpath, rename, rm, writeFile} from "node:fs/promises";
import {basename, dirname, join, relative, resolve, sep} from "node:path";

import type {AnyProfile} from "@notnotype/nb-harness/kernel/contracts";

import {allowedSpecifier, registerHostModules} from "nbook/plugin-platform/backend/loader";

import type {CreateUserProfileResult, DeleteUserProfileResult, ProfileEntry, ProfileProblem} from "../shared/contracts";

import type {UserProfiles} from "./profiles";
import {USER_PROFILE_PREFIX} from "./profiles";
import {USER_PROFILE_NAME, userProfileAddress} from "../shared/profile-tools";
import type {ToolRequirements} from "../shared/profile-tools";

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
    problem: ProfileProblem | null;
    /** 进行中的打包；完成时若 `dirty` 又被置上，结果丢掉、再打一次。 */
    building: Promise<void> | null;
    dirty: boolean;
    /** 最近一次打包用到的源文件（打包成功就有，求值失败也留着），这些文件变了就重新打包。 */
    inputs: readonly string[];
}

/** 计算出来的导入（`import(x)`、`require(x)`）：扫描看不见它要什么，不知道是不是共享模块，一律拒绝。 */
const COMPUTED_IMPORT = /\b(?:import|require)\(\s*(?!["'`])/u;
/** 错误文字交给浏览器之前截到这么长。 */
const MAX_PROBLEM_MESSAGE = 2_000;

/** 新建的骨架：不改就能打包成功，只依赖 SDK。 */
function skeleton(name: string, texts: {readonly description: string; readonly system: string}): string {
    return `import {defineProfile} from "${JSX_SOURCE}";

export default defineProfile({
    id: ${JSON.stringify(`${USER_PROFILE_PREFIX}${name}`)},
    version: "1",
    name: ${JSON.stringify(name)},
    description: ${JSON.stringify(texts.description)},
    tools: {required: [], optional: ["nbook.agent.read", "nbook.agent.grep", "nbook.agent.glob"]},
    system: <>{${JSON.stringify(texts.system)}}</>,
});
`;
}

const errorCode = (error: unknown): string | undefined => (error as {code?: string} | null)?.code;

/** `detail` 是原文，只进诊断；`problem` 交给浏览器。 */
type BundleOutcome = {readonly ok: true; readonly published: Published} | {readonly ok: false; readonly detail: string; readonly problem: ProfileProblem};

export interface ProfileBundlesOptions {
    readonly stateRoot: string;
    readonly sharedModules: ReadonlyArray<string>;
    readonly hostModules: () => Promise<Readonly<Record<string, object>>>;
    /** 这些 key 的 Profile 发布了新包、删掉了或从来没成功过：用它们的会话重新解析。 */
    readonly changed: (keys: readonly string[]) => void;
    /**
     * 目录的内容可能变了：每次打包有了结果、文件删了都发。和 `changed` 分开：改坏时会话继续用上一个包、不重新解析，修好后
     * 哈希没变时也不用，但目录的状态都变了（contributions.md 输出 16）。
     */
    readonly catalogChanged: () => void;
    readonly report: (code: string, message: string, data?: Readonly<Record<string, unknown>>) => void;
}

export class ProfileBundles implements UserProfiles {
    readonly #states = new Map<string, State>();
    readonly #watchers = new Map<string, FSWatcher>();
    readonly #directory: string;
    /** 启动时换成真实路径：Bun 的模块缓存按真实路径记，状态根经过符号链接时删缓存才删得到。 */
    #cache: string;
    /** `#directory` 的真实路径：打包器的错误文字里是它。 */
    #realDirectory: string;
    #stopping = false;

    constructor(private readonly options: ProfileBundlesOptions) {
        this.#directory = join(options.stateRoot, "user", "profiles");
        this.#cache = join(options.stateRoot, "agent", "cache", "profiles");
        this.#realDirectory = this.#directory;
    }

    /** 扫一遍目录、打出全部的包、开始监听；之后清掉不再被引用的旧包。 */
    async start(): Promise<void> {
        await mkdir(this.#directory, {recursive: true});
        await mkdir(this.#cache, {recursive: true});
        this.#cache = await realpath(this.#cache);
        this.#realDirectory = await realpath(this.#directory);
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
            if (state.published === null && state.problem === null) return [];
            const profile = state.published?.profile as (AnyProfile & {name?: string; description?: string; tools?: Partial<ToolRequirements>; modelNeeds?: ProfileEntry["modelNeeds"]}) | undefined;
            return [{
                key: state.key,
                name: profile?.name ?? state.name,
                description: profile?.description ?? "",
                tools: {required: profile?.tools?.required ?? [], optional: profile?.tools?.optional ?? []},
                ...(profile?.modelNeeds === undefined ? {} : {modelNeeds: profile.modelNeeds}),
                usable: state.published !== null,
                ...(state.problem === null ? {} : {problem: state.problem}),
            }];
        });
    }

    resolve(key: string): AnyProfile | undefined {
        return this.#states.get(key)?.published?.profile;
    }

    /**
     * 新建（contributions.md 输出 18）：先写好再链接成入口文件，目录监听看到的就是写完的文件，不会先打包一个空文件；链接是
     * 排他的，已有同名不覆盖。交回时打包已经有结果，目录里有它。
     */
    async create(name: string, texts: {readonly description: string; readonly system: string}): Promise<CreateUserProfileResult> {
        if (!USER_PROFILE_NAME.test(name)) return {ok: false, code: "invalid-name"};
        const file = `${name}${SUFFIX}`;
        const temporary = join(this.#cache, `${file}.${String(process.pid)}.tmp`);
        await writeFile(temporary, skeleton(name, texts));
        try {
            await link(temporary, join(this.#directory, file));
        } catch (error) {
            if (errorCode(error) === "EEXIST") return {ok: false, code: "exists"};
            throw error;
        } finally {
            await rm(temporary, {force: true});
        }
        await this.#schedule(name);
        const key = `${USER_PROFILE_PREFIX}${name}`;
        return {ok: true, key, address: userProfileAddress(key)};
    }

    /** 删入口文件；它导入的本地文件留着。交回时目录里已经没有它，用它的会话进只读。 */
    async delete(key: string): Promise<DeleteUserProfileResult> {
        const state = this.#states.get(key);
        if (state === undefined) return {ok: false, code: "not-found"};
        try {
            await rm(join(this.#directory, `${state.name}${SUFFIX}`));
        } catch (error) {
            if (errorCode(error) !== "ENOENT") throw error;
        }
        await this.#schedule(state.name);
        return {ok: true};
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
        if (state === undefined) this.#states.set(key, (state = {name, key, published: null, problem: null, building: null, dirty: false, inputs: []}));
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
            if (state.published !== null || state.problem !== null) this.options.changed([state.key]);
            this.options.catalogChanged();
            return;
        }
        let outcome: BundleOutcome;
        try {
            outcome = await this.#bundle(state, source);
        } catch (error) {
            // 打包器以外抛的：多半是求值时 Profile 自己抛的。
            const detail = error instanceof Error ? error.message : String(error);
            outcome = {ok: false, detail, problem: {code: "load-failed", file: `${state.name}${SUFFIX}`, message: this.#cleanMessage(detail)}};
        }
        // 打包期间又有变化（或开始停止）：这次的结果作废。
        if (state.dirty || this.#stopping) return;
        if (!outcome.ok) {
            const hadNothing = state.published === null && state.problem === null;
            state.problem = outcome.problem;
            this.options.report("user-profile-failed", `profile ${state.key} failed to build or load; ${state.published === null ? "it is unavailable" : "the previous build stays in use"}`, {profile: state.key, error: outcome.detail});
            if (hadNothing) this.options.changed([state.key]);
            this.options.catalogChanged();
            return;
        }
        const previous = state.published;
        state.published = outcome.published;
        state.problem = null;
        this.#watchInputs(outcome.published.inputs);
        if (previous?.hash !== outcome.published.hash) this.options.changed([state.key]);
        this.options.catalogChanged();
    }

    /** 去掉本机路径再交给浏览器；原文只进诊断。 */
    #cleanMessage(message: string): string {
        const hidden = [this.#realDirectory, this.#directory, this.#cache, this.options.stateRoot];
        return hidden.reduce((text, path) => text.replaceAll(`${path}${sep}`, "").replaceAll(path, ""), message).slice(0, MAX_PROBLEM_MESSAGE);
    }

    #relativeFile(file: string | undefined, fallback: string): string {
        if (file === undefined || file === "") return fallback;
        const inside = relative(this.#realDirectory, resolve(file));
        return inside.startsWith("..") ? basename(file) : inside;
    }

    async #bundle(state: State, source: string): Promise<BundleOutcome> {
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
            const detail = built.logs.map((log) => String(log.message ?? log)).join("\n") || "build failed";
            const position = (built.logs[0] as {position?: {file?: string; line?: number} | null} | undefined)?.position;
            return {ok: false, detail, problem: {
                code: "build-failed",
                file: this.#relativeFile(position?.file, `${state.name}${SUFFIX}`),
                ...(position?.line === undefined || position.line <= 0 ? {} : {line: position.line}),
                message: this.#cleanMessage(detail),
            }};
        }
        // 先记下这次用到的源文件并监听它们：之后求值期间它们变了，这次的结果作废（输出 9），求值失败了修好它们也会重试。
        const metafile = (built as unknown as {metafile?: {inputs?: Record<string, unknown>}}).metafile;
        const inputs = Object.keys(metafile?.inputs ?? {}).map((path) => resolve(path));
        state.inputs = inputs.length > 0 ? inputs : [source];
        this.#watchInputs(state.inputs);
        const code = await built.outputs[0].text();
        if (COMPUTED_IMPORT.test(code)) return {ok: false, detail: "module-not-shared: the profile computes a module name at run time (a dynamic import or require with a variable); import modules by their literal name", problem: {code: "module-not-shared"}};
        for (const item of new Bun.Transpiler({loader: "js"}).scanImports(code)) {
            if (!allowedSpecifier(item.path, this.options.sharedModules)) return {ok: false, detail: `module-not-shared: ${item.path} is not one of the modules NeuroBook shares with profiles`, problem: {code: "module-not-shared", module: item.path}};
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
            return {ok: false, detail: "profile-invalid-export: the default export is not the result of defineProfile", problem: {code: "invalid-export"}};
        }
        if (profile.id !== state.key) return {ok: false, detail: `profile-invalid-export: the profile id must be ${state.key} (the file name decides it), got ${profile.id}`, problem: {code: "invalid-export", expectedId: state.key}};
        // 生效的版本带包的内容哈希：改了任何一个源文件，打开着的会话写 code-updated、已提交的轮重新渲染（输出 10）。
        return {ok: true, published: {profile: {...profile, version: `${profile.version}+${hash}`} as AnyProfile, hash, file: bundleFile, inputs: state.inputs}};
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

    /**
     * 哪些 Profile 要重新打包：入口文件本身；用到这个文件的；正在打包的（还不知道这次会用到哪些文件，宁可多打一次）；没成功
     * 过或最近一次失败的、变化又落在它们关心的目录里的（打包失败时可能还不知道用到了哪些文件）。
     */
    #onChange(directory: string, file: string | null): void {
        if (this.#stopping) return;
        const changed = file === null ? null : join(directory, file);
        if (directory === this.#directory && file !== null && file.endsWith(SUFFIX)) void this.#schedule(file.slice(0, -SUFFIX.length));
        for (const state of [...this.#states.values()]) {
            const failing = state.published === null || state.problem !== null;
            const near = directory === this.#directory || state.inputs.some((input) => dirname(input) === directory);
            if (changed === null || state.building !== null || state.inputs.includes(changed) || (failing && near)) void this.#schedule(state.name);
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
