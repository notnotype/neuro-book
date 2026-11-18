/**
 * `nbook.stickers` 的服务端入口（docs/specs/agent/stickers.md）：启动时打开表情目录（用户的在 `user://stickers/`，内置的随应用
 * 分发，插件的随 `stickers.packs` 增删），交出 `stickers://`、取图路由、浏览器目录的远程服务与给 `nbook.agent` 的服务。
 */

import {join} from "node:path";

import {HTTP_ROUTES_POINT} from "@notnotype/nb-host/http/contracts";
import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry, provideService} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {fail, ok, provideRemote} from "@notnotype/nb-runtime/remote";

import {SCHEMES_POINT, workspaceFilesKey} from "nbook/plugins/files/shared/contracts";
import {pluginPackagesKey} from "nbook/plugin-platform/backend/packages";
import {clockKey, stateRootKey} from "nbook/shared/host";
import {openExistingFolder} from "nbook/backend/open-folder";

import {descriptor} from "../plugin";
import {packsPoint, STICKERS_POINT, STICKERS_SCHEME, stickersCatalogContract, stickersServiceKey} from "../shared/contracts";
import {browserCatalog, browserSummaries, summaryMarks} from "./browser-catalog";
import {locateBuiltinStickers} from "./builtin-root";
import {StickerCatalog} from "./catalog";
import type {StickerRoot} from "./catalog";
import {StickerEditor} from "./editor";
import type {Edited} from "./editor";
import {packDetail} from "./pack-detail";
import {revealPath} from "./reveal";
import {pluginPackRoots} from "./plugin-roots";
import {createStickerRoutes} from "./routes";
import {stickersScheme} from "./scheme";

/** 编辑的结果交给远程调用：成功按 `shape` 交值（缺省原样），失败交码与原因（每个码的详情都是 `{detail}`）。 */
function answer<T, O = T>(result: Edited<T>, shape: (value: T) => O = (value) => value as unknown as O) {
    return result.ok ? ok(shape(result.value)) : fail(result.code, {detail: result.detail});
}

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
            const files = () => context.services.require(workspaceFilesKey);
            /** 用户的包的文件夹身份令牌：目录扫描时一并取，表情包页改包名、删除、替换时带回，文件夹被别处换掉了就不做。 */
            const identify = async (folders: readonly string[]): Promise<ReadonlyArray<string | null>> => {
                if (folders.length === 0) return [];
                const found = await files().identify(folders.map((folder) => `user://stickers/${folder}`));
                return found.ok ? found.value.items.map((item) => ("token" in item ? item.token : null)) : folders.map(() => null);
            };
            // 内置的随应用分发、一次运行里不变，不监视；找不到目录（安装不全）时只少内置的包。
            const builtinRoot = locateBuiltinStickers();
            if (builtinRoot === null) report("root-unavailable", "内置表情包用不了：应用的安装里没有内置表情包的目录", {source: "builtin"});
            const roots: StickerRoot[] = [
                {key: "user", source: "user", prefix: "user", root: userRoot, watch: true},
                ...(builtinRoot === null ? [] : [{key: "builtin", source: "builtin", prefix: "builtin", root: builtinRoot, watch: false} satisfies StickerRoot]),
            ];
            const catalog = await StickerCatalog.open({roots, clock: context.services.require(clockKey), report, identify});
            const packages = await context.services.resolve(pluginPackagesKey);
            context.onStop(() => catalog.close());
            const editor = new StickerEditor({files, catalog});
            return {
                services: [provideService(stickersServiceKey, {list: () => catalog.list(), onChanged: (listener) => catalog.onChanged(listener)})],
                remote: [provideRemote(stickersCatalogContract, () => ({
                    methods: {
                        catalog: (_input, call) => call.ok(browserCatalog(catalog.list(), report)),
                        packs: (_input, call) => call.ok(browserSummaries(catalog.list(), report, (id) => catalog.item(id)?.counts)),
                        pack: ({id}, call) => {
                            const item = catalog.item(id);
                            return item === undefined ? call.fail("pack-missing", {}) : call.ok(packDetail(item, summaryMarks(catalog.list())(id)));
                        },
                        createPack: async ({folder, title}, call) => answer(await editor.createPack(folder, title ?? null)),
                        updatePack: async ({id, title, description}, call) => answer(await editor.updatePack(id, {title, description}), () => ({})),
                        renamePack: async ({id, folder, token}, call) => answer(await editor.renamePack(id, folder, token)),
                        deletePack: async ({id, token}, call) => answer(await editor.deletePack(id, token), () => ({})),
                        updateSticker: async ({id, file, name, change}, call) => answer(await editor.updateSticker(id, {file, name}, change), () => ({})),
                        deleteSticker: async ({id, file, name}, call) => answer(await editor.deleteSticker(id, {file, name}), () => ({})),
                        listFiles: async ({id, files: wanted}, call) => answer(await editor.listFiles(id, wanted)),
                        deleteFile: async ({id, file}, call) => answer(await editor.deleteFile(id, file), () => ({})),
                        copyPack: async ({id}, call) => answer(await editor.copyPack(id)),
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
                    [HTTP_ROUTES_POINT]: {[descriptor.id]: createStickerRoutes({catalog, files, editor})},
                },
                receivers: {[STICKERS_POINT]: pluginPackRoots({catalog, packages: packages.status === "resolved" ? packages.instance : null, report})},
            };
        },
    })],
};
