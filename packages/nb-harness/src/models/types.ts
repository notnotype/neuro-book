/** 模型模块的公开类型，逐字对应 docs/specs/harness/models.md。 */

import type {AuthCredentialStore, OAuthController} from "@oh-my-pi/pi-ai";
import type {Model} from "@oh-my-pi/pi-catalog";

export type ModelSummary = {ref: string; name: string; provider: string; source: "config" | "bundled"; input: ("text" | "image")[]; supportsTools: boolean; contextWindow: number | null};
export type SelectRequest = {model?: string; role?: string; profile?: {id: string; model?: string; defaultRole?: string}};
export type Selected = {model: Model; via: "explicit" | "role" | "profile-model" | "profile-role" | "default"; role?: string};
export type Capabilities = {tools?: boolean; images?: boolean};
export type CapabilityProblem = {capability: "tools" | "images"; detail: string};

export type ModelFailure = "invalid-model-ref" | "unknown-provider" | "unknown-model" | "unsupported-api" | "unknown-role" | "role-not-bound" | "no-default-model"
    | "credentials-unavailable" | "login-failed" | "login-cancelled";
export type ModelResult<T> = {ok: true; value: T} | {ok: false; code: ModelFailure; detail: string};

export interface ModelCatalog {
    list(): ModelSummary[];
    resolve(ref: string): ModelResult<Model>;
    select(request: SelectRequest): ModelResult<Selected>;
    checkCapabilities(model: Model, required: Capabilities): CapabilityProblem[];
}

export interface Credentials {
    apiKeyFor(model: Model): Promise<string | undefined>;
    setApiKey(provider: string, key: string): Promise<void>;
    removeApiKey(provider: string): Promise<void>;
    status(provider: string): {kind: "api_key" | "oauth" | null};
    loginProviders(): {id: string; name: string}[];
    login(provider: string, controller: OAuthController): Promise<ModelResult<{accountId?: string}>>;
    logout(provider: string): Promise<void>;
    accounts(provider: string): {credentialId: number; active: boolean; accountId?: string; label?: string}[];
    close(): void;
}

export type {AuthCredentialStore, Model, OAuthController};
