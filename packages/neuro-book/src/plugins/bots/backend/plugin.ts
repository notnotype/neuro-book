/**
 * `nbook.bots` 的服务端入口（docs/specs/bots/bots.md、main-conversation.md）：交出岗位 Profile、接收 `bots.presets`、提供远程服务
 * `nbook.bots/bots`；后台任务在收到自己的缺省预设声明时开始（这时交出的岗位 Profile 已交给 `nbook.agent`）。
 *
 * 激活里不读写会话（agent/contributions.md 输出 3）：`agentKey` 只在后台任务与远程方法里用。停止的先后：停止信号封住新的工作，`onStop`
 * 等在途的一步，再放掉全部持有；这些都在 `nbook.agent` 停止之前（它是依赖）。
 */

import {join} from "node:path";

import {HTTP_ROUTES_POINT} from "@notnotype/nb-host/http/contracts";
import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {provideRemote} from "@notnotype/nb-runtime/remote";

import {agentKey, PROFILES_POINT} from "nbook/plugins/agent/shared/contracts";
import {storageKey} from "nbook/plugins/storage/shared/contracts";
import {pluginPackagesKey} from "nbook/plugin-platform/backend/packages";
import {entryInside} from "nbook/plugin-platform/backend/plugin-files";
import {clockKey, stateRootKey} from "nbook/shared/host";

import {descriptor} from "../plugin";
import {BOTS_PLUGIN, botsContract, DEFAULT_PRESET, PRESETS_POINT, presetsPoint} from "../shared/contracts";
import {BotService} from "./bots";
import {locateBuiltinBots} from "./builtin-root";
import {MainConversations} from "./main";
import {PresetTable} from "./presets";
import type {PresetLocator} from "./presets";
import {createAvatarRoutes} from "./avatar";
import {COMPANION, companionProfile} from "./profile";
import {BotStore} from "./store";
import {UnreadTracker} from "./unread";

/** `ensureMain` 失败时带详情的码（合同里这些码的详情是 `{detail?}`）。 */
const DETAILED = new Set(Object.keys(botsContract.methods.ensureMain.errors).filter((code) => code !== "unknown-bot" && code !== "owner-mismatch"));

/** `locateBuiltin` 找自己的预设文件的根：缺省按应用的安装找，测试传别的来模拟安装里没有这个目录。 */
export function createBotsBackendPlugin(locateBuiltin: () => string | null = locateBuiltinBots): PluginDefinition {
    return {
        id: descriptor.id,
        contributionPoints: [presetsPoint],
        entries: [defineEntry({
            id: "server",
            location: "server",
            activationEvents: ["onStartup", COMPANION.activationEvent],
            dependencies: [{key: diagnosticsKey}, {key: stateRootKey}, {key: clockKey}, {key: storageKey}, {key: agentKey}, {key: pluginPackagesKey, required: false}],
            remoteProvides: [botsContract],
            receives: [PRESETS_POINT],
            contributions: [COMPANION.contribution, {capability: HTTP_ROUTES_POINT, id: descriptor.id, declaration: {}}],
            activate: async (context) => {
                const diagnostics = context.services.require(diagnosticsKey);
                const record = (level: "info" | "warn", code: string, message: string, data?: Readonly<Record<string, unknown>>): void => {
                    diagnostics.record({level, event: `bots.${code}`, message, ...(data === undefined ? {} : {data}), source: {plugin: descriptor.id}});
                };
                const report = (code: string, message: string, data?: Readonly<Record<string, unknown>>): void => record("warn", code, message, data);
                const clock = context.services.require(clockKey);
                const agent = context.services.require(agentKey);
                const packages = await context.services.resolve(pluginPackagesKey);
                const builtinRoot = locateBuiltin();
                if (builtinRoot === null) report("builtin-missing", "应用的安装里没有 nbook.bots 的内置资源目录");
                const locate: PresetLocator = async (plugin, path, kind) => {
                    if (plugin === BOTS_PLUGIN) {
                        if (builtinRoot === null) return null;
                        const found = await entryInside(builtinRoot, path.split("/"), kind);
                        return typeof found === "object" && "path" in found ? found.path : null;
                    }
                    if (packages.status !== "resolved") return null;
                    return kind === "file" ? packages.instance.file(plugin, path) : packages.instance.directory(plugin, path);
                };
                const storage = context.services.require(storageKey);
                const opened = await BotStore.open(storage);
                if (!("read" in opened)) report("record-failed", `打不开 bot 记录：${opened.detail}`, {detail: opened.detail});
                let service: BotService | null = null;
                const unread = new UnreadTracker({agent, storage, report, changed: () => service?.changed()});
                await unread.load();
                const main = new MainConversations({agent, clock, report: record, changed: () => service?.changed(), held: (bot) => unread.track(bot.id)});
                const presets = new PresetTable({locate, report, received: (handle) => {
                    if (handle.plugin === BOTS_PLUGIN && handle.id === DEFAULT_PRESET) service?.start();
                }});
                const root = join(context.services.require(stateRootKey).path, "user", "bots");
                service = new BotService({store: "read" in opened ? opened : null, root, presets, main, unread, clock, signal: context.signal, report});
                const bots = service;
                context.signal.addEventListener("abort", () => main.seal(), {once: true});
                context.onStop(async () => {
                    main.seal();
                    await bots.stop();
                    unread.stop();
                    await main.stop();
                });
                return {
                    contributions: {
                        [PROFILES_POINT]: {[COMPANION.contribution.id]: companionProfile()},
                        [HTTP_ROUTES_POINT]: {[descriptor.id]: createAvatarRoutes({root, known: (botId) => bots.has(botId)})},
                    },
                    receivers: {[PRESETS_POINT]: presets.receiver},
                    remote: [provideRemote(botsContract, () => ({
                        methods: {
                            list: (_input, call) => call.ok(bots.list()),
                            markSeen: async ({botId, through}, call) => {
                                const seen = await bots.markSeen(botId, through);
                                if (seen.ok) return call.ok({seenSeq: seen.seenSeq});
                                return seen.code === "unknown-bot" ? call.fail("unknown-bot", {}) : call.fail("storage-failed", {detail: seen.detail});
                            },
                            ensureMain: async ({botId}, call) => {
                                const ensured = await bots.ensureMain(botId);
                                if (ensured.ok) return call.ok({sessionId: ensured.sessionId});
                                if (ensured.code === "unknown-bot") return call.fail("unknown-bot", {});
                                if (ensured.code === "owner-mismatch") return call.fail("owner-mismatch", {});
                                if (!DETAILED.has(ensured.code)) throw new Error(`ensureMain failed with an undeclared code: ${ensured.code}`);
                                return call.fail(ensured.code as "open-failed", ensured.detail === undefined ? {} : {detail: ensured.detail as Record<string, unknown>});
                            },
                        },
                        events: {
                            botsChanged: {
                                subscribe(_filter, sink, call) {
                                    if (call.signal.aborted) return;
                                    const stop = bots.onChanged(() => sink.next(bots.list()));
                                    call.signal.addEventListener("abort", stop, {once: true});
                                },
                            },
                        },
                    }))],
                };
            },
        })],
    };
}

export const botsBackendPlugin = createBotsBackendPlugin();
