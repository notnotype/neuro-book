/**
 * 把 `nbook.settings` 的设置服务适配成模型服务核心的配置存储（`@notnotype/nb-models/core` 的 `ModelsConfigStore`）：
 * 读有效值、查用户层、带 `expect` 写用户层、订阅有效值的变化。合同由 `runModelsConfigStoreContract` 核对（`settings-store.test.ts`
 * 用真实的设置场地跑）。
 *
 * 用户层的状态这样对应：`ok` 照实交回，`invalid` 为 `invalid`，`unavailable` 与 `absent`（本实例没有这一层）都是
 * `unavailable`；服务据此交回 `settings-unavailable`，`code` 分别是 `layer-invalid` 与 `unavailable`。
 */

import type {RolesConfig, StoredProvider} from "@notnotype/nb-models/config";
import type {ConfigKey, ConfigSlot, ModelsConfigStore, SlotLayer} from "@notnotype/nb-models/core";

import type {SettingDefinition, SettingsService} from "nbook/shared/settings";

import {modelsSettings} from "../shared/settings";

const {providers, roles, compaction, streamFirstEventTimeoutSeconds, streamIdleTimeoutSeconds} = modelsSettings.settings;
const KEYS: ReadonlyArray<readonly [string, ConfigKey]> = [[providers.key, "providers"], [roles.key, "roles"], [compaction.key, "compaction"]];

/**
 * 设置服务交出的值深冻结（`DeepReadonly`），存储接口按可变类型交出：核心改之前先拷贝（接口注释写明值可能是冻结的），
 * 这里只去掉只读标记。
 */
function slot<T>(settings: SettingsService, setting: SettingDefinition<T>): ConfigSlot<T> {
    return {
        read: () => settings.get(setting) as T,
        editable: (): SlotLayer<T> => {
            const user = settings.inspect(setting).user;
            if (user.status === "ok") return {status: "ok", value: user.value as T | undefined};
            return {status: user.status === "invalid" ? "invalid" : "unavailable"};
        },
        write: (next, expect) => settings.update(setting, next, {expect: {value: expect.value}}),
    };
}

export function settingsModelsConfig(settings: SettingsService): ModelsConfigStore {
    return {
        providers: slot(settings, providers as SettingDefinition<StoredProvider[]>),
        roles: slot(settings, roles as SettingDefinition<RolesConfig>),
        compaction: () => settings.get(compaction),
        stream: () => ({firstEventTimeoutSeconds: settings.get(streamFirstEventTimeoutSeconds), idleTimeoutSeconds: settings.get(streamIdleTimeoutSeconds)}),
        onChange: (listener) => settings.onDidChange((keys) => {
            const changed = new Set(KEYS.filter(([key]) => keys.has(key)).map(([, name]) => name));
            if (changed.size > 0) listener(changed);
        }),
    };
}
