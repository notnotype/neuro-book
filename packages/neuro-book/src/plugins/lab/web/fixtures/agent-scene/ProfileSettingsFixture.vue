<script setup lang="ts">
/** Profile 设置页的夹具：模型与审批改了就更新，能在 Lab 里点。 */
import {computed, shallowRef} from "vue";

import ProfileSettingsPage from "nbook/plugins/agent/web/components/ProfileSettingsPage.vue";
import type {ProfileView} from "nbook/plugins/agent/web/profile-view";

import type {LabSceneInput} from "../../lab-subject";

const props = defineProps<{scene: string; input?: LabSceneInput}>();
const page = computed(() => (props.input?.props ?? {}) as {state: "loading" | "ready" | {failed: string}; profiles: readonly ProfileView[]; initial?: string; writable?: boolean});
const profiles = shallowRef<readonly ProfileView[]>(page.value.profiles);
function update(key: string, change: (profile: ProfileView) => ProfileView): void {
    profiles.value = profiles.value.map((profile) => (profile.key === key ? change(profile) : profile));
}
</script>

<template>
    <div class="profile-settings-fixture" :class="{'is-narrow': scene.startsWith('narrow')}" data-lab-subject>
        <ProfileSettingsPage
            :state="page.state"
            :profiles="profiles"
            :writable="page.writable ?? true"
            :initial="page.initial"
            @model="(key, value) => update(key, (profile) => ({...profile, model: {...profile.model, value}}))"
            @approval="(key, value) => update(key, (profile) => profile.approval === null ? profile : {...profile, approval: {...profile.approval, value}})"
        />
    </div>
</template>

<style scoped>
.profile-settings-fixture {
    width: 760px;
    height: 100%;
    min-height: 600px;
    box-sizing: border-box;
    padding: 16px;
    background: var(--surface-panel, var(--surface-base));
}

.profile-settings-fixture.is-narrow {
    width: 480px;
}
</style>
