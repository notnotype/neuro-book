/**
 * 进程内的模型服务（docs/specs/models/service.md 输出 8、10）：别的服务端插件经它取模型端口。服务键带应用的插件 id，由应用定义。
 */

import type {ModelPort} from "@notnotype/nb-harness/kernel/contracts";

import type {ModelsSnapshot} from "./shapes";

/** Profile 设置里的模型或角色。 */
export interface ProfileModelDefaults {
    readonly model?: string;
    readonly role?: string;
}

export interface ModelsService {
    /**
     * 模型端口，所有会话共用一个。`profileDefaults` 每次解析都调（换 Profile、改 Profile 设置即时生效）；不给时没有
     * Profile 默认。解析表见 service.md 输出 8。
     */
    port(profileDefaults?: (profile: string) => ProfileModelDefaults): ModelPort;
    snapshot(): ModelsSnapshot;
    onChange(listener: () => void): () => void;
}

/** 有凭据：不要密钥的服务商，或者密钥已经设了。 */
export function hasCredentials(provider: {readonly key: {readonly kind: string; readonly found?: boolean}}): boolean {
    return provider.key.kind === "stored" || provider.key.kind === "keyless" || (provider.key.kind === "env" && provider.key.found === true);
}
