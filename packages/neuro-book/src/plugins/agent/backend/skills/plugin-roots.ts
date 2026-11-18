/**
 * 插件经 `agent.skills` 带来的 Skill 根（docs/specs/agent/skills.md 的插件来源）：贡献发布时按声明的目录给目录服务加一个根，
 * 撤回时拿掉。运行中登记、停掉插件，Skill 跟着出现、消失。
 *
 * 目录经平台的插件包查询取真实路径（只有第三方插件有安装目录）。查询是异步的：查回来之前贡献可能已经撤回，或撤回后又发布了
 * 一次，所以每次发布记一个号，查回来时号不是当前的就不加。
 */

import type {ContributionReceiver} from "@notnotype/nb-runtime/plugins";

import type {PluginPackages} from "nbook/plugin-platform/backend/packages";

import type {AgentSkillsDeclaration} from "../../shared/points";
import type {SkillCatalog} from "./catalog";

export interface PluginSkillRootsOptions {
    readonly catalog: SkillCatalog;
    /** 没有平台的插件包查询（项目子进程、只装 Agent 的测试）时为 null：插件的贡献只写诊断。 */
    readonly packages: PluginPackages | null;
    readonly report: (code: string, message: string, data?: Readonly<Record<string, unknown>>) => void;
}

export function pluginSkillRoots(options: PluginSkillRootsOptions): ContributionReceiver<AgentSkillsDeclaration> {
    /** 已发布、还没撤回的贡献，值是这次发布的号。 */
    const live = new Map<string, number>();
    let counter = 0;
    return {
        published: (handle) => {
            const token = (counter += 1);
            live.set(handle.id, token);
            void (async () => {
                const {directory} = handle.declaration;
                const root = options.packages === null ? null : await options.packages.directory(handle.plugin, directory);
                if (live.get(handle.id) !== token) return;
                if (root === null) {
                    options.report("skills-root-unavailable", `Skills of ${handle.plugin} are unavailable: ${directory} is not a directory inside the installed plugin`, {plugin: handle.plugin, contribution: handle.id, directory});
                    return;
                }
                // 号核对与加根之间没有 await：加根同步排进目录的重扫队列，之后到的撤回，它的 removeRoot 一定排在后面。
                await options.catalog.addRoot({key: handle.id, source: "plugin", prefix: handle.plugin, root, watch: false, plugin: {id: handle.plugin, title: options.packages?.title(handle.plugin) ?? null}});
            })().catch((error: unknown) => options.report("skills-root-unavailable", `Skills of ${handle.plugin} are unavailable`, {plugin: handle.plugin, contribution: handle.id, message: error instanceof Error ? error.message : String(error)}));
        },
        revoke: async (handle) => {
            live.delete(handle.id);
            await options.catalog.removeRoot(handle.id);
        },
    };
}
