import type {AgentTool} from "@oh-my-pi/pi-agent-core";

export interface PluginManifest {
    readonly name: string;
    readonly version?: string;
    readonly description?: string;
}

/** 插件提供的额外读取格式：`canRead` 命中即用 `read` 的结果（返回 null 表示放弃）。 */
export interface PluginReadFormat {
    readonly id: string;
    canRead(path: string): boolean;
    read(path: string, options: {readonly offset?: number; readonly limit?: number}): Promise<{readonly text: string} | null>;
}

/** 域工具将来以插件形式接入：实现本接口并 `harness.use(plugin)`。 */
export interface HarnessPlugin {
    readonly manifest: PluginManifest;
    readonly tools?: readonly AgentTool[];
    readonly readFormats?: readonly PluginReadFormat[];
}

export interface PluginHost {
    register(plugin: HarnessPlugin): void;
    unregister(name: string): void;
    list(): readonly PluginManifest[];
    tools(): readonly AgentTool[];
    readFormats(): readonly PluginReadFormat[];
}

/** 校验插件清单与工具名唯一性（同一插件内不得重复）。 */
export function definePlugin(plugin: HarnessPlugin): HarnessPlugin {
    if (plugin.manifest.name.trim() === "") {
        throw new Error("插件 name 不能为空");
    }
    const names = new Set<string>();
    for (const tool of plugin.tools ?? []) {
        if (names.has(tool.name)) {
            throw new Error(`插件 ${plugin.manifest.name} 的 tool 名重复：${tool.name}`);
        }
        names.add(tool.name);
    }
    return plugin;
}

export function createPluginHost(): PluginHost {
    const plugins = new Map<string, HarnessPlugin>();

    return {
        register(plugin) {
            const name = plugin.manifest.name.trim();
            if (name === "") throw new Error("插件 name 不能为空");
            if (plugins.has(name)) throw new Error(`插件已注册：${name}`);
            plugins.set(name, plugin);
        },
        unregister(name) {
            if (!plugins.delete(name)) throw new Error(`插件未注册：${name}`);
        },
        list() {
            return [...plugins.values()].map((plugin) => plugin.manifest);
        },
        tools() {
            return [...plugins.values()].flatMap((plugin) => [...(plugin.tools ?? [])]);
        },
        readFormats() {
            return [...plugins.values()].flatMap((plugin) => [...(plugin.readFormats ?? [])]);
        },
    };
}
