/**
 * Skill 目录（docs/specs/agent/skills.md 输出 1–5、7）：按来源扫描 Skill 包，算出状态，监视用户的 Skill 文件夹，变了重扫
 * 并通知。正文不在这里缓存：带上与放回时现读（输出 9、16）。
 *
 * 监视用非递归的 `fs.watch`：用户的 Skill 根、每个 Skill 目录、每个 Skill 的 `node_modules`（存在时）。递归监视在
 * `node_modules` 上要登记上千个 inotify；初始化标记写在 `node_modules` 顶层，非递归监视它就看得到命令行写下的标记。
 * 内置的 Skill 随应用分发，不监视。
 */

import {watch, type FSWatcher} from "node:fs";
import {lstat, mkdir, readdir} from "node:fs/promises";
import {basename, join, sep} from "node:path";

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";

import {matchSkillToken, skillId, skillLocation, type SkillEntry, type SkillProblem, type SkillSource, type SkillTokenMatch} from "../../shared/skills";
import {detectExternal, readSkillPackage} from "./package";
import {readiness} from "./readiness";

/** 文件变化合并成一次重扫的等待时长：编辑器保存、`bun install` 都会连着改好几个文件。 */
const RESCAN_DELAY_MS = 150;

export interface SkillRoot {
    readonly source: SkillSource;
    /** 来源的目录；null 时这个来源没有 Skill（例如开发时还没有内置的 Skill）。 */
    readonly root: string | null;
    /** 用户的 Skill 文件夹要监视；随应用分发的不用。 */
    readonly watch: boolean;
}

export interface SkillCatalogOptions {
    readonly roots: readonly SkillRoot[];
    readonly clock: RuntimeClock;
    readonly report: (code: string, message: string, data?: Readonly<Record<string, unknown>>) => void;
    /** 这个 Skill 正在初始化：本进程在装，或别的进程拿着它的安装锁。初始化模块给出；没有时总为假。 */
    readonly installing?: (id: string) => boolean;
    /** 在 `PATH` 上找命令（`Bun.which`）。 */
    readonly which?: (command: string) => string | null;
}

/** 目录里的一项：条目加服务端用的真实目录。 */
export interface SkillItem {
    readonly entry: SkillEntry;
    readonly directory: string;
}

export type SkillTokenResolution = SkillTokenMatch<SkillItem>;

const SOURCE_ORDER: Readonly<Record<SkillSource, number>> = {user: 0, builtin: 1};

export class SkillCatalog {
    readonly #options: SkillCatalogOptions;
    /** 按 id。 */
    #items = new Map<string, SkillItem>();
    readonly #listeners = new Set<() => void>();
    readonly #watchers = new Map<string, FSWatcher>();
    /** 已经报过的“可选字段不合规”，按 id：同样的只报一次，每次重扫都报会刷满诊断。 */
    readonly #ignoredReported = new Map<string, string>();
    /** 等着重扫的来源目录（整个来源）与 Skill 目录（单个 Skill），各自的取消函数。 */
    readonly #pending = new Map<string, () => void>();
    #scanning: Promise<void> = Promise.resolve();
    #closed = false;

    private constructor(options: SkillCatalogOptions) {
        this.#options = options;
    }

    /** 建目录并扫一遍；用户的 Skill 文件夹不存在时建好它（“打开 Skill 文件夹”与监视都要它）。 */
    static async open(options: SkillCatalogOptions): Promise<SkillCatalog> {
        const catalog = new SkillCatalog(options);
        for (const root of options.roots) if (root.watch && root.root !== null) await mkdir(root.root, {recursive: true});
        await catalog.#queue(() => catalog.#rescanAll());
        return catalog;
    }

    /** 我的 Skill 在前、内置在后，同一来源按名字。 */
    list(): readonly SkillEntry[] {
        return [...this.#items.values()].map((item) => item.entry).sort((left, right) => SOURCE_ORDER[left.source] - SOURCE_ORDER[right.source] || left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
    }

    item(id: string): SkillItem | undefined {
        return this.#items.get(id);
    }

    /**
     * 认一个 `$` 标签（skills.md 输出 7）：先按 id，再在整个目录里按 `name`。`allowed` 是会话的 Profile 的白名单。
     */
    resolveToken(token: string, allowed: ReadonlySet<string>): SkillTokenResolution {
        return matchSkillToken(token, this.#items.values(), (item) => item.entry, allowed);
    }

    /** 目录内容变了时调用；返回取消订阅的函数。 */
    onChanged(listener: () => void): () => void {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }

    /** 重扫一个 Skill（初始化开始与结束时由初始化模块调用）；完成后目录已更新。 */
    async refresh(id: string): Promise<void> {
        const item = this.#items.get(id);
        if (item === undefined) return;
        await this.#queue(() => this.#rescanSkill(item.entry.source, item.directory));
    }

    /** 等排队中的重扫做完（测试与停止用）。 */
    async settled(): Promise<void> {
        await this.#scanning;
    }

    async close(): Promise<void> {
        this.#closed = true;
        for (const cancel of this.#pending.values()) cancel();
        this.#pending.clear();
        for (const watcher of this.#watchers.values()) watcher.close();
        this.#watchers.clear();
        this.#listeners.clear();
        await this.#scanning;
    }

    /**
     * 重扫一个接一个地做：两次重扫交错时，后完成的会拿旧的结果盖掉新的。每次重扫后都对一遍监视器（新出现的 `node_modules`
     * 不改变条目，也要开始监视），内容变了才通知。
     */
    #queue(work: () => Promise<boolean>): Promise<void> {
        const run = this.#scanning.then(async () => {
            if (this.#closed) return;
            const changed = await work();
            this.#syncWatchers();
            if (changed) for (const listener of [...this.#listeners]) listener();
        });
        this.#scanning = run.catch((error: unknown) => this.#options.report("skills-scan-failed", "Skill catalog rescan failed", {message: error instanceof Error ? error.message : String(error)}));
        return this.#scanning;
    }

    async #rescanAll(): Promise<boolean> {
        const next = new Map<string, SkillItem>();
        for (const root of this.#options.roots) {
            for (const item of await this.#scanRoot(root.source, root.root)) next.set(item.entry.id, item);
        }
        return this.#replace(next, () => true);
    }

    async #rescanRoot(source: SkillSource): Promise<boolean> {
        const root = this.#options.roots.find((candidate) => candidate.source === source);
        const fresh = await this.#scanRoot(source, root?.root ?? null);
        const next = new Map([...this.#items].filter(([, item]) => item.entry.source !== source));
        for (const item of fresh) next.set(item.entry.id, item);
        return this.#replace(next, (item) => item.entry.source === source);
    }

    async #rescanSkill(source: SkillSource, directory: string): Promise<boolean> {
        const folder = basename(directory);
        const id = skillId(source, folder);
        const next = new Map(this.#items);
        const present = await lstat(directory).then(() => true, () => false);
        if (present) next.set(id, await this.#readItem(source, directory, folder));
        else next.delete(id);
        return this.#replace(next, (item) => item.entry.id === id);
    }

    /** 换上新的目录；`touched` 选出这次重扫过的项，只对它们里新出现的无效写诊断。交回内容是否变了。 */
    #replace(next: Map<string, SkillItem>, touched: (item: SkillItem) => boolean): boolean {
        for (const item of next.values()) {
            if (!touched(item) || item.entry.problem === undefined || item.entry.status !== "invalid") continue;
            const before = this.#items.get(item.entry.id)?.entry.problem;
            if (JSON.stringify(before) !== JSON.stringify(item.entry.problem)) {
                this.#options.report("skill-invalid", `Skill ${item.entry.id} is invalid: ${item.entry.problem.code}`, {id: item.entry.id, problem: item.entry.problem});
            }
        }
        const changed = next.size !== this.#items.size || [...next].some(([id, item]) => JSON.stringify(this.#items.get(id)?.entry) !== JSON.stringify(item.entry));
        this.#items = next;
        return changed;
    }

    async #scanRoot(source: SkillSource, root: string | null): Promise<SkillItem[]> {
        if (root === null) return [];
        const children = await readdir(root, {withFileTypes: true}).catch((error: unknown) => {
            // 来源目录不存在是常态（还没有内置的 Skill）；别的错误（没有权限、不是目录）让整组 Skill 消失，要留诊断。
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.#options.report("skills-scan-failed", `Cannot read skills folder ${root}`, {source, message: error instanceof Error ? error.message : String(error)});
            return [];
        });
        const items: SkillItem[] = [];
        // 按名字排序：readdir 的顺序随文件系统变，诊断（skill-invalid）的先后要稳定。
        for (const child of children.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))) {
            // 文件与以点开头的条目不是 Skill（`.DS_Store`、编辑器的临时目录）；链接照样列出，状态是无效。
            if (child.name.startsWith(".") || !(child.isDirectory() || child.isSymbolicLink())) continue;
            items.push(await this.#readItem(source, join(root, child.name), child.name));
        }
        return items;
    }

    async #readItem(source: SkillSource, directory: string, folder: string): Promise<SkillItem> {
        const id = skillId(source, folder);
        const base = {id, source, location: skillLocation(id)};
        const read = await readSkillPackage(directory, folder).catch((error: unknown) => ({ok: false as const, problem: {code: "frontmatter-unreadable", detail: error instanceof Error ? error.message : String(error)} satisfies SkillProblem}));
        if (!read.ok) return {directory, entry: {...base, name: folder, description: "", status: "invalid", problem: read.problem}};
        const ignored = read.ignored.join(", ");
        if (ignored !== "" && this.#ignoredReported.get(id) !== ignored) this.#options.report("skill-field-ignored", `Skill ${id}: ignored invalid optional fields ${ignored}`, {id, fields: read.ignored});
        this.#ignoredReported.set(id, ignored);
        const {manifest} = read;
        const ready = await readiness(directory);
        const external = await detectExternal(directory, manifest.compatibility, this.#options.which ?? ((command) => Bun.which(command)));
        const installing = ready.kind !== "no-deps" && (this.#options.installing?.(id) ?? false);
        const problem = ready.kind === "needs-init" && !installing ? ready.problem : undefined;
        return {
            directory,
            entry: {
                ...base,
                name: manifest.name,
                description: manifest.description,
                ...(manifest.whenToUse === undefined ? {} : {whenToUse: manifest.whenToUse}),
                status: installing ? "initializing" : ready.kind === "needs-init" ? "needs-init" : "ready",
                ...(problem === undefined ? {} : {problem}),
                ...(external === undefined ? {} : {external}),
                ...(manifest.license === undefined ? {} : {license: manifest.license}),
                ...(manifest.metadata === undefined ? {} : {metadata: manifest.metadata}),
            },
        };
    }

    /** 让监视器与目录对上：用户来源的根、每个 Skill 目录与它的 `node_modules`。 */
    #syncWatchers(): void {
        if (this.#closed) return;
        const wanted = new Map<string, () => void>();
        for (const root of this.#options.roots) {
            if (!root.watch || root.root === null) continue;
            wanted.set(root.root, () => this.#schedule(`root:${root.source}`, () => this.#rescanRoot(root.source)));
            for (const item of this.#items.values()) {
                if (item.entry.source !== root.source || item.entry.problem?.code === "symlink") continue;
                const rescan = () => this.#schedule(`skill:${item.directory}`, () => this.#rescanSkill(root.source, item.directory));
                wanted.set(item.directory, rescan);
                wanted.set(join(item.directory, "node_modules"), rescan);
            }
        }
        for (const [path, watcher] of this.#watchers) {
            if (wanted.has(path)) continue;
            watcher.close();
            this.#watchers.delete(path);
        }
        for (const [path, onChange] of wanted) {
            if (this.#watchers.has(path)) continue;
            try {
                // 子目录被删掉再建（或改名替换）后是另一个目录，按路径留着的旧监视器收不到它的事件，Bun 也不报错：上一级报出某个
                // 子项变了，就关掉这个子项及其下面的监视器，重扫之后的同步按新的目录重建。
                const watcher = watch(path, {persistent: false}, (_event, filename) => {
                    if (filename !== null) this.#forgetWatchers(join(path, String(filename)));
                    onChange();
                });
                watcher.on("error", () => {
                    watcher.close();
                    if (this.#watchers.get(path) === watcher) this.#watchers.delete(path);
                });
                this.#watchers.set(path, watcher);
            } catch (error) {
                // 还不存在的 `node_modules` 是常态；装好后 Skill 目录的变化会触发重扫，再建它的监视器。
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.#options.report("skills-watch-failed", `Cannot watch ${path}`, {message: error instanceof Error ? error.message : String(error)});
            }
        }
    }

    #forgetWatchers(path: string): void {
        for (const [watched, watcher] of this.#watchers) {
            if (watched !== path && !watched.startsWith(`${path}${sep}`)) continue;
            watcher.close();
            this.#watchers.delete(watched);
        }
    }

    #schedule(key: string, work: () => Promise<boolean>): void {
        if (this.#closed) return;
        this.#pending.get(key)?.();
        this.#pending.set(key, this.#options.clock.schedule(() => {
            this.#pending.delete(key);
            void this.#queue(work);
        }, RESCAN_DELAY_MS));
    }
}
