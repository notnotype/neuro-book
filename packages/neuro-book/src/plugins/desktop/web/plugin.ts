/**
 * `nbook.desktop` 的浏览器入口（docs/specs/runtime/desktop-shell.md 的“桌面专属设置”）。
 *
 * - 公开状态 `nbook.desktop/inDesktop` 总是声明：浏览器里为 false，桌面里为 true。只在桌面里可用的命令拿它作 `when`；不声明的话，
 *   那些命令每次启动都会报“未声明的键”。
 * - 在桌面壳的窗口里，把配置服务里本插件各项的有效值交给壳（激活时一次，之后每次有效值变化）。几个窗口各交一次，壳按值去重。
 *   设置的拥有者是服务端的 `nbook.settings`：直接改设置文件时它监视到变化、推给窗口，这里同样收到。
 */

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {PUBLIC_STATE_POINT} from "nbook/plugins/state/shared/contracts";
import {settingsKey} from "nbook/plugins/settings/shared/contracts";
import type {DesktopSettingValues} from "nbook/shared/desktop-bridge";
import {windowDesktopKey} from "nbook/shared/host";
import type {SettingsService} from "nbook/shared/settings";
import {bindingsOf, definePublicState} from "nbook/shared/store/public";

import {descriptor} from "../plugin";
import {desktopSettings} from "../shared/contracts";

export const desktopState = definePublicState(descriptor.id, {
    inDesktop: {type: "boolean", unready: false, reason: {"zh-CN": "只在 NeuroBook 桌面版里可用", "en-US": "Only available in the NeuroBook desktop app"}},
});

/** 本插件各项此刻的有效值，交给壳的形状。 */
export function desktopSettingValues(settings: SettingsService): DesktopSettingValues {
    return {zoom: settings.get(desktopSettings.zoom), openAtLogin: settings.get(desktopSettings.openAtLogin)};
}

export const desktopEntry = defineEntry({
    id: "browser",
    location: "browser",
    activationEvents: ["onStartup"],
    dependencies: [{key: settingsKey}, {key: windowDesktopKey, required: false}],
    contributions: [...desktopState.contributions],
    activate: async (context) => {
        const settings = context.services.require(settingsKey);
        const resolved = await context.services.resolve(windowDesktopKey);
        const desktop = resolved.status === "resolved" && resolved.instance.available ? resolved.instance : null;
        if (desktop !== null) {
            const keys = new Set(Object.values(desktopSettings).map((setting) => setting.key));
            desktop.reportSettings(desktopSettingValues(settings));
            const stop = settings.onDidChange((changed) => {
                if ([...changed].some((key) => keys.has(key))) desktop.reportSettings(desktopSettingValues(settings));
            });
            context.scope.register({kind: "desktop-settings-report", label: `${descriptor.id} settings`, value: stop, release: (release) => release()});
        }
        const published = bindingsOf(desktopState, {inDesktop: {value: desktop !== null}});
        return {contributions: {[PUBLIC_STATE_POINT]: Object.fromEntries(published.bindings)}};
    },
});

export const desktopBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [desktopEntry],
};
