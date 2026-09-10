<script setup lang="ts">
import {computed, ref, watch} from "vue";
import DesktopSettingsView from "../../components/novel-ide/settings/sections/DesktopSettingsView.vue";
import {
    DEFAULT_DESKTOP_SETTINGS,
    DESKTOP_BRIDGE_SCHEMA,
    type DesktopSettings,
    type DesktopSettingsPatch,
    type DesktopStatus,
} from "@notnotype/neuro-book-contracts/desktop";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";

const props = defineProps<{scene: string; data?: unknown}>();

const emitLabEvent = useLabEventSink();
const syncLabData = useLabDataSink();

type SceneKey = "default" | "remote-zoom-max" | "error";

const sceneKey = computed<SceneKey>(() => {
    const known: SceneKey[] = ["default", "remote-zoom-max", "error"];
    return known.find((key) => key === props.scene) ?? "default";
});

function sceneSettings(scene: SceneKey): DesktopSettings {
    if (scene === "remote-zoom-max") {
        return {...DEFAULT_DESKTOP_SETTINGS, zoomFactor: 2, trayEnabled: false, closeBehavior: "quit"};
    }
    return {...DEFAULT_DESKTOP_SETTINGS};
}

function sceneStatus(scene: SceneKey): DesktopStatus {
    return {
        schema: DESKTOP_BRIDGE_SCHEMA,
        envelope: "electron",
        connection: scene === "remote-zoom-max" ? "remote" : "local",
        version: "0.1.42",
        origin: scene === "remote-zoom-max" ? "https://novel.example.com" : "http://127.0.0.1:3000",
        insecureRemote: false,
        platform: "windows",
        menuPresentation: "renderer",
        windowControls: "overlay",
    };
}

const settings = ref<DesktopSettings>(sceneSettings("default"));
const status = ref<DesktopStatus>(sceneStatus("default"));
const saveError = ref("");

watch(sceneKey, (scene) => {
    settings.value = sceneSettings(scene);
    status.value = sceneStatus(scene);
    saveError.value = scene === "error" ? "示例桌面桥返回失败" : "";
}, {immediate: true});

watch([settings, status, saveError], () => {
    syncLabData({settings: {...settings.value}, connection: status.value.connection, version: status.value.version, saveError: saveError.value});
}, {immediate: true});

/** 桥的写回在 Lab 里不存在：fixture 立刻合并 patch 并记录事件。 */
function updateSettings(patch: DesktopSettingsPatch): void {
    settings.value = {...settings.value, ...patch};
    emitLabEvent("update:settings", {...patch});
}
</script>

<template>
    <div class="h-full min-h-0 w-full overflow-y-auto p-[var(--space-6)]">
        <div class="max-w-3xl">
            <DesktopSettingsView
                :settings="settings"
                :status="status"
                :save-error="saveError"
                @update:settings="updateSettings"
            />
        </div>
    </div>
</template>
