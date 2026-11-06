<script setup lang="ts">
/** 主题编辑器的“配色”分区（同名 .md）：主色与推导、按用途分组的 33 个配色变量、折叠的角色变量。 */
import {computed, ref} from "vue";

import {Button, Collapsible} from "@notnotype/nb-ui/components";

import type {ContrastCheck} from "nbook/ui/theme/contrast-checks";

import {THEME_ROLE_VARS} from "../../../shared/themes";
import {useWorkbenchText} from "../../text";
import ColorField from "./ColorField.vue";
import DraftInput from "./DraftInput.vue";
import {SEED_KEYS} from "./theme-editor-model";
import type {SeedName, ThemeEditorModel} from "./theme-editor-model";

defineOptions({name: "ThemeEditorColors"});

const props = defineProps<{model: ThemeEditorModel}>();
const text = useWorkbenchText();
const model = props.model;

/** 33 个变量按用途分的组；三个主色在上面单独一行，这里不重复。`--color-scheme` 由明暗决定，不在这里改。 */
const GROUPS: ReadonlyArray<{readonly id: "Background" | "Text" | "Border" | "Accent" | "Status" | "Other"; readonly keys: ReadonlyArray<string>}> = [
    {id: "Background", keys: ["--bg-panel", "--bg-sidebar", "--bg-subtle", "--bg-input", "--bg-hover"]},
    {id: "Text", keys: ["--text-secondary", "--text-muted", "--text-inverse"]},
    {id: "Border", keys: ["--border-color", "--border-strong", "--border-accent"]},
    {id: "Accent", keys: ["--accent-bg", "--accent-text", "--selection-bg"]},
    {id: "Status", keys: ["info", "success", "warning", "danger"].flatMap((kind) => [`--status-${kind}`, `--status-${kind}-bg`, `--status-${kind}-border`])},
    {id: "Other", keys: ["--shadow-color", "--shadow-panel", "--overlay-bg"]},
];
const PLAIN = new Set(["--shadow-panel"]);

const SEEDS: ReadonlyArray<SeedName> = ["background", "text", "accent"];
const seedLabel = (seed: SeedName): string => text(`themeEditor.colors.seed${seed[0]?.toUpperCase()}${seed.slice(1)}` as "themeEditor.colors.seedBackground");

const colors = computed(() => model.colors.value);
const checks = computed(() => new Map(model.contrast.value.map((check): [string, ContrastCheck] => [check.key, check])));
const otherLabel = computed(() => text(model.appearance.value === "light" ? "themeEditor.appearance.dark" : "themeEditor.appearance.light"));
const failed = ref(false);

const derive = async (): Promise<void> => {
    failed.value = !(await model.derive());
};
/** 单项还原：主色读不懂时推不出值，和“推导整套”一样给提示，不让按钮静默无效。 */
const resetOne = async (name: string): Promise<void> => {
    failed.value = !(await model.resetColor(name));
};
const deriveFromOther = async (): Promise<void> => {
    failed.value = !(await model.deriveFromOther());
};

const roleValue = (name: string): string => model.current.value?.declaration[model.appearance.value].vars?.[name] ?? "";
</script>

<template>
    <div class="theme-editor-colors" data-section="colors">
        <section class="theme-editor-colors__seeds" :aria-label="text('themeEditor.colors.seeds')">
            <h3 class="theme-editor-colors__title">{{ text("themeEditor.colors.seeds") }}</h3>
            <ColorField
                v-for="seed in SEEDS"
                :key="seed"
                :name="SEED_KEYS[seed]"
                :label="seedLabel(seed)"
                :value="colors[SEED_KEYS[seed]] ?? ''"
                :check="checks.get(SEED_KEYS[seed]) ?? null"
                @change="failed = false; model.setSeed(seed, $event)"
            />
            <div class="theme-editor-colors__actions">
                <Button size="sm" data-derive @click="derive">{{ text("themeEditor.colors.derive") }}</Button>
                <Button size="sm" variant="secondary" data-derive-from-other @click="deriveFromOther">{{ text("themeEditor.colors.fromOther", {other: otherLabel}) }}</Button>
                <span class="theme-editor-colors__hint">{{ text("themeEditor.colors.deriveHint") }}</span>
            </div>
            <p v-if="failed" class="theme-editor-colors__error" role="alert" data-derive-failed>{{ text("themeEditor.colors.deriveFailed") }}</p>
        </section>

        <section v-for="group in GROUPS" :key="group.id" class="theme-editor-colors__group" :aria-label="text(`themeEditor.colors.group${group.id}` as 'themeEditor.colors.groupOther')">
            <h3 class="theme-editor-colors__title">{{ text(`themeEditor.colors.group${group.id}` as 'themeEditor.colors.groupOther') }}</h3>
            <ColorField
                v-for="name in group.keys"
                :key="name"
                :name="name"
                :value="colors[name] ?? ''"
                :check="checks.get(name) ?? null"
                :touched="model.isTouched(name)"
                :resettable="true"
                :plain="PLAIN.has(name)"
                @change="model.setColor(name, $event)"
                @reset="resetOne(name)"
            />
        </section>

        <Collapsible class="theme-editor-colors__advanced">
            <template #trigger>
                <Button size="sm" variant="ghost" icon-class="i-lucide-chevrons-up-down" data-advanced>{{ text("themeEditor.colors.advanced") }}</Button>
            </template>
            <p class="theme-editor-colors__hint">{{ text("themeEditor.colors.advancedHint") }}</p>
            <div v-for="name in THEME_ROLE_VARS" :key="name" class="theme-editor-colors__role" :data-role-var="name">
                <code class="theme-editor-colors__role-name">{{ name }}</code>
                <DraftInput size="sm" :value="roleValue(name)" :aria-label="name" allow-empty @change="model.setRoleVar(name, $event)" />
                <Button size="sm" variant="ghost" :disabled="roleValue(name) === ''" @click="model.setRoleVar(name, undefined)">{{ text("themeEditor.colors.clear") }}</Button>
            </div>
        </Collapsible>
    </div>
</template>

<style scoped>
.theme-editor-colors {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
}

.theme-editor-colors__seeds,
.theme-editor-colors__group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.theme-editor-colors__title {
    margin: 0 0 var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
}

.theme-editor-colors__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    margin-top: var(--space-2);
}

.theme-editor-colors__hint {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
}

.theme-editor-colors__error {
    margin: 0;
    color: var(--status-danger);
    font-size: var(--text-xs);
}

.theme-editor-colors__role {
    display: grid;
    grid-template-columns: minmax(150px, 190px) minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
    margin-top: var(--space-2);
}

.theme-editor-colors__role-name {
    color: var(--text-secondary);
    font-size: var(--text-xs);
}
</style>
