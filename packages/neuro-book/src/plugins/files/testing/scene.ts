/**
 * `nbook.files` 的多实例测试场景：服务端、项目实例 `P#1` 与绑定它的窗口都是真实的内核实例，各装真实的
 * `nbook.files` 与一个测试插件（`x.hub`、`x.project`、`x.explorer`），场地借用配置的多实例场地（它同时装了
 * `nbook.settings`）。文件在真实临时目录里：项目目录 `<根>/Book`，用户资产根 `<根>/state/user`。只由测试使用。
 */

import {createHash} from "node:crypto";
import {mkdir, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {definitionAt} from "nbook/manifest";
import {settingsWorld} from "nbook/plugins/settings/testing/world";
import type {SettingsWorld} from "nbook/plugins/settings/testing/world";

import {filesBackendPlugin} from "../backend/plugin";
import {descriptor} from "../plugin";
import {filesKey} from "../shared/contracts";
import type {FilesService} from "../shared/contracts";
import {filesBrowserPlugin} from "../web/plugin";

export interface Probe {
    files: FilesService | null;
    remote: ActivationContext["remote"] | null;
}

/** 测试插件：启动即激活；浏览器里取文件客户端，服务端与项目实例里留下 `context.remote` 直接用合同。 */
export function probePlugin(id: string, location: "server" | "project" | "browser", probe: Probe): PluginDefinition {
    return {
        id,
        entries: [defineEntry({
            id: location,
            location,
            activationEvents: ["onStartup"],
            dependencies: location === "browser" ? [{key: filesKey}] : [],
            activate: (context) => {
                if (location === "browser") probe.files = context.services.require(filesKey);
                probe.remote = context.remote;
                return {};
            },
        })],
    };
}

export const probe = (): Probe => ({files: null, remote: null});

export const hash = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");

export function files(of: Probe): FilesService {
    if (of.files === null) throw new Error("测试插件还没激活");
    return of.files;
}

export function remote(of: Probe): ActivationContext["remote"] {
    if (of.remote === null) throw new Error("测试插件还没激活");
    return of.remote;
}

export interface Scene {
    readonly world: SettingsWorld;
    readonly project: string;
    readonly user: string;
    readonly hub: Probe;
    readonly inProject: Probe;
    readonly window: Probe;
}

export type Layout = Readonly<Record<string, string | Uint8Array>>;

/** 在 `root` 下写好文件（相对项目目录或用户资产根）后起三个实例；场地由调用方在用例结束时 `close()`。 */
export async function filesScene(root: string, layout: {readonly project?: Layout; readonly user?: Layout} = {}): Promise<Scene> {
    const project = join(root, "Book");
    const user = join(root, "state", "user");
    await mkdir(project, {recursive: true});
    for (const [base, entries] of [[project, layout.project ?? {}], [user, layout.user ?? {}]] as const) {
        for (const [path, content] of Object.entries(entries)) {
            await mkdir(dirname(join(base, path)), {recursive: true});
            await writeFile(join(base, path), content);
        }
    }
    const hub = probe();
    const world = await settingsWorld(root, [definitionAt("server", descriptor, filesBackendPlugin), probePlugin("x.hub", "server", hub)]);
    try {
        const inProject = probe();
        await world.project(1, [definitionAt("project", descriptor, filesBackendPlugin), probePlugin("x.project", "project", inProject)]);
        const window = probe();
        await world.window("w1", [definitionAt("browser", descriptor, filesBrowserPlugin), probePlugin("x.explorer", "browser", window)]);
        return {world, project, user, hub, inProject, window};
    } catch (error) {
        await world.close();
        throw error;
    }
}

/** 在场景里再起一个绑定同一项目的窗口，测试插件为 `id`。 */
export async function extraWindow(scene: Scene, id: string, options: {readonly bound?: boolean} = {}): Promise<Probe> {
    const extra = probe();
    await scene.world.window(id, [definitionAt("browser", descriptor, filesBrowserPlugin), probePlugin(`x.${id}`, "browser", extra)], options);
    return extra;
}
