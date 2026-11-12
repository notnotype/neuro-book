/**
 * 设置服务的适配对过模型服务的存储合同：真实的设置场地（真实服务端、真实设置文件），设置服务以 `nbook.models` 的身份取得，
 * 与产品里服务端入口拿到的一样。“别处的写入”直接改设置文件，推手动时钟让拥有者重读；用户层坏掉是文件写成不合法的 JSON。
 * 用户层读不了（`unavailable`）在这个场地里做不出来，只由内存实现核对。
 */

import {afterAll, beforeAll} from "bun:test";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";

import {runModelsConfigStoreContract} from "@notnotype/nb-models/testing";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {definitionAt} from "nbook/manifest";
import {RELOAD_DELAY_MS} from "nbook/plugins/settings/backend/layer-owner";
import {settingsKey} from "nbook/plugins/settings/shared/contracts";
import {settingsWorld} from "nbook/plugins/settings/testing/world";
import type {SettingsService} from "nbook/shared/settings";

import {descriptor} from "../plugin";
import {modelsSettings} from "../shared/settings";
import {settingsModelsConfig} from "./settings-store";

let root = "";
let counter = 0;

beforeAll(async () => {
    root = await createTestTmpRoot("neuro-book-models", "settings-store");
});
afterAll(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

async function readUserFile(path: string): Promise<Record<string, unknown>> {
    try {
        return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
        throw error;
    }
}

runModelsConfigStoreContract("nbook.settings 的适配", async () => {
    counter += 1;
    let settings: SettingsService | null = null;
    // 与服务端入口同一个插件 id：设置服务按调用方核对谁能写这些项。
    const entry = definitionAt("server", descriptor, {id: descriptor.id, entries: [defineEntry({id: "server", location: "server", activationEvents: ["onStartup"], dependencies: [{key: settingsKey}], activate: (context) => {
        settings = context.services.require(settingsKey);
        return {};
    }})]});
    const world = await settingsWorld(join(root, `world-${String(counter)}`), [entry]);
    if (settings === null) throw new Error("the settings stand-in did not activate");
    const keys = {providers: modelsSettings.settings.providers.key, roles: modelsSettings.settings.roles.key};
    return {
        store: settingsModelsConfig(settings),
        writeExternally: async (key, value) => {
            await mkdir(dirname(world.userFile), {recursive: true});
            const file = await readUserFile(world.userFile);
            await writeFile(world.userFile, JSON.stringify({...file, [keys[key]]: value}));
        },
        settle: () => world.clock.advance(RELOAD_DELAY_MS),
        breakLayer: async () => {
            await mkdir(dirname(world.userFile), {recursive: true});
            await writeFile(world.userFile, "{\"nbook.models/providers\": [");
        },
        close: async () => {
            for (const result of await world.close()) if (result.status !== "closed") throw new Error(`an instance did not close: ${JSON.stringify(result)}`);
        },
    };
}, ["invalid"]);
