<script setup lang="ts">
import {computed, nextTick, ref, watch, inject} from "vue";
import {onClickOutside} from "@vueuse/core";
import {useAnchoredPopup} from "../../composables/useAnchoredPopup";
import {NB_POPOVER_Z_INDEX, NB_Z_INDEX} from "../../theme/z-index";
import {useFormFieldContext} from "./form-field-context";
import {
    TIME_PICKER_DEFAULT_STEP,
    clampMinutes,
    formatMinutes,
    parseTimeToMinutes,
    timeOptions,
} from "./time-picker-contract";
import type {TimePickerEmits, TimePickerProps} from "./time-picker-contract";

/** 窗口内的浮层跟随窗口层级（由 DialogWindow 注入）；未被窗口承载时回退到普通页面层级。 */
const popoverZIndex = inject(NB_POPOVER_Z_INDEX, NB_Z_INDEX.popover);


/**
 * 时间选择器的库默认实现：输入框 + 下拉时间列表。
 *
 * 与 macOS 主题的滚轮实现刻意做成最大反差（形态完全不同，契约完全相同）。
 * 这里的一切尺寸都走 token（`var(--control-h-md)` / `var(--radius-control)` …）——
 * 现有 28 个组件把刻度硬编码在模板里（FormSelect.vue 是 `h-9` / `px-3` / `text-sm`），
 * 那是阶段 2 要还的债，新组件不许照抄。
 */
const props = withDefaults(defineProps<TimePickerProps>(), {
    modelValue: undefined,
    min: undefined,
    max: undefined,
    step: TIME_PICKER_DEFAULT_STEP,
    disabled: false,
    invalid: false,
    placeholder: "--:--",
    id: undefined,
});

const emit = defineEmits<TimePickerEmits>();

const field = useFormFieldContext();

const open = ref(false);
const draft = ref(props.modelValue ?? "");
const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLInputElement | null>(null);
/** 浮层外框：定位、点外面判定与外观都挂在它上面 */
const popup = ref<HTMLElement | null>(null);
/** 内部滚动区（role=listbox）。与外框分开是为了让滚动条与切口落在描边内侧，见 styles.css */
const list = ref<HTMLElement | null>(null);
/** Esc 要回滚到的值：在触发器获得焦点的那一刻记下 */
const anchor = ref<string | undefined>(props.modelValue);

const listId = computed(() => `${props.id ?? field?.inputId.value ?? "nb-time-picker"}-listbox`);
const options = computed(() => timeOptions(props.min, props.max, props.step));
const invalid = computed(() => props.invalid || (field?.invalid.value ?? false));

// 外部改 v-model 时同步输入框文本；用户正在输入的中间态不受影响（那时不会有外部改动）
watch(
    () => props.modelValue,
    (value) => {
        draft.value = value ?? "";
    },
);

function commit(minutes: number): void {
    emit("update:modelValue", formatMinutes(clampMinutes(minutes, props.min, props.max)));
}

/** ↑↓ 的增量。没有当前值时从 min 起步，而不是从 00:00——min 通常本身就是想选的时刻 */
function adjust(direction: 1 | -1): void {
    const current = parseTimeToMinutes(props.modelValue);
    if (current === null) {
        commit(parseTimeToMinutes(props.min ?? "00:00") ?? 0);
        return;
    }
    commit(current + direction * props.step);
}

async function focusTrigger(): Promise<void> {
    await nextTick();
    trigger.value?.focus();
}

function close(): void {
    open.value = false;
    void focusTrigger();
}

/*
 * 点外面关掉。这是「弹出层」这个形态自带的期待，不做的话点了别处它还开着，
 * 用户只能再点回触发器——上一版就是这样。
 *
 * 与 Esc 刻意不同的两点：**不回滚值**（点外面是「就这样吧」，Esc 才是「算了」），
 * **不抢回焦点**（用户刚点了别的东西，把焦点拽回来会跟他抢）。
 *
 * ignore 必须带上列表：它已经被传送到 body，DOM 上不再是 root 的后代，
 * 不排除的话点一个候选项会先被判成「点了外面」。
 */
onClickOutside(
    root,
    () => {
        open.value = false;
    },
    {ignore: [popup]},
);

const popupStyle = useAnchoredPopup(trigger, popup, open);

/*
 * 打开时把当前值滚进视野。
 *
 * 用 scrollTop 直接算，不用 scrollIntoView：后者会连带滚动**所有**可滚的祖先，
 * 于是「点开一个下拉」变成「整页跳走」。这个坑在滚轮实现上更明显，两处同样处理。
 */
watch(open, async (isOpen) => {
    if (!isOpen) {
        return;
    }
    await nextTick();
    const container = list.value;
    const selected = container?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (container == null || selected == null) {
        return;
    }
    container.scrollTop = selected.offsetTop - (container.clientHeight - selected.offsetHeight) / 2;
});

function onFocus(): void {
    anchor.value = props.modelValue;
}

function onKeydown(event: KeyboardEvent): void {
    if (props.disabled) {
        return;
    }
    switch (event.key) {
        case "ArrowUp": {
            event.preventDefault();
            adjust(-1);
            break;
        }
        case "ArrowDown": {
            event.preventDefault();
            adjust(1);
            break;
        }
        case "Enter": {
            event.preventDefault();
            if (open.value) {
                close();
            } else {
                open.value = true;
            }
            break;
        }
        case "Escape": {
            event.preventDefault();
            emit("update:modelValue", anchor.value);
            draft.value = anchor.value ?? "";
            close();
            break;
        }
        // Tab 不拦截：原生移焦是契约的一部分
        default: {
            break;
        }
    }
}

/** 输入框里手打的文本。解析不出来就还原，不猜测——猜错比拒绝更难查 */
function onChange(): void {
    const minutes = parseTimeToMinutes(draft.value);
    if (minutes === null) {
        draft.value = props.modelValue ?? "";
        return;
    }
    commit(minutes);
}

function select(value: string): void {
    const minutes = parseTimeToMinutes(value);
    if (minutes !== null) {
        commit(minutes);
    }
    close();
}
</script>

<template>
    <div ref="root" class="nb-ui-time-picker relative" data-nb-time-picker="default">
        <input
            ref="trigger"
            v-model="draft"
            type="text"
            role="combobox"
            autocomplete="off"
            :id="props.id || field?.inputId.value || undefined"
            :disabled="props.disabled"
            :placeholder="props.placeholder"
            :aria-expanded="open"
            :aria-controls="listId"
            aria-haspopup="listbox"
            :aria-invalid="invalid || undefined"
            :aria-describedby="field?.ariaDescribedby.value"
            class="nb-ui-control w-full border outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            :class="invalid ? 'nb-ui-control-invalid' : ''"
            :style="{
                height: 'var(--control-h-md)',
                paddingInline: 'var(--control-px)',
                borderRadius: 'var(--radius-control)',
                borderWidth: 'var(--border-w)',
                borderColor: 'var(--control-outline)',
                background: 'var(--control-surface)',
                fontSize: 'var(--text-sm)',
                fontFamily: 'var(--font-ui)',
                color: 'var(--text-main)',
            }"
            @focus="onFocus"
            @keydown="onKeydown"
            @change="onChange"
            @click="open = props.disabled ? false : true"
        />

        <!--
            传送到 body。原地绝对定位的弹出层会被任何一个 overflow: hidden 的祖先切掉——
            而面板为了圆角本来就得 overflow: hidden，这不是假想的情况。

            外框 / 滚动区分两层：边框、圆角、面色、阴影、磨砂全部由 .nb-ui-popover-surface
            一处给（不重写，重写等于把浮层外观从登记处偷偷分叉出去），滚动交给内部的
            .nb-ui-popover-scroll。合成一层的话滚动条会画进圆角、首尾两项会被弧线削掉。
        -->
        <Teleport to="body">
            <Transition name="nb-time-popup">
                <div
                    v-if="open"
                    ref="popup"
                    class="nb-ui-popover-surface nb-ui-menu-surface overflow-hidden"
                    :style="{...popupStyle, zIndex: String(popoverZIndex), padding: 'var(--space-3)'}"
                >
                    <ul
                        ref="list"
                        :id="listId"
                        role="listbox"
                        class="nb-ui-popover-scroll nb-ui-popover-scroll-fade max-h-60"
                        :style="{borderRadius: 'var(--nb-popover-inner-radius)'}"
                    >
                        <!--
                            外观全部走类，不写 inline style：inline 的优先级压过任何类，
                            写在这里就再也做不出 :hover——上一版正是这样，一个「点得动但没有任何反馈」的列表。
                            选中态也走类，理由相同：它要和 hover 在同一套层叠里比大小。
                        -->
                        <li
                            v-for="option in options"
                            :key="option"
                            role="option"
                            :aria-selected="option === props.modelValue"
                            class="nb-time-option"
                            :class="option === props.modelValue ? 'is-selected' : ''"
                            @click="select(option)"
                        >
                            {{ option }}
                        </li>
                    </ul>
                </div>
            </Transition>
        </Teleport>
    </div>
</template>

<style scoped>
/*
 * 入场 / 退场。浮层从触发器那儿「长出来」，所以缩放的原点在顶端而不是中心——
 * 中心缩放会让浮层看起来是凭空浮现在半空中，而它明明贴着输入框。
 *
 * 时长按 design-language.md 动效节分档：入场 = 浮层出现走 --motion-enter，
 * 退场是「这件事结束了」走 --motion-fast。
 * 三个时长在 prefers-reduced-motion 下被库归零（带 !important），所以这里不必自己再关一次。
 */
.nb-time-popup-enter-active {
    transition:
        opacity var(--motion-enter) var(--ease-standard),
        transform var(--motion-enter) var(--ease-standard);
    transform-origin: top center;
}

.nb-time-popup-leave-active {
    transition:
        opacity var(--motion-fast) var(--ease-standard),
        transform var(--motion-fast) var(--ease-standard);
    transform-origin: top center;
}

.nb-time-popup-enter-from,
.nb-time-popup-leave-to {
    opacity: 0;
    transform: scale(0.96);
}

.nb-time-option {
    cursor: pointer;
    padding: var(--space-2) var(--space-4);
    /* 与外框同心：项贴着浮层的边，圆角必须由外圈推出来，不能取控件档（见 styles.css 的 --nb-popover-inner-radius） */
    border-radius: var(--nb-popover-inner-radius);
    font-size: var(--text-sm);
    font-family: var(--font-mono);
    color: var(--text-main);
    background: transparent;
    transition: background-color var(--motion-fast) var(--ease-standard);
}

/*
 * :hover 而不是 :hover:not(.is-selected)：选中项也该给反馈。
 * 选中态那条排在后面且同为单类选择器，所以它照样赢，hover 只在未选中的项上看得出来——
 * 这正好是想要的：「当前值」不需要靠 hover 再强调一次。
 */
.nb-time-option:hover {
    background: var(--overlay-item-active);
}

.nb-time-option.is-selected {
    background: var(--accent-bg);
    color: var(--accent-text);
}
</style>
