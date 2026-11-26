<script setup lang="ts">
/**
 * 表单里固定位置的状态行（t10 计划 3.1“状态行与表单错误”；nb-ui ui-development-spec“表单与无障碍”第 7 条）。写法照 nb-ui 对话框
 * 页脚的状态行（`DialogSurface` 的 `data-dialog-status`）：危险色、带图标、超长截断并把全文放进 `title`、`aria-live` 播报。
 * 账号页每一节保存成功后的那一句（计划 3.12“已保存”）用 `tone="success"`：成功色、对勾图标，其余相同。
 * 宽屏一行、窄屏两行（审查第 12 条：手机上没有悬停，`title` 看不到，原因要读得全）；空着时也占同样的高度，出错与恢复都不推动
 * 表单里别的东西。
 *
 * 按秒变字的原因（`rate_limited` 的倒数）给 `spoken`：live region 里只放这段固定的话，看得见的 `text` 对读屏隐藏，
 * 否则 polite 的 live region 每秒播报一遍（审查第 7 条）。
 */

const props = withDefaults(defineProps<{
    /** 状态行的 id。 */
    id?: string;
    /** 要显示的原因；空串表示没有。 */
    text?: string;
    /**
     * 这一条是哪件事（通常是失败码）。换成另一件事时旧的淡出、新的淡入；同一件事只改文字时（`rate_limited` 的倒数）原地换字，
     * 不每秒闪一次。不给时按文字区分。
     */
    reason?: string;
    /** 给读屏的固定说法；给了时看得见的 `text` 不进读屏。`text` 会按秒变时必须给。空串表示读屏读 `text`。 */
    spoken?: string;
    /** 失败（缺省）还是成功。 */
    tone?: "danger" | "success";
}>(), {id: undefined, text: "", reason: "", spoken: "", tone: "danger"});
</script>

<template>
    <p
        :id="props.id"
        class="form-status"
        :class="{'form-status--success': props.tone === 'success'}"
        :title="props.text || undefined"
        aria-live="polite"
        data-site-form-status
        :data-site-form-status-error="props.text !== '' && props.tone === 'danger' ? '' : undefined"
        :data-site-form-status-tone="props.text !== '' ? props.tone : undefined"
    >
        <Transition name="form-status">
            <span v-if="props.text !== ''" :key="props.reason || props.text" class="form-status__line">
                <span :class="props.tone === 'success' ? 'i-lucide-circle-check' : 'i-lucide-circle-alert'" class="form-status__icon" aria-hidden="true"></span>
                <span v-if="props.spoken !== ''" class="sr-only" data-site-form-status-spoken>{{ props.spoken }}</span>
                <span class="form-status__text" :aria-hidden="props.spoken !== '' ? 'true' : undefined" data-site-form-status-text>{{ props.text }}</span>
                <slot name="action" />
            </span>
        </Transition>
    </p>
</template>

<style scoped>
/* 出错时是服务端判出的原因，要能复制，所以可选（ui-development-spec 的“文字能否选中”）。 */
.form-status {
    --form-status-lines: 1;
    position: relative;
    height: calc(1lh * var(--form-status-lines));
    margin: 0;
    color: var(--status-danger);
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    user-select: text;
}

.form-status--success {
    color: var(--status-success);
}

/* 与稿纸的手机版式同一个断点（`PaperSheet.vue`）：卡片里放得下的字少，留两行。 */
@media (max-width: 560px) {
    .form-status {
        --form-status-lines: 2;
    }
}

/* 旧的与新的叠在同一个位置交叉淡入淡出，高度不变。图标对齐第一行。 */
.form-status__line {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: flex-start;
    gap: 6px;
    min-width: 0;
}

.form-status__icon {
    flex-shrink: 0;
    width: 14px;
    height: 1lh;
}

.form-status__text {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: var(--form-status-lines);
    line-clamp: var(--form-status-lines);
    min-width: 0;
    overflow: hidden;
    overflow-wrap: anywhere;
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
