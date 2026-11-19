<script setup lang="ts">
/**
 * “搜索与网页”页的 Lab 场景。页面不是宿主：数据模块建在内存里的远程合同替身上（`web-tools-scene/fake-remote.ts`），页面上下文由
 * 这里给，写失败交给窗口的通知改记进事件 tab；层能不能写固定为能。场景 id：`unset` 没有密钥，`set` 已设置，`loading` 状态一直
 * 不答，`checking` 检测一直挂着，`passed`、`failed` 挂载后检测一次，`not-run` 检测结果未知，`readonly` 网页工具没有运行，
 * `unreadable` 密钥文件读不了，`write-failed` 写方法都失败；`-english` 结尾的用英文界面，`-narrow` 收到 390px 宽。
 */
import {Button} from "@notnotype/nb-ui/components";
import {onBeforeUnmount, onMounted, ref} from "vue";

import type {SettingsPageContext} from "nbook/plugins/settings/web/contracts";
import SearchSettingsPage from "nbook/plugins/web-tools/web/components/SearchSettingsPage.vue";
import {createSearchStore} from "nbook/plugins/web-tools/web/search-store";

import {useLabEventSink} from "../lab-event-sink";
import type {LabFixtureProps} from "../lab-subject";
import LabFixtureControls from "../LabFixtureControls.vue";
import {createFakeWebRemote} from "./web-tools-scene/fake-remote";

const props = defineProps<LabFixtureProps>();
const record = useLabEventSink();
const scene = props.scene.replace(/-(?:english|narrow)$/u, "");

const fake = createFakeWebRemote({
    hasKey: ["set", "checking", "passed", "failed", "not-run", "write-failed"].includes(scene),
    unavailable: scene === "readonly",
    unreadable: scene === "unreadable",
    neverLoads: scene === "loading",
    check: scene === "checking" ? "hang" : scene === "not-run" ? "unknown" : scene === "failed" ? {ok: false, code: "auth", detail: "Authentication Fails, Your api key: ****0000 is invalid"} : {ok: true},
});
const failing = ref(scene === "write-failed");
fake.failWrites(failing.value ? "credentials-unavailable" : null);
const store = createSearchStore(fake.remote, () => Date.UTC(2026, 10, 19, 8, 30, 0));
onBeforeUnmount(() => store.dispose());
onMounted(async () => {
    if (["checking", "passed", "failed", "not-run"].includes(scene)) {
        await store.start();
        void store.check("deepseek");
    }
});

function toggleFailing(): void {
    failing.value = !failing.value;
    fake.failWrites(failing.value ? "credentials-unavailable" : null);
}

const reportWriteFailure: SettingsPageContext["reportWriteFailure"] = (subject, failure) => record("reportWriteFailure", {subject, ...failure});
</script>

<template>
    <div class="flex h-full w-full flex-col gap-3">
        <LabFixtureControls>
            <Button size="sm" variant="secondary" @click="toggleFailing">{{ failing ? "恢复写入" : "让写入失败" }}</Button>
        </LabFixtureControls>
        <div class="search-settings-fixture" :class="{'search-settings-fixture--narrow': props.scene.endsWith('-narrow')}">
            <SearchSettingsPage :store="store" :writable="true" :report-write-failure="reportWriteFailure" data-lab-subject />
        </div>
    </div>
</template>

<style scoped>
.search-settings-fixture {
    width: 100%;
    max-width: 720px;
    padding: var(--space-5);
}

.search-settings-fixture--narrow {
    max-width: 390px;
}
</style>
