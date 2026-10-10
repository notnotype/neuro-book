/** 配置模块的公开类型，逐字对应 docs/specs/harness/config.md。 */

export type JsonValue = null | boolean | number | string | JsonValue[] | {[key: string]: JsonValue};

export type ModelRef = string;

export type ProviderModelConfig = {
    id: string;
    name?: string;
    contextWindow?: number;
    maxTokens?: number;
    input?: ("text" | "image")[];
    reasoning?: boolean;
    supportsTools?: boolean;
};
export type ProviderConfig = {id: string; api: string; baseUrl: string; headers?: Record<string, string>; models: ProviderModelConfig[]};
export type RoleItem = {id: string; axis: "gradient" | "specialist"; name: string; description: string; modelKey: ModelRef | null};
export type ApprovalMode = "always-ask" | "write" | "auto" | "yolo";

export type HarnessConfig = {
    providers: ProviderConfig[];
    models: {defaultModel?: ModelRef};
    roles: {items: RoleItem[]};
    profiles: Record<string, {model?: ModelRef; settings?: JsonValue}>;
    approval: {mode?: ApprovalMode; tools: Record<string, "allow" | "deny" | "ask">};
};

export type ConfigProblem = {path: string; reason: string};
export type ConfigResult<T> = {ok: true; value: T} | {ok: false; code: "invalid-config"; problems: ConfigProblem[]};

export interface ConfigStore {
    readonly current: HarnessConfig;
    replace(next: unknown): ConfigResult<HarnessConfig>;
    subscribe(listener: (snapshot: HarnessConfig) => void): {release(): void};
}
