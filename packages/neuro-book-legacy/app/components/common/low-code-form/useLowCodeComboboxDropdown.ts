import {onClickOutside} from "@vueuse/core";
import type {ComputedRef} from "vue";
import {computed, ref} from "vue";
import {useFloatingPanelLayout, type FloatingPanelDirection} from "nbook/app/composables/useFloatingPanelLayout";
import type {LowCodeFieldDto, LowCodeJsonValue} from "nbook/shared/dto/low-code-form.dto";
import {formatLowCodeValue} from "nbook/app/components/common/low-code-form/low-code-form-utils";

type LowCodeComboboxDropdownOptions = {
    field: ComputedRef<LowCodeFieldDto>;
    modelValue: ComputedRef<LowCodeJsonValue | undefined>;
    disabled: ComputedRef<boolean>;
};

/**
 * 管理低代码 combobox 的搜索状态与浮层布局。
 */
export function useLowCodeComboboxDropdown(options: LowCodeComboboxDropdownOptions) {
    const rootRef = ref<HTMLDivElement | null>(null);
    const panelRef = ref<HTMLDivElement | null>(null);
    const open = ref(false);
    const query = ref("");
    const direction = ref<FloatingPanelDirection>("auto");

    const {
        resolvedDirection,
        panelStyle,
        updateLayout,
    } = useFloatingPanelLayout({
        open,
        anchorRef: rootRef,
        panelRef,
        direction,
        maxHeight: 224,
    });

    onClickOutside(rootRef, () => {
        open.value = false;
    });

    const selectedOption = computed(() => options.field.value.options.find((option) => option.value === options.modelValue.value));
    const displayValue = computed(() => selectedOption.value?.label ?? formatLowCodeValue(options.modelValue.value));
    const filteredOptions = computed(() => {
        const keyword = query.value.trim().toLowerCase();
        if (!keyword) {
            return options.field.value.options;
        }
        return options.field.value.options.filter((option) => {
            const text = `${option.label} ${String(option.value)} ${option.description ?? ""}`.toLowerCase();
            return text.includes(keyword);
        });
    });

    /**
     * 聚焦输入框时打开选项浮层，并重置搜索词。
     */
    function focusInput(): void {
        if (options.disabled.value) {
            return;
        }
        query.value = "";
        open.value = true;
    }

    /**
     * 点击箭头时切换浮层，保持和普通下拉一致。
     */
    function toggleOpen(): void {
        if (options.disabled.value) {
            return;
        }
        open.value = !open.value;
    }

    /**
     * 输入搜索词时强制打开浮层。
     */
    function updateQuery(value: string): void {
        query.value = value;
        if (!options.disabled.value) {
            open.value = true;
        }
    }

    /**
     * 选中后关闭浮层并清空搜索词。
     */
    function closeAfterSelect(): void {
        open.value = false;
        query.value = "";
    }

    return {
        rootRef,
        panelRef,
        open,
        query,
        selectedOption,
        displayValue,
        filteredOptions,
        resolvedDirection,
        panelStyle,
        updateLayout,
        focusInput,
        toggleOpen,
        updateQuery,
        closeAfterSelect,
    };
}
