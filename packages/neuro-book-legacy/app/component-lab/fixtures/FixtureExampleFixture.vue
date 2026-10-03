<script setup lang="ts">
/**
 * FixtureExample 的 Component Lab 标准夹具，示范分层输入合同：
 *
 * 1. 输入：`useLabSubject` 把场景 `input` 的 props / model 层绑到组件，键名与组件 prop 逐字一致；
 * 2. 事件：签名里的每个事件由 `useLabSubject` 记进事件 tab，fixture 不逐个转发；
 * 3. 宿主扮演：`toggle` 不是 `update:active`，所以 `active` 是普通 prop——fixture 扮演宿主，收到 `toggle` 后用 `write` 改它，
 *    数据面板同步更新。这正是组件文档要说清的事：谁持有这个值；
 * 4. 插槽：`#extra` 的预设内容由场景 `input.slots.extra` 开关，在 `fixtures/index.ts` 登记为可切换插槽；
 * 5. 舞台只放组件本身，标 `data-lab-subject`；尺寸靠 Lab 视口预设验证，不在 fixture 里平铺副本。
 */
import FixtureExample from "../FixtureExample.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();

const subject = useLabSubject<typeof FixtureExample>(() => props.input, ["toggle", "action"]);
</script>

<template>
    <FixtureExample
        data-lab-subject
        class="w-full"
        v-bind="subject.bindings.value"
        @toggle="subject.write('props', 'active', $event)"
    >
        <template v-if="subject.slots.value.extra" #extra>
            <span class="font-mono text-[11px] text-[var(--accent-text)]">v1.2</span>
        </template>
    </FixtureExample>
</template>
