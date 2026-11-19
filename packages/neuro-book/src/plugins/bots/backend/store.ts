/**
 * bot 记录（docs/specs/bots/bots.md 输出 6 与“副作用与数据”）：`nbook.bots` 的插件存储里一条应用级记录，存全部 bot。存储没有列举接口，
 * 所以不按 bot 分条。记录格式版本 1：读不懂（损坏、版本不认识）时不改写，由调用方写 `bots.record-unreadable`。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

import {defineRecord} from "nbook/shared/storage";
import type {RecordHandle, StorageService} from "nbook/shared/storage";

const BotRecordSchema = Type.Object({
    id: Type.String(),
    name: Type.String(),
    preset: Type.String(),
    profile: Type.String(),
    createdAt: Type.Integer(),
}, {additionalProperties: false});
export type BotRecord = Static<typeof BotRecordSchema>;

export const BOTS_RECORD = defineRecord({key: "bots", scope: "user", locality: "shared", version: 1, schema: Type.Object({bots: Type.Array(BotRecordSchema)})});

export type ReadBots = {readonly ok: true; readonly bots: readonly BotRecord[]} | {readonly ok: false; readonly unreadable: boolean; readonly detail: string};

export class BotStore {
    private constructor(private readonly handle: RecordHandle<{bots: BotRecord[]}>) {}

    static async open(storage: StorageService): Promise<BotStore | {readonly detail: string}> {
        const opened = await storage.open(BOTS_RECORD);
        return opened.ok ? new BotStore(opened.handle) : {detail: `${opened.code}: ${opened.detail}`};
    }

    /** `unreadable`：记录在但读不懂（损坏、版本不认识）；别的失败是读不了（存储出错）。两种都不当成没有 bot。 */
    async read(): Promise<ReadBots> {
        const snapshot = await this.handle.read();
        switch (snapshot.status) {
            case "missing":
                return {ok: true, bots: []};
            case "ok":
                return {ok: true, bots: snapshot.value.bots};
            case "error":
                return {ok: false, unreadable: false, detail: `${snapshot.code}: ${snapshot.detail}`};
            default:
                return {ok: false, unreadable: true, detail: `${snapshot.status}: ${snapshot.detail}`};
        }
    }

    /**
     * 加一个 bot，同 id 已有时不动。写入结果不确定（`unknown-outcome`）时以重读为准（bots.md 输出 5 的“再读回确认”）。交回写下之后的全部
     * 记录。
     */
    async add(bot: BotRecord): Promise<ReadBots> {
        const updated = await this.handle.update((current) => (current?.bots.some((item) => item.id === bot.id) === true ? current : {bots: [...(current?.bots ?? []), bot]}));
        if (!updated.ok && updated.code !== "unknown-outcome") return {ok: false, unreadable: updated.code === "corrupt" || updated.code === "unsupported-version", detail: `${updated.code}: ${updated.detail}`};
        const read = await this.read();
        if (read.ok && !read.bots.some((item) => item.id === bot.id)) return {ok: false, unreadable: false, detail: `bot ${bot.id} 的记录写下后读不回来`};
        return read;
    }
}
