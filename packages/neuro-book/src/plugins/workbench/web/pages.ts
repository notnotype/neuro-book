/**
 * 页面表：工作台自己的页面加上其它插件经 `workbench.pages` 贡献的页面。宿主在窗口 ready 时按它建立路由。
 */

import type {ContributionDescriptor, ContributionHandle, ContributionReceiver} from "@notnotype/nb-runtime/plugins";

import {WORKBENCH_PAGES_POINT} from "../shared/contracts";
import type {WorkbenchPageDeclaration} from "../shared/contracts";
import type {WorkbenchPage, WorkbenchPageImplementation} from "./contracts";

const PAGE_PATH = /^(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)+$/u;
/** 这些路径前缀归服务端：`/api` 下没有匹配的路径不回退到页面，`/assets` 是带哈希的构建产物。 */
const RESERVED_PREFIXES = ["/api", "/assets"];

/**
 * `workbench.pages` 的登记校验。贡献 id 必须写页面路径：内核保证贡献 id 在贡献点内唯一，两个插件贡献同一路径时
 * 两条一起被拒绝，与加载顺序无关。`/` 是工作台自己的页面，路径格式本身就排除了它。
 */
export function validatePageContribution(descriptor: ContributionDescriptor): string | null {
    if (descriptor.location !== "browser") return `${WORKBENCH_PAGES_POINT} 只接受浏览器入口的贡献`;
    const declaration = descriptor.declaration;
    if (typeof declaration !== "object" || declaration === null) return "页面声明必须是对象";
    const {path, title, reloadOnLeave} = declaration as Record<string, unknown>;
    if (typeof path !== "string" || !PAGE_PATH.test(path)) return "页面路径必须是小写字母、数字与连字符组成的静态段，例如 /lab";
    if (RESERVED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return `页面路径 ${path} 留给服务端`;
    if (descriptor.id !== path) return `页面贡献的 id 必须是页面路径 ${path}`;
    if (typeof title !== "string" || title === "") return "页面标题不能为空";
    if (reloadOnLeave !== undefined && typeof reloadOnLeave !== "boolean") return "reloadOnLeave 必须是布尔值";
    return null;
}

export class PageTable {
    readonly #builtin: ReadonlyArray<WorkbenchPage>;
    readonly #mounted = new Map<string, ContributionHandle<WorkbenchPageDeclaration, WorkbenchPageImplementation>>();

    constructor(builtin: ReadonlyArray<WorkbenchPage>) {
        this.#builtin = builtin;
    }

    list(): WorkbenchPage[] {
        // 每次加载都经 implementation() 取实现：贡献撤回后不再用旧实现。
        const contributed = [...this.#mounted.values()].map((handle): WorkbenchPage => ({...handle.declaration, load: () => handle.implementation().load()}));
        return [...this.#builtin, ...contributed];
    }

    receiver(): ContributionReceiver<WorkbenchPageDeclaration, WorkbenchPageImplementation> {
        return {
            commit: (handle) => {
                this.#mounted.set(handle.id, handle);
            },
            revoke: (handle) => {
                if (this.#mounted.get(handle.id) === handle) this.#mounted.delete(handle.id);
            },
        };
    }
}
