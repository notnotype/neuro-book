<script setup lang="ts">
/**
 * 账号页的一节（t10 计划 3.12）：标题、内容，底部一行是这一节的操作与状态行。每节自己保存，结果写在自己的状态行，
 * 状态行空着时也占着位置（`FormStatus`），出现与消失都不推动这一节里的东西。窄屏时状态行另起一行（它在窄屏是两行高）。
 *
 * 根元素的 `id` 是目录的锚点（`#profile` 这些，计划 3.1 的路由表）；`ref` 给出根元素，各节标红字段时在它里面找输入框。
 */

import {useTemplateRef} from "vue";

import FormStatus from "../../components/FormStatus.vue";

const props = withDefaults(defineProps<{
    /** 锚点，也是 `data-site-account-section` 的值。 */
    id: string;
    title: string;
    statusText?: string;
    statusReason?: string;
    statusSpoken?: string;
    statusTone?: "danger" | "success";
}>(), {statusText: "", statusReason: "", statusSpoken: "", statusTone: "danger"});

const root = useTemplateRef<HTMLElement>("root");

defineExpose({root});
</script>

<template>
    <section :id="props.id" ref="root" class="account-section" :aria-labelledby="`${props.id}-title`" :data-site-account-section="props.id">
        <h2 :id="`${props.id}-title`" class="account-section__title" data-site-account-section-title>{{ props.title }}</h2>
        <slot />
        <div class="account-section__foot">
            <slot name="actions" />
            <FormStatus
                class="account-section__status"
                :text="props.statusText"
                :reason="props.statusReason"
                :spoken="props.statusSpoken"
                :tone="props.statusTone"
            />
        </div>
    </section>
</template>

<style scoped>
/* 节的尺寸容器：资料的两列在节窄时并成一列（按节的宽度判，不按视口）。 */
.account-section {
    container-type: inline-size;
    padding: 20px 24px;
    border-radius: var(--radius-panel);
    background: var(--bg-panel);
    scroll-margin-top: 20px;
}

.account-section__title {
    margin: 0 0 14px;
    font-size: var(--text-lg);
    font-weight: 600;
    line-height: var(--leading-ui);
}

.account-section__foot {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 16px;
}

.account-section__status {
    flex: 1 1 0;
    min-width: 0;
}

/* 与 `FormStatus` 变成两行高的断点相同：状态行独占一行，原因写得全。 */
@media (max-width: 560px) {
    .account-section {
        padding: 16px;
    }

    .account-section__foot {
        flex-wrap: wrap;
    }

    .account-section__status {
        flex-basis: 100%;
    }
}
</style>
