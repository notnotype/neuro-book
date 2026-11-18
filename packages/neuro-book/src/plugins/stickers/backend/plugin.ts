/**
 * `nbook.stickers` 的服务端入口（docs/specs/agent/stickers.md）：启动时打开表情目录（用户的在 `user://stickers/`，插件的随
 * `stickers.packs` 增删），交出 `stickers://`、取图路由、浏览器目录的远程服务与给 `nbook.agent` 的服务。
 */

import {join} from "node:path";

import {HTTP_ROUTES_POINT} from "@notnotype/nb-host/http/contracts";
import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry, provideService} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {provideRemote} from "@notnotype/nb-runtime/remote";

import {SCHEMES_POINT, workspaceFilesKey} from "nbook/plugins/files/shared/contracts";
import {pluginPackagesKey} from "nbook/plugin-platform/backend/packages";
import {clockKey, stateRootKey} from "nbook/shared/host";
import {openExistingFolder} from "nbook/backend/open-folder";

import {descriptor} from "../plugin";
import {packsPoint, STICKERS_POINT, STICKERS_SCHEME, stickersCatalogContract, stickersServiceKey} from "../shared/contracts";
import {browserCatalog, browserSummaries} from "./browser-catalog";
import {StickerCatalog} from "./catalog";
import type {StickerPackItem} from "./catalog";
import {packDetail} from "./pack-detail";
import {revealPath} from "./reveal";
import {pluginPackRoots} from "./plugin-roots";
import {createStickerRoutes} from "./routes";
import {stickersScheme} from "./scheme";

export const stickersBackendPlugin: PluginDefinition = {
    id: descriptor.id,
    contributionPoints: [packsPoint],
    entries: [defineEntry({
        id: "server",
        location: "server",
        activationEvents: ["onStartup"],
        dependencies: [{key: diagnosticsKey}, {key: stateRootKey}, {key: clockKey}, {key: workspaceFilesKey}, {key: pluginPackagesKey, required: false}],
        provides: [stickersServiceKey],
        remoteProvides: [stickersCatalogContract],
        receives: [STICKERS_POINT],
        contributions: [{capability: SCHEMES_POINT, id: STICKERS_SCHEME, declaration: {}}, {capability: HTTP_ROUTES_POINT, id: descriptor.id, declaration: {}}],
        activate: async (context) => {
            const diagnostics = context.services.require(diagnosticsKey);
            const report = (code: string, message: string, data?: Readonly<Record<string, unknown>>): void => {
                diagnostics.record({level: "warn", event: `stickers.${code}`, message, ...(data === undefined ? {} : {data}), source: {plugin: descriptor.id}});
            };
            const userRoot = join(context.services.require(stateRootKey).path, "user", "stickers");
            const catalog = await StickerCatalog.open({roots: [{key: "user", source: "user", prefix: "user", root: userRoot, watch: true}], clock: context.services.require(clockKey), report});
            const packages = await context.services.resolve(pluginPackagesKey);
            context.onStop(() => catalog.close());
            const files = () => context.services.require(workspaceFilesKey);
            /** 用户的包的文件夹身份令牌：表情包页改包名、删除、替换时带回，文件夹被别处换掉了就不做。 */
            const tokenOf = async (item: StickerPackItem): Promise<string | null> => {
                if (item.entry.source !== "user") return null;
                const found = await files().identify([`user://stickers/${item.entry.folder}`]);
                const first = found.ok ? found.value.items[0] : undefined;
                return first !== undefined && "token" in first ? first.token : null;
            };
            return {
                services: [provideService(stickersServiceKey, {list: () => catalog.list(), onChanged: (listener) => catalog.onChanged(listener)})],
                remote: [provideRemote(stickersCatalogContract, () => ({
                    methods: {
                        catalog: (_input, call) => call.ok(browserCatalog(catalog.list(), report)),
                        packs: (_input, call) => call.ok(browserSummaries(catalog.list(), report, (id) => catalog.item(id)?.counts)),
                        pack: async ({id}, call) => {
                            const item = catalog.item(id);
                            return item === undefined ? call.fail("pack-missing", {}) : call.ok(packDetail(item, await tokenOf(item)));
                        },
                        revealPack: async ({id}, call) => {
                            const path = await revealPath(catalog, userRoot, id);
                            if (path === null) return call.fail("pack-missing", {});
                            const opened = await openExistingFolder(path, process.env, process.platform);
                            if (opened.ok) return call.ok({});
                            return opened.code === "no-desktop" ? call.fail("no-desktop", {path}) : call.fail("open-failed", {path, detail: opened.detail ?? ""});
                        },
                    },
                    events: {
                        changed: {
                            subscribe(_filter, sink, call) {
                                if (call.signal.aborted) return;
                                const stop = catalog.onChanged(() => sink.next({}));
                                call.signal.addEventListener("abort", stop, {once: true});
                            },
                        },
                    },
                }))],
                contributions: {
                    [SCHEMES_POINT]: {[STICKERS_SCHEME]: stickersScheme(catalog, userRoot)},
                    [HTTP_ROUTES_POINT]: {[descriptor.id]: createStickerRoutes({catalog, files})},
                },
                receivers: {[STICKERS_POINT]: pluginPackRoots({catalog, packages: packages.status === "resolved" ? packages.instance : null, report})},
            };
        },
    })],
};
