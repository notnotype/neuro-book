<script setup lang="ts">
/**
 * 账号页的一节（t10 计划 3.12）：标题、内容，有操作的节底部一行是操作。每节自己保存，结果写在自己的状态行（`FormStatus`），
 * 状态行空着时也占着位置，出现与消失都不推动这一节里的东西。
 *
 * 状态行放在已有的一行里，不另占一行（B4 审查第 6 条：空着的状态行在节底留下一大块空白，定稿里节底就是内边距）：
 * - 有操作（`actions` 插槽）的节：与按钮同一行，在按钮右边。手机宽状态行是两行高（36px），比按钮（34px）只高 2px。
 * - 没有操作的节，或节底已经放满的节（`statusInHead`）：放进标题行，跟在标题后面。标题行的高度钉在标题的一行高：手机宽两行高的
 *   状态行从标题顶上对齐，伸进标题下面的间距（14px 里伸进 12px），不推动内容。
 *
 * 标题可以得到焦点（`tabindex="-1"`）：点目录跳到这一节时焦点给它，读屏读出到了哪一节，下一次 Tab 接着进这一节（`focusTitle`）。
 *
 * 根元素的 `id` 是目录的锚点（`#profile` 这些，计划 3.1 的路由表）；`ref` 给出根元素，各节标红字段时在它里面找输入框。
 */

import {computed, useSlots, useTemplateRef} from "vue";

import FormStatus from "../../components/FormStatus.vue";

const props = withDefaults(defineProps<{
    /** 锚点，也是 `data-site-account-section` 的值。 */
    id: string;
    title: string;
    statusText?: string;
    statusReason?: string;
    statusSpoken?: string;
    statusTone?: "danger" | "success";
    /** 有操作也把状态行放进标题行（节底已有别的说明，例如邀请码的配额）。 */
    statusInHead?: boolean;
}>(), {statusText: "", statusReason: "", statusSpoken: "", statusTone: "danger", statusInHead: false});

const slots = useSlots();
const inHead = computed(() => props.statusInHead || slots.actions === undefined);

const root = useTemplateRef<HTMLElement>("root");
const title = useTemplateRef<HTMLElement>("title");

/** 焦点给标题，不再滚动（调用方已经把这一节滚进来了）。 */
function focusTitle(): void {
    title.value?.focus({preventScroll: true});
}

defineExpose({root, focusTitle});
</script>

<template>
    <section :id="props.id" ref="root" class="account-section" :aria-labelledby="`${props.id}-title`" :data-site-account-section="props.id">
        <div class="account-section__head">
            <h2 :id="`${props.id}-title`" ref="title" class="account-section__title" tabindex="-1" data-site-account-section-title>{{ props.title }}</h2>
            <FormStatus
                v-if="inHead"
                class="account-section__status account-section__status--head"
                :text="props.statusText"
                :reason="props.statusReason"
                :spoken="props.statusSpoken"
                :tone="props.statusTone"
            />
        </div>
        <slot />
        <div v-if="slots.actions !== undefined" class="account-section__foot">
            <slot name="actions" />
            <FormStatus
                v-if="!inHead"
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
    --account-title-line: calc(var(--text-lg) * var(--leading-ui));
    container-type: inline-size;
    padding: 20px 24px;
    border-radius: var(--radius-panel);
    background: var(--bg-panel);
    scroll-margin-top: 20px;
}

/* 高度钉在标题的一行高：状态行比它高时伸出去，不撑高这一行。 */
.account-section__head {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    height: var(--account-title-line);
    margin-bottom: 14px;
}

.account-section__title {
    flex: none;
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 600;
    line-height: var(--leading-ui);
}

/* 只有点目录时由脚本聚焦，鼠标与键盘都不会停在这里，不画焦点环。 */
.account-section__title:focus {
    outline: none;
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

/* 状态行第一行与标题那一行居中对齐（`1lh` 是状态行自己的行高）。 */
.account-section__status--head {
    margin-top: calc((var(--account-title-line) - 1lh) / 2);
}

@media (max-width: 560px) {
    .account-section {
        padding: 16px;
    }

    /* 两行高的状态行比标题行高，居中会再往下伸 3px、压到内容上；改成顶对齐。 */
    .account-section__status--head {
        margin-top: 0;
    }
}
</style>
