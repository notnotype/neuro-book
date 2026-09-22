import type {PreparedProjectOpen} from "nbook/server/workspace-files/project-lifecycle";
import type {ProjectOpener} from "nbook/server/workspace-files/project-session-types";
import type {RuntimeArtifactCompilerContext} from "nbook/server/utils/runtime-artifact-compiler-context";
declare const projectModuleTokenBrand: unique symbol;

/** 内置Project Module的稳定名称；required顺序同时定义失败回滚的逆序依赖。 */
export type ProjectModuleName = "database" | "history" | "file-index" | "plot-world" | "agent-sql" | "storage";

/** Project Module启动上下文；signal由当前ProjectSession generation独占。 */
export type ProjectModuleContext = {
    readonly prepared: PreparedProjectOpen;
    readonly opener: ProjectOpener;
    readonly signal: AbortSignal;
    /** World/Profile runtime compiler context；缺失时依赖该能力的Module必须 fail-closed。 */
    readonly compilerContext?: Promise<RuntimeArtifactCompilerContext>;
    /** 只取得本generation中按依赖顺序已经同步start并被Session捕获的精确handle。 */
    require<THandle extends ProjectModuleHandle>(token: ProjectModuleToken<THandle>): THandle;
};

/**
 * generation-scoped Module handle。
 *
 * start必须同步返回handle，调用方才能在第一次await前接管部分初始化资源；ready表达最低可用门禁，
 * close必须只关闭该handle捕获的精确资源，并允许失败后由同一generation重试。
 */
export interface ProjectModuleHandle {
    readonly ready: Promise<void>;
    close(): Promise<void>;
}

/** 把Module稳定名称与其generation-scoped handle类型绑定，供Session数据面做类型安全访问。 */
export type ProjectModuleToken<THandle extends ProjectModuleHandle> = {
    readonly name: ProjectModuleName;
    readonly kind: "required" | "lazy";
    readonly [projectModuleTokenBrand]: THandle;
};

/** 构造只携带名称、kind与编译期handle关系的ProjectModule token。 */
export function projectModuleToken<THandle extends ProjectModuleHandle>(
    name: ProjectModuleName,
    kind: ProjectModuleToken<THandle>["kind"],
): ProjectModuleToken<THandle> {
    return Object.freeze({name, kind}) as ProjectModuleToken<THandle>;
}

/** 内置Project Module descriptor；registry替换只影响未来generation。 */
export type ProjectModule<THandle extends ProjectModuleHandle = ProjectModuleHandle> = {
    readonly token: ProjectModuleToken<THandle>;
    start(context: ProjectModuleContext): THandle;
};

/** ProjectModule registry快照；Session必须在generation开始时一次捕获。 */
export type ProjectModuleRegistrySnapshot = {
    readonly required: readonly ProjectModule[];
    readonly lazy: readonly ProjectModule[];
};

const REQUIRED_MODULE_ORDER: readonly ProjectModuleName[] = ["database", "history", "file-index"];
const LAZY_MODULE_ORDER: readonly ProjectModuleName[] = ["plot-world", "agent-sql", "storage"];

type ProjectModuleRegistryState = {
    readonly modules: Map<ProjectModuleName, ProjectModule>;
};

const globalForProjectModules = globalThis as typeof globalThis & {
    __nbookProjectModuleRegistryV1?: ProjectModuleRegistryState;
};
const registryState = globalForProjectModules.__nbookProjectModuleRegistryV1 ??= {
    modules: new Map<ProjectModuleName, ProjectModule>(),
};
const modules = registryState.modules;

/** 注册或替换未来ProjectSession generation使用的内置Module。 */
export function registerProjectModule<THandle extends ProjectModuleHandle>(module: ProjectModule<THandle>): void {
    modules.set(module.token.name, module as ProjectModule);
}

/** 捕获不可变registry快照；后续HMR替换不会改变已打开generation的descriptor。 */
export function projectModuleRegistry(): ProjectModuleRegistrySnapshot {
    return Object.freeze({
        required: Object.freeze(requiredModules()),
        lazy: Object.freeze(orderedModules(LAZY_MODULE_ORDER, "lazy")),
    });
}

/** 测试专用：替换全部Module并返回恢复函数。 */
export function replaceProjectModulesForTest(next: readonly ProjectModule[]): () => void {
    const previous = [...modules.values()];
    modules.clear();
    for (const module of next) {
        registerProjectModule(module);
    }
    return () => {
        modules.clear();
        for (const module of previous) {
            registerProjectModule(module);
        }
    };
}

/** required Module必须完整注册，避免生产open静默降级为部分ready。 */
function requiredModules(): ProjectModule[] {
    const required = orderedModules(REQUIRED_MODULE_ORDER, "required");
    if (required.length !== REQUIRED_MODULE_ORDER.length) {
        const missing = REQUIRED_MODULE_ORDER.filter((name) => !modules.has(name));
        throw new Error(`ProjectSession缺少required Module：${missing.join("、")}`);
    }
    return required;
}

/** 按稳定依赖顺序读取指定kind的Module。 */
function orderedModules(
    order: readonly ProjectModuleName[],
    kind: ProjectModuleToken<ProjectModuleHandle>["kind"],
): ProjectModule[] {
    const result: ProjectModule[] = [];
    for (const name of order) {
        const module = modules.get(name);
        if (!module) {
            continue;
        }
        if (module.token.kind !== kind) {
            throw new Error(`Project Module ${name} 的kind应为${kind}`);
        }
        result.push(module);
    }
    return result;
}
