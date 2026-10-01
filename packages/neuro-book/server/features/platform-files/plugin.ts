/**
 * platform.files 内置插件：把宿主声明的根与授予装配成受根约束的文件能力。
 *
 * 工厂只闭包静态配置（根 id、路径、操作上界与授予键），import 与工厂调用都不做 I/O；
 * 根的存在性、目录类型与真实路径身份在激活时校验，失败即激活失败。每个授予是独立服务键：
 * 受信消费者只能解析自己在清单里声明依赖的授予键，静态依赖图就是签发边界。服务实例与其
 * 内部资源（watcher、锁、文件出口）全部在 `release` 内按序关闭，不另行登记到激活作用域。
 */

import {stat, realpath} from "node:fs/promises";

import type {RuntimeLocation} from "nbook/runtime/lifecycle/lifecycle";
import {provide} from "nbook/runtime/plugins/plugins";
import type {ActivationOutput, PluginDefinition, ProvidedService} from "nbook/runtime/plugins/plugins";
import type {ServiceKey} from "nbook/runtime/services/services";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";

import {PlatformFilesError, platformFilesKey} from "./contracts";
import type {GrantSpec, RootGrant, RootOperation, RootSpec} from "./contracts";
import {normalizeOperations} from "./grants";
import {nodeErrorCode} from "./paths";
import {PlatformFilesService} from "./service";
import type {ResolvedRoot} from "./service";

/** 插件 id；宿主清单用它引用本插件。 */
export const platformFilesPluginId = "nbook.platform-files";

export interface PlatformFilesPluginOptions {
    readonly roots: ReadonlyArray<RootSpec>;
    /** 每份授予签发一个独立服务键；操作集合不得超出对应根的 `maxOperations`。 */
    readonly grants: ReadonlyArray<GrantSpec>;
    /** 入口位置；缺省 server。 */
    readonly location?: RuntimeLocation;
}

interface NormalizedRoot {
    readonly id: string;
    readonly path: AbsoluteFsPath;
    readonly maxOperations: ReadonlyArray<RootOperation>;
}

interface NormalizedGrant {
    readonly key: ServiceKey<RootGrant>;
    readonly root: string;
    readonly operations: ReadonlyArray<RootOperation>;
}

interface StaticConfig {
    readonly roots: ReadonlyArray<NormalizedRoot>;
    readonly grants: ReadonlyArray<NormalizedGrant>;
}

export function createPlatformFilesPlugin(options: PlatformFilesPluginOptions): PluginDefinition {
    const config = normalizeConfig(options);
    return {
        id: platformFilesPluginId,
        entries: [
            {
                id: "main",
                location: options.location ?? "server",
                provides: [platformFilesKey, ...config.grants.map((grant) => grant.key)],
                activate: () => activatePlatformFiles(config),
            },
        ],
    };
}

/** 静态校验：重复身份、未声明的根与超出根上界的授予都在工厂调用时拒绝。 */
function normalizeConfig(options: PlatformFilesPluginOptions): StaticConfig {
    if (options.roots.length === 0) {
        throw new TypeError("platform-files 至少需要一个根");
    }
    const roots = new Map<string, NormalizedRoot>();
    for (const root of options.roots) {
        if (root.id.trim() === "") {
            throw new TypeError("根的 id 不能为空");
        }
        if (roots.has(root.id)) {
            throw new TypeError(`重复的根 id：${root.id}`);
        }
        roots.set(root.id, {
            id: root.id,
            path: requireAbsolutePath(root.path, root.id),
            maxOperations: normalizeOperations(root.maxOperations),
        });
    }
    const grants: NormalizedGrant[] = [];
    const keys = new Set<ServiceKey<RootGrant>>();
    for (const grant of options.grants) {
        const root = roots.get(grant.root);
        if (root === undefined) {
            throw new TypeError(`授予引用了未声明的根：${grant.root}`);
        }
        if (keys.has(grant.key)) {
            throw new TypeError(`授予键重复：${grant.key.name}`);
        }
        const operations = normalizeOperations(grant.operations);
        for (const operation of operations) {
            if (!root.maxOperations.includes(operation)) {
                throw new PlatformFilesError(
                    "permission-denied",
                    `授予请求的操作 ${operation} 超出根 ${root.id} 的 maxOperations`,
                );
            }
        }
        keys.add(grant.key);
        grants.push({key: grant.key, root: root.id, operations});
    }
    return {roots: [...roots.values()], grants};
}

function requireAbsolutePath(input: string, rootId: string): AbsoluteFsPath {
    try {
        return absoluteFsPath(input);
    } catch (error) {
        throw new PlatformFilesError("invalid-path", `根 ${rootId} 必须由宿主提供绝对路径`, {cause: error});
    }
}

/**
 * 激活：校验根身份、创建服务实例并按授予签发根能力；中途失败关闭本次已建的实例。
 *
 * 服务键与每个授予键各自有独立的服务作用域，消费者只借用自己解析的那一个；任一键先释放时若直接
 * 关闭共享实例，会撤销仍被其它键消费者使用的授予。因此每个提供项只登记一次“已放手”，最后一个
 * 放手时才关闭实例；关闭失败让这一项保持未放手，显式恢复重试时不重复计数。
 */
async function activatePlatformFiles(config: StaticConfig): Promise<ActivationOutput> {
    const roots = await resolveRoots(config.roots);
    const service = new PlatformFilesService({roots});
    try {
        const holders = new Set<ServiceKey<unknown>>([platformFilesKey, ...config.grants.map((grant) => grant.key)]);
        const release = (key: ServiceKey<unknown>) => async (): Promise<void> => {
            if (!holders.has(key)) {
                return;
            }
            if (holders.size === 1) {
                await service.close();
            }
            holders.delete(key);
        };
        const services: ProvidedService[] = [provide(platformFilesKey, service, release(platformFilesKey))];
        for (const grant of config.grants) {
            services.push(provide(grant.key, service.issueGrant(grant.root, grant.operations), release(grant.key)));
        }
        return {services};
    } catch (error) {
        await service.close().catch(() => undefined);
        throw error;
    }
}

/** 根必须在激活时存在且为目录；realpath 的结果作为本次激活的根身份。 */
async function resolveRoots(roots: ReadonlyArray<NormalizedRoot>): Promise<ResolvedRoot[]> {
    const resolved: ResolvedRoot[] = [];
    for (const root of roots) {
        const stats = await stat(root.path).catch((error: unknown) => {
            if (nodeErrorCode(error) === "ENOENT") {
                throw new PlatformFilesError("not-found", `根 ${root.id} 不存在`);
            }
            throw new PlatformFilesError("io-failed", `根 ${root.id} 不可读取（${nodeErrorCode(error)}）`, {cause: error});
        });
        if (!stats.isDirectory()) {
            throw new PlatformFilesError("invalid-path", `根 ${root.id} 不是目录`);
        }
        const realPath = await realpath(root.path).catch((error: unknown) => {
            throw new PlatformFilesError("io-failed", `根 ${root.id} 的真实路径无法解析（${nodeErrorCode(error)}）`, {
                cause: error,
            });
        });
        resolved.push({id: root.id, realPath: absoluteFsPath(realPath), maxOperations: root.maxOperations});
    }
    return resolved;
}
