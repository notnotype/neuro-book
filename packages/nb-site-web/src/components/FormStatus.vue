<script setup lang="ts">
/**
 * 表单里固定位置的状态行（t10 计划 3.1“状态行与表单错误”；nb-ui ui-development-spec“表单与无障碍”第 7 条）。写法照 nb-ui 对话框
 * 页脚的状态行（`DialogSurface` 的 `data-dialog-status`）：一行、危险色、带图标、超长截断并把全文放进 `title`、`aria-live` 播报。
 * 空着时也占一行的高度，出错与恢复都不推动表单里别的东西。
 */

const props = withDefaults(defineProps<{
    /** 状态行的 id：出错的字段用 `aria-describedby` 指过来，读屏读字段时连原因一起读。 */
    id?: string;
    /** 要显示的原因；空串表示没有。 */
    text?: string;
    /**
     * 这一条是哪件事（通常是失败码）。换成另一件事时旧的淡出、新的淡入；同一件事只改文字时（`rate_limited` 的倒数）原地换字，
     * 不每秒闪一次。不给时按文字区分。
     */
    reason?: string;
}>(), {id: undefined, text: "", reason: ""});
</script>

<template>
    <p
        :id="props.id"
        class="form-status"
        :title="props.text || undefined"
        aria-live="polite"
        data-site-form-status
        :data-site-form-status-error="props.text !== '' ? '' : undefined"
    >
        <Transition name="form-status">
            <span v-if="props.text !== ''" :key="props.reason || props.text" class="form-status__line">
                <span class="i-lucide-circle-alert form-status__icon" aria-hidden="true"></span>
                <span class="form-status__text">{{ props.text }}</span>
                <slot name="action" />
            </span>
        </Transition>
    </p>
</template>

<style scoped>
/* 出错时是服务端判出的原因，要能复制，所以可选（ui-development-spec 的“文字能否选中”）。 */
.form-status {
    position: relative;
    height: 1lh;
    margin: 0;
    color: var(--status-danger);
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    user-select: text;
}

/* 旧的与新的叠在同一个位置交叉淡入淡出，行高不变。 */
.form-status__line {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
}

.form-status__icon {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
}

.form-status__text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.form-status-enter-active,
.form-status-leave-active {
    transition: opacity var(--motion-base) var(--ease-layout);
}

.form-status-enter-from,
.form-status-leave-to {
    opacity: 0;
}
</style>
