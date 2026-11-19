/**
 * 建 bot 与启动时收拾上次没做完的（docs/specs/bots/bots.md 输出 5）。顺序：
 *
 * 1. 复制进 `<bots>/.staging-<随机>/`，最后写创建凭据 `.created.json`；
 * 2. 把暂存目录改名成 `<bot id>/`；
 * 3. 照凭据写 bot 记录，再读回确认。
 *
 * 进程在任何一步之间退出，下次启动都认得出：没有凭据的暂存目录是没复制完的，有凭据、还没改名的也是；改了名、没写下记录的目录凭据还在，
 * 照它补写记录，不再复制。凭据与目录一起改名，所以“目录在、记录不在”时只认读得懂、bot id 对得上的那份。
 */

import {randomUUID} from "node:crypto";
import {copyFile, cp, mkdir, readdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import {extname, join} from "node:path";

import {Type} from "typebox";
import {Value} from "typebox/value";

import {BOT_ID} from "../shared/contracts";
import type {AvailablePreset} from "./presets";
import type {BotRecord, BotStore, ReadBots} from "./store";

export const STAGING_PREFIX = ".staging-";
export const RECEIPT_FILE = ".created.json";
const RECEIPT_FORMAT = 1;

const ReceiptSchema = Type.Object({
    format: Type.Literal(RECEIPT_FORMAT),
    botId: Type.String(),
    record: Type.Object({id: Type.String(), name: Type.String(), preset: Type.String(), profile: Type.String(), createdAt: Type.Integer()}, {additionalProperties: false}),
}, {additionalProperties: false});

export interface BotFilesOptions {
    /** `<状态根>/user/bots`。 */
    readonly root: string;
    readonly store: BotStore;
    readonly report: (code: string, message: string, data: Readonly<Record<string, unknown>>) => void;
}

/** 按预设建一个 bot；交回写下之后的全部记录。`<bot id>/` 已经在时不覆盖，交回失败。 */
export async function createBot(options: BotFilesOptions, preset: AvailablePreset, botId: string, now: number): Promise<ReadBots> {
    if (!BOT_ID.test(botId)) throw new TypeError(`bot id 不合规则：${botId}`);
    const record: BotRecord = {id: botId, name: preset.declaration.name, preset: preset.id, profile: preset.declaration.profile, createdAt: now};
    const staging = join(options.root, `${STAGING_PREFIX}${randomUUID()}`);
    await mkdir(staging, {recursive: true});
    try {
        await copyFile(preset.persona, join(staging, "persona.md"));
        await copyFile(preset.avatar, join(staging, `avatar${extname(preset.avatar).toLowerCase()}`));
        if (preset.memorySeed !== null) await cp(preset.memorySeed, join(staging, "memory"), {recursive: true});
        await writeFile(join(staging, RECEIPT_FILE), JSON.stringify({format: RECEIPT_FORMAT, botId, record}));
        // 目标已在时 rename 在 POSIX 上会替换空目录、在 Windows 上失败：先查，不覆盖用户的目录。
        const target = join(options.root, botId);
        if ((await readdir(options.root)).includes(botId)) return {ok: false, unreadable: false, detail: `${target} 已经在了，不覆盖`};
        await rename(staging, target);
    } catch (error) {
        await rm(staging, {recursive: true, force: true});
        throw error;
    }
    return options.store.add(record);
}

/**
 * 启动时（bots.md 输出 5 的第二段）：`<bot id>/` 在、记录不在的，凭据读得懂、bot id 对得上就补写记录，否则写 `bots.directory-unknown`、
 * 不登记不覆盖；`.staging-*` 里有凭据或是空的删掉，别的不动。交回补写之后的记录。
 */
export async function recoverBots(options: BotFilesOptions, bots: readonly BotRecord[]): Promise<ReadBots> {
    let current: ReadBots = {ok: true, bots};
    let names: string[];
    try {
        names = await readdir(options.root);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return current;
        throw error;
    }
    for (const name of names) {
        const path = join(options.root, name);
        if (name.startsWith(STAGING_PREFIX)) {
            const inside = await readdir(path).catch(() => null);
            if (inside !== null && (inside.length === 0 || inside.includes(RECEIPT_FILE))) await rm(path, {recursive: true, force: true});
            continue;
        }
        if (name.startsWith(".") || !BOT_ID.test(name) || !current.ok || current.bots.some((bot) => bot.id === name)) continue;
        const receipt = await readReceipt(path);
        if (receipt === null || receipt.botId !== name || receipt.record.id !== name) {
            options.report("directory-unknown", `bot 目录 ${name} 在、记录不在，又没有读得懂的创建凭据：不登记`, {bot: name});
            continue;
        }
        current = await options.store.add(receipt.record);
    }
    return current;
}

async function readReceipt(directory: string): Promise<{readonly botId: string; readonly record: BotRecord} | null> {
    const text = await readFile(join(directory, RECEIPT_FILE), "utf8").catch(() => null);
    if (text === null) return null;
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        return null;
    }
    return Value.Check(ReceiptSchema, value) ? value : null;
}
