<script setup lang="ts">
import {computed} from "vue";
import type {ProductAppearance, ProductThemeId} from "nbook/shared/theme/theme-axes";
import FrontendSettingsView from "../../components/novel-ide/settings/sections/frontend/FrontendSettingsView.vue";
import type {ColorwayDraft} from "../../components/novel-ide/settings/sections/frontend/FrontendSettingsView.types";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const {t} = useI18n();
const subject = useLabSubject<typeof FrontendSettingsView>(() => props.input, ["select-theme", "select-appearance", "select-colorway", "save-colorway", "delete-colorway", "export-colorway"]);
const view = computed(() => subject.bindings.value);

// 就地保存的模拟：视图每次动作都由夹具立刻应用，并记录事件。
function onSelectTheme(value: ProductThemeId): void {
    subject.write("props", "themeId", value);
}

function onSelectAppearance(value: ProductAppearance): void {
    subject.write("props", "appearance", value);
    subject.write("props", "colorwayId", value === "dark" ? "nbook-dark" : "nbook-light");
}

function onSelectColorway(id: string): void {
    subject.write("props", "colorwayId", id);
    subject.write("props", "appearance", view.value.userColorways.find((colorway) => colorway.id === id)?.appearance ?? view.value.appearance);
}

function onSaveColorway(draft: ColorwayDraft): void {
    const id = draft.id ?? `custom-lab-${view.value.userColorways.length + 1}`;
    const saved = {id, label: draft.label, appearance: draft.appearance, swatch: draft.vars["--bg-main"] ?? "", vars: {...draft.vars}};
    subject.write("props", "userColorways", [...view.value.userColorways.filter((colorway) => colorway.id !== id), saved]);
    subject.write("props", "colorwayId", id);
    subject.write("props", "appearance", draft.appearance);
}

function onDeleteColorway(id: string): void {
    subject.write("props", "userColorways", view.value.userColorways.filter((colorway) => colorway.id !== id));
    if (view.value.colorwayId === id) subject.write("props", "colorwayId", view.value.appearance === "dark" ? "nbook-dark" : "nbook-light");
}

const viewBindings = computed(() => ({
    ...view.value,
    "onSelect-theme": onSelectTheme,
    "onSelect-appearance": onSelectAppearance,
    "onSelect-colorway": onSelectColorway,
    "onSave-colorway": onSaveColorway,
    "onDelete-colorway": onDeleteColorway,
}));
</script>

<template>
    <div class="h-full min-h-0 w-full overflow-y-auto p-[var(--space-6)]">
        <div class="max-w-3xl">
            <p class="mb-4 text-xs text-[var(--text-muted)]">{{ t("settings.frontend.themeDescription") }}</p>
            <FrontendSettingsView v-bind="viewBindings" />
        </div>
    </div>
</template>
