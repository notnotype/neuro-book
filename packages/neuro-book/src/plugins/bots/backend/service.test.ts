/**
 * bot 服务的启动先后（docs/specs/bots/bots.md 输出 4 与“时序与寿命”）：`ensureMain` 等后台任务建好 bot 再做，建出来时推一次变化。缺省
 * 预设的文件核对要卡在半路，真实插件激活里造不出这个时刻：预设表与建 bot 用真的（真实文件、按入口同一个查找），记录存储与主对话用照
 * 合同写的替身（真实的存储与持有由 `bots.test.ts` 测）。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {mkdir, readdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import type {ContributionHandle} from "@notnotype/nb-runtime/plugins";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {entryInside} from "nbook/plugin-platform/backend/plugin-files";

import {DEFAULT_PRESET} from "../shared/contracts";
import type {BotPresetDeclaration} from "../shared/contracts";
import {BotService} from "./bots";
import type {MainConversations} from "./main";
import {PresetTable} from "./presets";
import type {BotRecord, BotStore, ReadBots} from "./store";
import type {UnreadTracker} from "./unread";

let tmp = "";
beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-bots", "service");
});
afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

describe("bot 服务的启动先后", () => {
    test("输出 4、时序与寿命：后台任务建好 bot 之前到的 ensureMain 等它；建出来时推一次变化，list 里有它", async () => {
        const builtin = join(tmp, "builtin");
        await mkdir(join(builtin, "lyra"), {recursive: true});
        await writeFile(join(builtin, "lyra", "persona.md"), "人设");
        await writeFile(join(builtin, "lyra", "avatar.webp"), "图");
        let open!: () => void;
        const checking = new Promise<void>((resolve) => {
            open = resolve;
        });
        const presets = new PresetTable({report: () => undefined, locate: async (_plugin, path, kind) => {
            await checking;
            const found = await entryInside(builtin, path.split("/"), kind);
            return typeof found === "object" && "path" in found ? found.path : null;
        }});
        let saved: BotRecord[] = [];
        const store = {
            read: async (): Promise<ReadBots> => ({ok: true, bots: saved}),
            add: async (bot: BotRecord): Promise<ReadBots> => {
                saved = [...saved, bot];
                return {ok: true, bots: saved};
            },
        } as unknown as BotStore;
        const ensured: string[] = [];
        const main = {
            state: () => ({state: "none"}),
            ensure: async (bot: BotRecord) => {
                ensured.push(bot.id);
                return {ok: true, sessionId: `bot-${bot.id}`};
            },
        } as unknown as MainConversations;
        const root = join(tmp, "user-bots");
        const unread = {item: () => ({unread: null, latestSeq: 0, seenSeq: 0, last: null})} as unknown as UnreadTracker;
        const service = new BotService({store, root, presets, main, unread, clock: {now: () => 7, schedule: () => () => undefined}, signal: new AbortController().signal, report: () => undefined});
        const pushed: string[][] = [];
        service.onChanged(() => pushed.push(service.list().map((bot) => bot.id)));

        const early = service.ensureMain("lyra");
        let settled = false;
        void early.then(() => {
            settled = true;
        });
        const declaration: BotPresetDeclaration = {name: "星璃", avatar: "lyra/avatar.webp", profile: "nbook.bots.companion", persona: "lyra/persona.md"};
        presets.receiver.published!({id: DEFAULT_PRESET, plugin: "nbook.bots", declaration} as unknown as ContributionHandle<BotPresetDeclaration>, undefined);
        service.start();
        for (let round = 0; round < 5; round += 1) await new Promise((resolve) => setImmediate(resolve));
        expect(settled).toBe(false);
        expect(service.list()).toEqual([]);

        open();
        expect(await early).toEqual({ok: true, sessionId: "bot-lyra"});
        expect(service.list()).toEqual([{id: "lyra", name: "星璃", main: {state: "none"}, unread: null, latestSeq: 0, seenSeq: 0, last: null}]);
        expect(pushed.at(-1)).toEqual(["lyra"]);
        expect(saved).toEqual([{id: "lyra", name: "星璃", preset: DEFAULT_PRESET, profile: "nbook.bots.companion", createdAt: 7}]);
        expect((await readdir(join(root, "lyra"))).sort()).toEqual([".created.json", "avatar.webp", "persona.md"]);
        expect(ensured[0]).toBe("lyra");
        await service.stop();
    });
});
