/**
 * 贡献点 `bots.presets` 的接收方（docs/specs/bots/bots.md 输出 1 与“时序与寿命”）：被平台接受的声明在这里核对文件，合规的记进“可用的
 * 预设”表，不合的写 `bots.preset-invalid`；撤回时拿掉。
 *
 * 核对是异步的：每次发布按贡献 id 记一个号，查完之后在没有 `await` 的一段里再核对号才写表，所以撤回之后才查完的结果作废，也不会盖掉
 * 同一个 id 后来发布的那份（做法同 `stickers/backend/plugin-roots.ts`）。
 */

import {lstat, readdir} from "node:fs/promises";
import {extname, join} from "node:path";

import type {ContributionHandle, ContributionReceiver} from "@notnotype/nb-runtime/plugins";

import {AVATAR_EXTENSIONS, AVATAR_MAX_BYTES, PERSONA_MAX_BYTES, SEED_MAX_BYTES, SEED_MAX_FILES} from "../shared/contracts";
import type {BotPresetDeclaration} from "../shared/contracts";

/** 按插件包里的相对路径找真实路径：是这一种（普通文件或目录）、在插件包里、各段都不是链接时交回，否则 null。 */
export type PresetLocator = (plugin: string, path: string, kind: "file" | "directory") => Promise<string | null>;

/** 核对过的预设：文件已换成真实路径。 */
export interface AvailablePreset {
    readonly id: string;
    readonly plugin: string;
    readonly declaration: BotPresetDeclaration;
    readonly persona: string;
    readonly avatar: string;
    readonly memorySeed: string | null;
}

type Checked = {readonly ok: true; readonly preset: AvailablePreset} | {readonly ok: false; readonly reason: string};

export interface PresetTableOptions {
    readonly locate: PresetLocator;
    readonly report: (code: string, message: string, data: Readonly<Record<string, unknown>>) => void;
    /** 收到一份声明（核对之前）：`nbook.bots` 据此在收到自己的缺省预设时开始后台任务。 */
    readonly received?: (handle: ContributionHandle<BotPresetDeclaration>) => void;
}

export class PresetTable {
    readonly #available = new Map<string, AvailablePreset>();
    /** 每个预设 id 当前这一代：号与它的核对结果。撤回时拿掉，查完时号不是当前的就作废。 */
    readonly #live = new Map<string, {readonly token: number; readonly result: Promise<AvailablePreset | null>}>();
    #counter = 0;

    constructor(private readonly options: PresetTableOptions) {}

    get(id: string): AvailablePreset | undefined {
        return this.#available.get(id);
    }

    /** 等这个预设当前这一代核对完：可用交回它；不可用、核对期间被撤回或没有这个声明时交回 null。 */
    async settled(id: string): Promise<AvailablePreset | null> {
        const live = this.#live.get(id);
        if (live === undefined) return null;
        const preset = await live.result;
        return this.#live.get(id) === live ? preset : null;
    }

    readonly receiver: ContributionReceiver<BotPresetDeclaration> = {
        published: (handle) => {
            const token = (this.#counter += 1);
            const result = check(this.options.locate, handle.plugin, handle.id, handle.declaration).then((checked) => {
                // 号核对与写表之间没有 await：之后到的撤回一定排在后面。
                if (this.#live.get(handle.id)?.token !== token) return null;
                if (!checked.ok) {
                    this.options.report("preset-invalid", `${handle.plugin} 的预设 ${handle.id} 不可用：${checked.reason}`, {plugin: handle.plugin, preset: handle.id, reason: checked.reason});
                    return null;
                }
                this.#available.set(handle.id, checked.preset);
                return checked.preset;
            }, (error: unknown) => {
                if (this.#live.get(handle.id)?.token === token) this.options.report("preset-invalid", `${handle.plugin} 的预设 ${handle.id} 不可用：读文件出错`, {plugin: handle.plugin, preset: handle.id, reason: error instanceof Error ? error.message : String(error)});
                return null;
            });
            this.#live.set(handle.id, {token, result});
            this.options.received?.(handle);
        },
        revoke: (handle) => {
            this.#live.delete(handle.id);
            this.#available.delete(handle.id);
        },
    };
}

/** 文件核对（bots.md“输入与前置条件”）：不在、越出插件包、不是普通文件、超出大小或数量的都不可用。 */
async function check(locate: PresetLocator, plugin: string, id: string, declaration: BotPresetDeclaration): Promise<Checked> {
    if (extname(declaration.persona).toLowerCase() !== ".md") return {ok: false, reason: `人设要是 Markdown 文件（.md）：${declaration.persona}`};
    const extension = extname(declaration.avatar).slice(1).toLowerCase();
    if (!(AVATAR_EXTENSIONS as readonly string[]).includes(extension)) return {ok: false, reason: `头像要是 ${AVATAR_EXTENSIONS.join("、")} 图片：${declaration.avatar}`};
    const persona = await sizedFile(locate, plugin, declaration.persona, PERSONA_MAX_BYTES);
    if (typeof persona !== "string") return persona;
    const avatar = await sizedFile(locate, plugin, declaration.avatar, AVATAR_MAX_BYTES);
    if (typeof avatar !== "string") return avatar;
    let memorySeed: string | null = null;
    if (declaration.memorySeed !== undefined) {
        const found = await locate(plugin, declaration.memorySeed, "directory");
        if (found === null) return {ok: false, reason: `记忆种子不是插件包里的目录：${declaration.memorySeed}`};
        const problem = await seedProblem(found);
        if (problem !== null) return {ok: false, reason: `记忆种子 ${declaration.memorySeed}：${problem}`};
        memorySeed = found;
    }
    return {ok: true, preset: {id, plugin, declaration, persona, avatar, memorySeed}};
}

async function sizedFile(locate: PresetLocator, plugin: string, path: string, max: number): Promise<string | {readonly ok: false; readonly reason: string}> {
    const found = await locate(plugin, path, "file");
    if (found === null) return {ok: false, reason: `${path} 不是插件包里的普通文件`};
    const {size} = await lstat(found);
    return size > max ? {ok: false, reason: `${path} 有 ${String(size)} 字节，超过 ${String(max)}`} : found;
}

/** 记忆种子：只有普通文件与目录，不含链接；至多 200 个文件、合计不大于 4 MiB。 */
async function seedProblem(root: string): Promise<string | null> {
    let files = 0;
    let bytes = 0;
    const pending = [root];
    while (pending.length > 0) {
        const directory = pending.pop()!;
        for (const entry of await readdir(directory, {withFileTypes: true})) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) {
                pending.push(path);
                continue;
            }
            if (!entry.isFile()) return `${entry.name} 不是普通文件或目录`;
            files += 1;
            bytes += (await lstat(path)).size;
            if (files > SEED_MAX_FILES) return `多于 ${String(SEED_MAX_FILES)} 个文件`;
            if (bytes > SEED_MAX_BYTES) return `合计超过 ${String(SEED_MAX_BYTES)} 字节`;
        }
    }
    return null;
}
