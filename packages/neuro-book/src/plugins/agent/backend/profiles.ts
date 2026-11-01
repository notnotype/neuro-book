/**
 * Profile 目录（docs/specs/agent/contributions.md 输出 7、8、11）：插件经 `agent.profiles` 贡献的与用户在状态根里写的。
 * key 由来源前缀区分（插件的以插件 id 开头，用户的以 `user.` 开头），同名不覆盖。
 *
 * 插件 Profile 的目录来自清单声明，不激活提供方；解析时才触发 `onAgentProfile:<key>`。提供方发布或撤回时通知用这个
 * key 的会话重新解析（内核的 `profilesChanged`）。
 */

import type {ContributionDeclarations, ContributionHandle, ContributionReceiver} from "@notnotype/nb-runtime/plugins";

import type {AnyProfile} from "@notnotype/nb-harness/kernel/contracts";

import type {ProfileEntry, ProfileStatus} from "../shared/contracts";
import {onAgentProfile, PROFILES_POINT} from "../shared/points";
import type {AgentProfileDeclaration, AgentProfileImplementation} from "../shared/points";

import type {ToolRequirements} from "./tools";

type Handle = ContributionHandle<AgentProfileDeclaration, AgentProfileImplementation>;

/** 用户级 Profile 的一层（`profile-bundles.ts`）；目录只经这个形状用它。 */
export interface UserProfiles {
    list(): readonly {readonly key: string; readonly name: string; readonly description: string; readonly tools: ToolRequirements; readonly error?: string}[];
    resolve(key: string): AnyProfile | undefined;
}

export const USER_PROFILE_PREFIX = "user.";

export interface ProfileCatalogOptions {
    readonly declarations: ContributionDeclarations;
    readonly activate: (event: string) => Promise<boolean>;
    /** 这些 key 的 Profile 变了：用它们的会话重新解析。 */
    readonly changed: (keys: readonly string[]) => void;
    /** 此刻所有工具声明的 id（算可用性）。 */
    readonly toolIds: () => ReadonlySet<string>;
    readonly report: (code: string, message: string, data?: Readonly<Record<string, unknown>>) => void;
}

export class ProfileCatalog {
    readonly #published = new Map<string, Handle>();
    #user: UserProfiles | null = null;

    constructor(private readonly options: ProfileCatalogOptions) {}

    readonly receiver: ContributionReceiver<AgentProfileDeclaration, AgentProfileImplementation> = {
        published: (handle) => {
            this.#published.set(handle.id, handle);
            this.options.changed([handle.id]);
        },
        revoke: (handle) => {
            if (this.#published.get(handle.id) !== handle) return;
            this.#published.delete(handle.id);
            this.options.changed([handle.id]);
        },
    };

    attachUser(user: UserProfiles): void {
        this.#user = user;
    }

    list(): ProfileEntry[] {
        const tools = this.options.toolIds();
        const availability = (requirements: ToolRequirements): {status: ProfileStatus; reason?: string} => {
            const missing = requirements.required.filter((id) => !tools.has(id));
            return missing.length === 0 ? {status: "ok"} : {status: "unavailable", reason: `missing required tools: ${missing.join(", ")}`};
        };
        const fromPlugins = this.options.declarations.list<AgentProfileDeclaration>(PROFILES_POINT).map((descriptor): ProfileEntry => ({
            key: descriptor.id,
            name: descriptor.declaration.name,
            description: descriptor.declaration.description,
            source: descriptor.plugin,
            ...availability(descriptor.declaration.tools),
        }));
        const fromUser = (this.#user?.list() ?? []).map((profile): ProfileEntry => ({
            key: profile.key,
            name: profile.name,
            description: profile.description,
            source: "user",
            ...(profile.error === undefined ? availability(profile.tools) : {status: "error", reason: profile.error}),
        }));
        return [...fromPlugins, ...fromUser];
    }

    /** 工具集用的要求：插件 Profile 来自声明，用户 Profile 来自装载好的 Profile。 */
    requirements(key: string): ToolRequirements {
        if (key.startsWith(USER_PROFILE_PREFIX)) {
            const found = this.#user?.list().find((profile) => profile.key === key);
            return found?.tools ?? {required: [], optional: []};
        }
        return this.options.declarations.get<AgentProfileDeclaration>(PROFILES_POINT, key)?.declaration.tools ?? {required: [], optional: []};
    }

    /** 内核的 `profiles.resolve`：插件的要激活提供方。 */
    async resolve(key: string): Promise<AnyProfile | undefined> {
        if (key.startsWith(USER_PROFILE_PREFIX)) return this.#user?.resolve(key);
        if (this.options.declarations.get(PROFILES_POINT, key) === null) return undefined;
        let handle = this.#published.get(key);
        if (handle === undefined && await this.options.activate(onAgentProfile(key))) handle = this.#published.get(key);
        if (handle === undefined) return undefined;
        try {
            return handle.implementation();
        } catch (error) {
            // 句柄在激活与取实现之间被撤回：算解析不到，撤回已经通知会话。
            this.options.report("profile-revoked-while-resolving", `profile ${key} was withdrawn while it was being resolved`, {profile: key, message: error instanceof Error ? error.message : String(error)});
            return undefined;
        }
    }
}
