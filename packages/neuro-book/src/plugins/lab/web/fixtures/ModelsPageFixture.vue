<script setup lang="ts">
/**
 * “服务商与模型”“模型角色”两页的 Lab 场景。两页是页面不是宿主：数据模块建在内存里的远程合同替身上
 * （`models-scene/fake-remote.ts`），页面上下文由这里给，写失败交给窗口的通知改记进事件 tab；层能不能写固定为能。场景 id 以 `roles` 开头的画角色页，
 * 其余画服务商页；`-narrow` 把页面收到 560px 宽看下拉，`-readonly` 是模型服务没有运行，`-write-failed` 写方法都失败。
 */
import {Button} from "@notnotype/nb-ui/components";
import {onBeforeUnmount, ref} from "vue";

import ProvidersPage from "nbook/plugins/models/web/components/ProvidersPage.vue";
import RolesPage from "nbook/plugins/models/web/components/RolesPage.vue";
import {createModelsStore} from "nbook/plugins/models/web/models-store";
import type {SettingsPageContext} from "nbook/plugins/settings/web/contracts";

import {useLabEventSink} from "../lab-event-sink";
import type {LabFixtureProps} from "../lab-subject";
import LabFixtureControls from "../LabFixtureControls.vue";
import {createFakeModelsRemote} from "./models-scene/fake-remote";
import {SAMPLE_SNAPSHOT} from "./models-scene/sample";

const props = defineProps<LabFixtureProps>();
const record = useLabEventSink();

const empty = props.scene.includes("empty");
const fake = createFakeModelsRemote(empty ? {providers: [], roles: SAMPLE_SNAPSHOT.roles.map((role) => ({...role, model: null, status: "unbound"}))} : SAMPLE_SNAPSHOT, {unavailable: props.scene.endsWith("-readonly")});
const failing = ref(props.scene.endsWith("-write-failed"));
fake.failWrites(failing.value);
const store = createModelsStore(fake.remote);
onBeforeUnmount(() => store.dispose());

function toggleFailing(): void {
    failing.value = !failing.value;
    fake.failWrites(failing.value);
}

const reportWriteFailure: SettingsPageContext["reportWriteFailure"] = (subject, failure) => record("reportWriteFailure", {subject, ...failure});
</script>

<template>
    <div class="flex h-full w-full flex-col gap-3">
        <LabFixtureControls>
            <Button size="sm" variant="secondary" @click="toggleFailing">{{ failing ? "恢复写入" : "让写入失败" }}</Button>
        </LabFixtureControls>
        <div class="models-page-fixture" :class="{'models-page-fixture--narrow': scene.includes('-narrow')}">
            <RolesPage v-if="scene.startsWith('roles')" :store="store" :writable="true" :report-write-failure="reportWriteFailure" data-lab-subject />
            <ProvidersPage v-else :store="store" :writable="true" :report-write-failure="reportWriteFailure" data-lab-subject />
        </div>
    </div>
</template>

<style scoped>
.models-page-fixture {
    height: 640px;
    min-height: 0;
    padding: var(--space-5);
    border-radius: var(--radius-panel);
    background: var(--panel-surface);
}

.models-page-fixture--narrow {
    width: 560px;
}
</style>
