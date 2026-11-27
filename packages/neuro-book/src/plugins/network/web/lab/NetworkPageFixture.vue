<script setup lang="ts">
/**
 * “网络”页的 Lab 场景。配置服务来自设置场景的局部宿主（用户层在内存里，页面拿到的是 `nbook.network` 自己的配置服务）；选路
 * 说明与测试用 `network/web/lab/fake-remote.ts`，在线目录用模型页的远程合同替身。写失败交给窗口的通知改记进事件 tab。
 * 场景 id：`system` 跟随系统（环境变量里的代理），`system-none` 系统没设，`system-unsupported` 自动配置脚本，`system-unreadable`
 * 读不到，`loading` 说明一直不答，`custom-tested` 自定义并测过，`custom-empty` 自定义还没填地址，`testing` 测试挂着，
 * `test-failed` 连不上，`test-bypassed` 测试目标在旁路清单里，`direct` 直连，`catalog-never` 没取过在线目录，`catalog-failed`
 * 上次更新失败，`catalog-disabled` 关掉了，`catalog-unavailable` 模型服务没有运行，`readonly` 用户层不能写，`write-failed`
 * 写都失败；`-english` 结尾的用英文界面，`-narrow` 收到 390px 宽。
 */
import {Button} from "@notnotype/nb-ui/components";
import {onBeforeUnmount, onMounted, ref} from "vue";

import {modelsCatalogs} from "nbook/plugins/models/web/text";
import {networkSettings} from "nbook/plugins/network/shared/settings";
import NetworkPage from "nbook/plugins/network/web/components/NetworkPage.vue";
import {createNetworkStore} from "nbook/plugins/network/web/network-store";
import {networkCatalogs} from "nbook/plugins/network/web/text";
import type {SettingsPageContext} from "nbook/plugins/settings/web/contracts";
import {settingsCatalogs} from "nbook/plugins/settings/web/text";
import {provideHostText} from "nbook/web/host/host-text";
import {createHostTextEngine} from "nbook/web/host/text-engine";

import {LabFixtureControls, type LabFixtureProps, useLabEventSink} from "nbook/plugins/lab/web/scene-kit";
import {createFakeModelsRemote} from "nbook/plugins/models/web/lab/fake-remote";
import {SAMPLE_CATALOG, SAMPLE_SNAPSHOT} from "nbook/plugins/models/web/lab/sample";
import {createFakeNetworkRemote} from "./fake-remote";
import {createSettingsHost} from "nbook/plugins/settings/web/lab/settings-host";

const props = defineProps<LabFixtureProps>();
const record = useLabEventSink();
const scene = props.scene.replace(/-(?:english|narrow)$/u, "");

const engine = createHostTextEngine({locale: /(?:^|-)english$/u.test(props.scene) ? "en-US" : "zh-CN"});
engine.register("nbook.settings", settingsCatalogs.catalogs, settingsCatalogs.source);
engine.register("nbook.network", networkCatalogs.catalogs, networkCatalogs.source);
engine.register("nbook.models", modelsCatalogs.catalogs, modelsCatalogs.source);
provideHostText(engine.port);

const {proxyMode, proxyUrl, catalogAutoUpdate} = networkSettings.settings;
const MODE: Readonly<Record<string, "custom" | "direct">> = {"custom-tested": "custom", "custom-empty": "custom", "testing": "custom", "test-failed": "custom", "test-bypassed": "custom", "direct": "direct"};
const values: Record<string, unknown> = {};
if (MODE[scene] !== undefined) values[proxyMode.key] = MODE[scene];
if (MODE[scene] === "custom" && scene !== "custom-empty") values[proxyUrl.key] = "http://127.0.0.1:7890";

const host = createSettingsHost({
    settings: [proxyMode, proxyUrl, catalogAutoUpdate].map((definition) => ({plugin: "nbook.network", definition})),
    sections: [],
    user: {values},
    notify: (input) => record("notify", input),
    report: (message) => record("report", message),
});
onBeforeUnmount(() => host.dispose());
const settings = host.service("nbook.network");
const failing = ref(scene === "write-failed");
if (failing.value) host.user.failWrites("write-failed");
function toggleFailing(): void {
    failing.value = !failing.value;
    host.user.failWrites(failing.value ? "write-failed" : null);
}

const network = createFakeNetworkRemote({
    setting: () => ({mode: settings.get(proxyMode), url: settings.get(proxyUrl)}),
    system: scene === "system-none" ? "none" : scene === "system-unsupported" ? "unsupported" : scene === "system-unreadable" ? "unreadable" : "env",
    test: scene === "testing" ? "hang" : scene === "test-failed" ? "unreachable" : scene === "test-bypassed" ? "bypassed" : "ok",
    describeHangs: scene === "loading",
});
const catalog = scene === "catalog-never" ? {...SAMPLE_CATALOG, checkedAt: null, modelCount: null}
    : scene === "catalog-failed" ? {...SAMPLE_CATALOG, error: {reason: "proxy" as const, message: "the system proxy is SOCKS only"}}
        : scene === "catalog-disabled" ? {...SAMPLE_CATALOG, enabled: false} : SAMPLE_CATALOG;
const models = createFakeModelsRemote({...SAMPLE_SNAPSHOT, catalog}, {unavailable: scene === "catalog-unavailable"});
const store = createNetworkStore(network, models.remote);
onBeforeUnmount(() => store.dispose());
onMounted(() => {
    if (["custom-tested", "testing", "test-failed", "test-bypassed"].includes(scene)) void store.runTest();
});

const reportWriteFailure: SettingsPageContext["reportWriteFailure"] = (subject, failure) => record("reportWriteFailure", {subject, ...failure});
</script>

<template>
    <div class="flex h-full w-full flex-col gap-3">
        <LabFixtureControls>
            <Button size="sm" variant="secondary" @click="toggleFailing">{{ failing ? "恢复写入" : "让写入失败" }}</Button>
        </LabFixtureControls>
        <div class="network-page-fixture" :class="{'network-page-fixture--narrow': props.scene.endsWith('-narrow')}">
            <NetworkPage :store="store" :settings="settings" :writable="scene !== 'readonly'" :report-write-failure="reportWriteFailure" data-lab-subject />
        </div>
    </div>
</template>

<style scoped>
.network-page-fixture {
    width: 100%;
    max-width: 720px;
    padding: 0 var(--space-5);
}

.network-page-fixture--narrow {
    max-width: 390px;
}
</style>
