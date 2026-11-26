<script setup lang="ts">
/**
 * `SanctumScene` 单独看（Lab）：桌上放一张象牙色的占位（几条灰线代表面板），首屏的字只放第一句。
 * 进度是静止的，看俯冲中某一刻的构图；要看开场就选 `intro` 为真的场景，“重播”再演一遍。
 */
import {ref} from "vue";

import LabFixtureControls from "../../LabFixtureControls.vue";
import {useLabSubject} from "../../lab-subject";
import type {LabFixtureProps} from "../../lab-subject";
import {HEADLINES} from "./copy";
import SanctumScene from "./SanctumScene.vue";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof SanctumScene>(() => props.input, ["landed"]);
const replay = ref(0);
</script>

<template>
    <div class="sx-fixture" data-lab-subject>
        <SanctumScene :key="`${props.scene}-${replay}`" v-bind="subject.bindings.value">
            <template #desk>
                <div class="sx-fixture__desk">
                    <span class="sx-fixture__bar"></span>
                    <span class="sx-fixture__side"></span>
                    <span class="sx-fixture__page"></span>
                    <span class="sx-fixture__side"></span>
                </div>
            </template>
            <template #hero="{lit}">
                <h1 class="sx-fixture__title" :class="{'is-lit': lit}">{{ HEADLINES.m2 }}</h1>
            </template>
        </SanctumScene>
    </div>
    <LabFixtureControls>
        <button type="button" class="nb-ui-focus-ring rounded px-2 py-1 text-xs text-[var(--accent-text)] hover:bg-[var(--bg-hover)]" @click="replay += 1">重播</button>
    </LabFixtureControls>
</template>

<style scoped>
.sx-fixture {
    position: relative;
    width: 100%;
    height: 100%;
}

.sx-fixture__desk {
    display: grid;
    grid-template-columns: 44px 200px 1fr 280px;
    gap: 6px;
    height: 100%;
    padding: 6px;
    background: #ece6da;
}

.sx-fixture__desk > span {
    border-radius: 10px;
    background: #f6f2ea;
}

.sx-fixture__page {
    background: #fffcf5 !important;
}

.sx-fixture__title {
    position: absolute;
    top: 14%;
    left: 50%;
    margin: 0;
    color: #f7f2ec;
    font-family: "Source Han Serif SC", "Noto Serif CJK SC", serif;
    font-size: 54px;
    font-weight: 600;
    letter-spacing: 0.08em;
    white-space: nowrap;
    opacity: 0;
    transform: translateX(-50%);
    transition: opacity 1000ms ease 650ms;
}

.sx-fixture__title.is-lit {
    opacity: 1;
}
</style>
