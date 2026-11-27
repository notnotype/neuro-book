<script setup lang="ts">
/**
 * “搜索与网页”页的 Lab 场景。页面不是宿主：数据模块建在内存里的远程合同替身上（`web-tools-scene/fake-remote.ts`），“使用”哪家
 * 经设置场景的局部宿主写（用户层在内存里，页面拿到的是 `nbook.web` 自己的配置服务）；页面上下文由这里给，写失败交给窗口的通知
 * 改记进事件 tab；层能不能写固定为能。场景 id：`unset` 没有密钥，`set` DeepSeek 已设置，`loading` 状态一直不答，`checking` 检测
 * 一直挂着，`passed`、`failed` 挂载后检测一次，`not-run` 检测结果未知，`readonly` 网页工具没有运行，`unreadable` 密钥文件读不了，
 * `write-failed` 写方法与设置都写不进去，`use-tavily-no-key` 选用 Tavily、它还没有密钥，`use-tavily` 选用 Tavily、两家都有密钥；
 * `-english` 结尾的用英文界面，`-narrow` 收到 390px 宽。
 */
import {Button} from "@notnotype/nb-ui/components";
import {onBeforeUnmount, onMounted, ref} from "vue";

import type {SettingsPageContext} from "nbook/plugins/settings/web/contracts";
import {webSettings} from "nbook/plugins/web-tools/shared/settings";
import SearchSettingsPage from "nbook/plugins/web-tools/web/components/SearchSettingsPage.vue";
import {createSearchStore} from "nbook/plugins/web-tools/web/search-store";

import {LabFixtureControls, type LabFixtureProps, useLabEventSink} from "nbook/plugins/lab/web/scene-kit";
import {createSettingsHost} from "../../../settings/web/lab/settings-host";
import {createFakeWebRemote} from "./fake-remote";

const props = defineProps<LabFixtureProps>();
const record = useLabEventSink();
const scene = props.scene.replace(/-(?:english|narrow)$/u, "");

const fake = createFakeWebRemote({
    hasKey: ["set", "checking", "passed", "failed", "not-run", "write-failed", "use-tavily", "rules", "advanced"].includes(scene),
    hasTavilyKey: scene === "use-tavily" || scene === "advanced",
    unavailable: scene === "readonly",
    unreadable: scene === "unreadable",
    neverLoads: scene === "loading",
    check: scene === "checking" ? "hang" : scene === "not-run" ? "unknown" : scene === "failed" ? {ok: false, code: "auth", detail: "Authentication Fails, Your api key: ****0000 is invalid"} : {ok: true},
});
const S = webSettings.settings;
const values: Record<string, unknown> = {};
if (scene.startsWith("use-tavily") || scene === "advanced") values[S.provider.key] = "tavily";
if (scene === "advanced") Object.assign(values, {[S.tavilyBaseUrl.key]: "https://relay.example/tavily", [S.tavilySearchDepth.key]: "advanced"});
if (scene === "rules") Object.assign(values, {[S.blockedSites.key]: ["csdn.net", "baidu.com"], [S.resultCount.key]: 8});
const host = createSettingsHost({
    settings: [S.provider, S.deepseekBaseUrl, S.tavilyBaseUrl, S.resultCount, S.blockedSites, S.tavilySearchDepth].map((definition) => ({plugin: "nbook.web", definition})),
    sections: [],
    user: {values},
    notify: (input) => record("notify", input),
    report: (message) => record("report", message),
});
onBeforeUnmount(() => host.dispose());
const settings = host.service("nbook.web");
const failing = ref(scene === "write-failed");
const applyFailing = (): void => {
    fake.failWrites(failing.value ? "credentials-unavailable" : null);
    host.user.failWrites(failing.value ? "write-failed" : null);
};
applyFailing();
const store = createSearchStore(fake.remote, () => Date.UTC(2026, 10, 19, 8, 30, 0));
onBeforeUnmount(() => store.dispose());
onMounted(async () => {
    // 页面第一次显示时选中使用中的那家；看“搜索规则”的场景在左栏点一下。
    if (scene === "rules") document.querySelector<HTMLElement>('[data-search-rail-item="rules"]')?.click();
    if (["checking", "passed", "failed", "not-run"].includes(scene)) {
        await store.start();
        void store.check("deepseek");
    }
});

function toggleFailing(): void {
    failing.value = !failing.value;
    applyFailing();
}

const reportWriteFailure: SettingsPageContext["reportWriteFailure"] = (subject, failure) => record("reportWriteFailure", {subject, ...failure});
</script>

<template>
    <div class="flex h-full w-full flex-col gap-3">
        <LabFixtureControls>
            <Button size="sm" variant="secondary" @click="toggleFailing">{{ failing ? "恢复写入" : "让写入失败" }}</Button>
        </LabFixtureControls>
        <div class="search-settings-fixture" :class="{'search-settings-fixture--narrow': props.scene.endsWith('-narrow')}">
            <SearchSettingsPage :store="store" :settings="settings" :writable="true" :report-write-failure="reportWriteFailure" data-lab-subject />
        </div>
    </div>
</template>

<style scoped>
/* 页面是铺满的版式（左栏、右边各自滚动），台子给一个设置窗口内容区那样的高度。 */
.search-settings-fixture {
    width: 100%;
    max-width: 720px;
    height: 480px;
    padding: var(--space-5);
}

.search-settings-fixture--narrow {
    max-width: 390px;
}
</style>
