import {defineLabFixture, type LabFixture} from "nbook/plugins/lab/web/scene-kit";
import type SettingsWindow from "nbook/plugins/settings/web/components/SettingsWindow.vue";
import {SETTINGS_WINDOW_SCENES} from "./scene-settings";

/**
 * 设置窗口（docs/specs/settings/settings-window.md）由设置场景的局部宿主驱动（`settings-host.ts`）：产品里同一个窗口模型与
 * 配置实例，配置层换成内存里的拥有者。
 */
function settingsFixtures(): LabFixture[] {
    return [
        defineLabFixture<typeof SettingsWindow>({
            component: "SettingsWindow",
            noInput: "窗口由场景的局部宿主驱动（窗口模型、配置实例与分区注册表，配置层在内存里），没有可登记的 JSON 输入",
            scenes: SETTINGS_WINDOW_SCENES.map((scene) => ({id: scene.id, label: scene.label})),
            load: async () => (await import("./SettingsWindowFixture.vue")).default,
        }),
    ];
}

export const fixtures: LabFixture[] = [
    ...settingsFixtures(),
];
