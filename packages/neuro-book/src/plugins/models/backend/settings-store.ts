/**
 * 把 `nbook.settings` 的设置服务适配成模型服务核心的配置存储（`@notnotype/nb-models/core` 的 `ModelsConfigStore`）：
 * 读有效值、查用户层、带 `expect` 写用户层、订阅有效值的变化。合同由 `runModelsConfigStoreContract` 核对（`settings-store.test.ts`
 * 用真实的设置场地跑）。
 *
 * 用户层的状态这样对应：`ok` 照实交回，`invalid` 为 `invalid`，`unavailable` 与 `absent`（本实例没有这一层）都是
 * `unavailable`；服务据此交回 `settings-unavailable`，`code` 分别是 `layer-invalid` 与 `unavailable`。这个键在文件里写着、但没通过
 * 校验（`problem`）时也是 `invalid`：读到的是“没有值”，照它整份写回会盖掉用户还能修的原文（docs/specs/models/service.md 输出 6）。
 */

import type {RolesConfig, StoredProvider} from "@notnotype/nb-models/config";
import type {ConfigKey, ConfigSlot, ModelsConfigStore, SlotLayer} from "@notnotype/nb-models/core";

import {networkSettings} from "nbook/plugins/network/shared/contracts";
import type {SettingDefinition, SettingsService} from "nbook/shared/settings";

import {modelsSettings} from "../shared/settings";

const {providers, roles, compaction, streamFirstEventTimeoutSeconds, streamIdleTimeoutSeconds} = modelsSettings.settings;
/** 自动更新显示在网络页、由它写，所以声明在 `nbook.network`；模型服务只读。 */
const {catalogAutoUpdate} = networkSettings.settings;
const KEYS: ReadonlyArray<readonly [string, ConfigKey]> = [[providers.key, "providers"], [roles.key, "roles"], [compaction.key, "compaction"], [catalogAutoUpdate.key, "autoUpdate"]];

/**
 * 设置服务交出的值深冻结（`DeepReadonly`），存储接口按可变类型交出：核心改之前先拷贝（接口注释写明值可能是冻结的），
 * 这里只去掉只读标记。
 */
function slot<T>(settings: SettingsService, setting: SettingDefinition<T>): ConfigSlot<T> {
    return {
        read: () => settings.get(setting) as T,
        editable: (): SlotLayer<T> => {
            const user = settings.inspect(setting).user;
            if (user.status === "ok" && user.problem === undefined) return {status: "ok", value: user.value as T | undefined};
            if (user.status === "ok") return {status: "invalid"};
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
        autoUpdate: () => settings.get(catalogAutoUpdate),
        stream: () => ({firstEventTimeoutSeconds: settings.get(streamFirstEventTimeoutSeconds), idleTimeoutSeconds: settings.get(streamIdleTimeoutSeconds)}),
        onChange: (listener) => settings.onDidChange((keys) => {
            const changed = new Set(KEYS.filter(([key]) => keys.has(key)).map(([, name]) => name));
            if (changed.size > 0) listener(changed);
        }),
    };
}
