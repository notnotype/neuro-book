<script setup lang="ts">
import {computed, ref} from "vue";
import FormSelect from "../../../src/components/form/FormSelect.vue";
import SegmentedControl from "../../../src/components/controls/SegmentedControl.vue";
import {useColorway} from "../composables/useColorway";
import {useTheme} from "../composables/useTheme";
import AccordionFixture from "./fixtures/AccordionFixture.vue";
import AlertDialogFixture from "./fixtures/AlertDialogFixture.vue";
import AutocompleteFixture from "./fixtures/AutocompleteFixture.vue";
import AvatarFixture from "./fixtures/AvatarFixture.vue";
import BadgeFixture from "./fixtures/BadgeFixture.vue";
import BreadcrumbFixture from "./fixtures/BreadcrumbFixture.vue";
import ButtonFixture from "./fixtures/ButtonFixture.vue";
import CalendarFixture from "./fixtures/CalendarFixture.vue";
import CheckboxGroupFixture from "./fixtures/CheckboxGroupFixture.vue";
import ColorPickerFixture from "./fixtures/ColorPickerFixture.vue";
import DateFieldFixture from "./fixtures/DateFieldFixture.vue";
import DatePickerFixture from "./fixtures/DatePickerFixture.vue";
import DateRangePickerFixture from "./fixtures/DateRangePickerFixture.vue";
import DialogWindowFixture from "./fixtures/DialogWindowFixture.vue";
import DropdownFixture from "./fixtures/DropdownFixture.vue";
import DrawerFixture from "./fixtures/DrawerFixture.vue";
import EditableFixture from "./fixtures/EditableFixture.vue";
import FormCheckboxFixture from "./fixtures/FormCheckboxFixture.vue";
import FormInputFixture from "./fixtures/FormInputFixture.vue";
import FormNumberInputFixture from "./fixtures/FormNumberInputFixture.vue";
import FormSelectFixture from "./fixtures/FormSelectFixture.vue";
import IconButtonFixture from "./fixtures/IconButtonFixture.vue";
import KbdFixture from "./fixtures/KbdFixture.vue";
import ListboxFixture from "./fixtures/ListboxFixture.vue";
import MenubarFixture from "./fixtures/MenubarFixture.vue";
import MonthPickerFixture from "./fixtures/MonthPickerFixture.vue";
import NavigationMenuFixture from "./fixtures/NavigationMenuFixture.vue";
import PaginationFixture from "./fixtures/PaginationFixture.vue";
import PinInputFixture from "./fixtures/PinInputFixture.vue";
import PopoverFixture from "./fixtures/PopoverFixture.vue";
import ProgressFixture from "./fixtures/ProgressFixture.vue";
import RadioGroupFixture from "./fixtures/RadioGroupFixture.vue";
import RangeCalendarFixture from "./fixtures/RangeCalendarFixture.vue";
import RatingFixture from "./fixtures/RatingFixture.vue";
import ScrollAreaFixture from "./fixtures/ScrollAreaFixture.vue";
import SegmentedControlFixture from "./fixtures/SegmentedControlFixture.vue";
import SliderFixture from "./fixtures/SliderFixture.vue";
import SpinnerFixture from "./fixtures/SpinnerFixture.vue";
import SplitterFixture from "./fixtures/SplitterFixture.vue";
import NestedGridFixture from "./fixtures/NestedGridFixture.vue";
import StepperFixture from "./fixtures/StepperFixture.vue";
import SwitchFieldFixture from "./fixtures/SwitchFieldFixture.vue";
import SwitchFixture from "./fixtures/SwitchFixture.vue";
import TabsFixture from "./fixtures/TabsFixture.vue";
import TimeFieldFixture from "./fixtures/TimeFieldFixture.vue";
import TimePickerFixture from "./fixtures/TimePickerFixture.vue";
import ToolbarFixture from "./fixtures/ToolbarFixture.vue";
import TreeFixture from "./fixtures/TreeFixture.vue";
import YearPickerFixture from "./fixtures/YearPickerFixture.vue";
import {LAB_BARE_THEME} from "./lab-url";
import {labViewports, type LabComponentDefinition, type LabComponentId, type LabViewportId} from "./registry";
import {labWallpapers} from "./wallpapers";

const props = defineProps<{
    definition: LabComponentDefinition;
    sceneId: string;
    viewportId: LabViewportId;
    themeValue: string;
    colorwayValue: string;
}>();

const emit = defineEmits<{
    (event: "update:scene", id: string): void;
    (event: "update:viewport", id: LabViewportId): void;
    (event: "update:theme", value: string): void;
    (event: "update:colorway", id: string): void;
    (event: "lab-event", name: string, payload?: unknown): void;
    (event: "rendered"): void;
}>();

const theme = useTheme();
const colorway = useColorway();

const fixtures: Record<LabComponentId, any> = {
    "form-input": FormInputFixture,
    "form-number-input": FormNumberInputFixture,
    "form-select": FormSelectFixture,
    "form-checkbox": FormCheckboxFixture,
    "time-picker": TimePickerFixture,
    "radio-group": RadioGroupFixture,
    "slider": SliderFixture,
    "pin-input": PinInputFixture,
    "calendar": CalendarFixture,
    "date-picker": DatePickerFixture,
    "range-calendar": RangeCalendarFixture,
    "date-range-picker": DateRangePickerFixture,
    "date-field": DateFieldFixture,
    "time-field": TimeFieldFixture,
    "month-picker": MonthPickerFixture,
    "year-picker": YearPickerFixture,
    "listbox": ListboxFixture,
    "color-picker": ColorPickerFixture,
    "autocomplete": AutocompleteFixture,
    "checkbox-group": CheckboxGroupFixture,
    "button": ButtonFixture,
    "icon-button": IconButtonFixture,
    "segmented-control": SegmentedControlFixture,
    "toggle-group": ToolbarFixture,
    "switch": SwitchFixture,
    "switch-field": SwitchFieldFixture,
    "dropdown": DropdownFixture,
    "tabs": TabsFixture,
    "toolbar": ToolbarFixture,
    "menubar": MenubarFixture,
    "editable": EditableFixture,
    "stepper": StepperFixture,
    "badge": BadgeFixture,
    "avatar": AvatarFixture,
    "progress": ProgressFixture,
    "kbd": KbdFixture,
    "spinner": SpinnerFixture,
    "rating": RatingFixture,
    "pagination": PaginationFixture,
    "breadcrumb": BreadcrumbFixture,
    "navigation-menu": NavigationMenuFixture,
    "tree": TreeFixture,
    "splitter": SplitterFixture,
    "nested-grid": NestedGridFixture,
    "accordion": AccordionFixture,
    "scroll-area": ScrollAreaFixture,
    "dialog-window": DialogWindowFixture,
    "popover": PopoverFixture,
    "alert-dialog": AlertDialogFixture,
    "drawer": DrawerFixture,
};

const activeFixture = computed(() => fixtures[props.definition.id]);

const sceneOptions = computed(() => props.definition.scenes.map((scene) => ({label: scene.label, value: scene.id})));
const viewportOptions = labViewports.map((viewport) => ({label: viewport.label, value: viewport.id}));

const themeOptions = computed(() => [
    {label: "裸基线", value: LAB_BARE_THEME},
    ...theme.themes.value.map((installed) => ({label: installed.manifest.name, value: installed.manifest.id})),
]);
const colorwayOptions = computed(() => colorway.colorwayIds.map((id) => ({label: colorway.colorwayMeta[id]?.label ?? id, value: id})));

const backdropOptions = labWallpapers.map((w) => ({label: w.label, value: w.id}));
const stageBackdrop = ref<string>("mesh");

const viewport = computed(() => labViewports.find((candidate) => candidate.id === props.viewportId) ?? labViewports[0]!);
// 画布底全部由 .lab-canvas--<id> 那组 CSS 给，这里只剩宽度。
// 原来还有一支从壁纸 url 拼 background-image 的分支，图片撤掉后不再需要（见 wallpapers.ts）。
const canvasStyle = computed(() => {
    const style: Record<string, string> = {};
    if (viewport.value.width !== null) {
        style.width = `${viewport.value.width}px`;
    }
    return style;
});
</script>

<template>
    <div class="lab-stage">
        <div class="lab-stage__toolbar lab-glass">
            <div class="lab-stage__identity">
                <strong class="lab-stage__name">{{ definition.labelZh }} <span class="lab-stage__name-en">{{ definition.label }}</span></strong>
                <SegmentedControl
                    :model-value="sceneId"
                    :options="sceneOptions"
                    aria-label="场景"
                    @update:model-value="emit('update:scene', String($event))"
                />
            </div>
            <div class="lab-stage__axes">
                <SegmentedControl
                    :model-value="viewportId"
                    :options="viewportOptions"
                    aria-label="预览宽度"
                    @update:model-value="emit('update:viewport', $event as LabViewportId)"
                />
                <label class="lab-stage__axis">
                    <span class="lab-stage__axis-label">背景</span>
                    <FormSelect
                        v-model="stageBackdrop"
                        :options="backdropOptions"
                        size="sm"
                        dropdown-direction="down"
                        hide-checkmark
                        class="lab-stage__axis-select"
                    />
                </label>
                <label class="lab-stage__axis">
                    <span class="lab-stage__axis-label">主题</span>
                    <FormSelect
                        :model-value="themeValue"
                        :options="themeOptions"
                        size="sm"
                        dropdown-direction="down"
                        hide-checkmark
                        class="lab-stage__axis-select"
                        @update:model-value="emit('update:theme', $event)"
                    />
                </label>
                <label class="lab-stage__axis">
                    <span class="lab-stage__axis-label">配色</span>
                    <FormSelect
                        :model-value="colorwayValue"
                        :options="colorwayOptions"
                        size="sm"
                        dropdown-direction="down"
                        hide-checkmark
                        class="lab-stage__axis-select"
                        @update:model-value="emit('update:colorway', $event)"
                    />
                </label>
            </div>
        </div>

        <div class="lab-stage__surface">
            <div class="lab-canvas-scroll">
                <div class="lab-canvas" :class="'lab-canvas--' + stageBackdrop" :style="canvasStyle" :data-viewport="viewportId">
                    <div v-if="viewport.width !== null" class="lab-canvas__ruler" aria-hidden="true">
                        <span class="lab-canvas__ruler-tick"></span>
                        <span class="lab-canvas__ruler-label">{{ viewport.width }} px</span>
                        <span class="lab-canvas__ruler-tick"></span>
                    </div>
                    <div class="lab-canvas-window">
                        <component
                            :is="activeFixture"
                            :definition="definition"
                            :scene-id="sceneId"
                            @lab-event="(name: string, payload?: unknown) => emit('lab-event', name, payload)"
                            @rendered="emit('rendered')"
                        />
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
