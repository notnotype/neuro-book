<script setup lang="ts">
import {Button, Dialog, FormInput, FormSelect, FormTextarea, IconButton, type FormSelectOption} from "@notnotype/nb-ui/components";
import type {
    LowCodeFieldDto,
    LowCodeJsonValue,
    LowCodeResourceMutationDto,
    LowCodeResourcePresetOptionDto,
} from "nbook/shared/dto/low-code-form.dto";

type LowCodeResourcePresetScope = "global" | "project";

const props = withDefaults(defineProps<{
    field: LowCodeFieldDto;
    modelValue?: LowCodeJsonValue;
    scope?: LowCodeResourcePresetScope;
    disabled?: boolean;
    mutations?: LowCodeResourceMutationDto[];
}>(), {
    scope: "global",
    disabled: false,
    mutations: () => [],
});

const emit = defineEmits<{
    (e: "update:modelValue", value: LowCodeJsonValue): void;
    (e: "update:mutations", value: LowCodeResourceMutationDto[]): void;
}>();

const draftLabel = ref("");
const renameLabel = ref("");
const managerOpen = ref(false);
const resourceDialogOpen = ref(false);
const resourceDialogMode = ref<"create" | "rename">("create");
const deleteConfirmOpen = ref(false);
const deleteTargetKey = ref("");

const resource = computed(() => props.field.resource);
const rawSelectedKey = computed(() => typeof props.modelValue === "string" ? props.modelValue : "");
const visibleOptions = computed(() => {
    const options = new Map((resource.value?.options ?? []).map((option) => [option.key, option]));
    for (const mutation of props.mutations) {
        if (mutation.fieldPath !== props.field.path) continue;
        if (mutation.type === "create") {
            const key = resourceKeyFromSlug(mutation.slug);
            options.set(key, {
                key,
                label: mutation.label,
                origin: props.scope === "project" ? "project" : "global",
                editable: true,
                deletable: false,
            });
        }
        if (mutation.type === "rename") {
            const source = options.get(mutation.key);
            const key = resourceKeyFromSlug(mutation.slug);
            options.delete(mutation.key);
            options.set(key, {
                key,
                label: mutation.label,
                origin: source?.origin ?? (props.scope === "project" ? "project" : "global"),
                editable: source?.editable ?? true,
                deletable: source?.deletable ?? false,
            });
        }
        if (mutation.type === "remove") {
            options.delete(mutation.key);
        }
    }
    return [...options.values()];
});
const selectedKey = computed(() => normalizeSelectedKey(rawSelectedKey.value));
const selectedOption = computed(() => visibleOptions.value.find((option) => option.key === selectedKey.value) ?? null);
const selectedIsGlobalReadonly = computed(() => props.scope === "project" && selectedOption.value?.origin === "global");
const selectOptions = computed<FormSelectOption[]>(() => visibleOptions.value.map((option) => ({
    value: option.key,
    label: option.label,
    ...(option.description ? {description: option.description} : {}),
})));
const contentByKey = computed(() => {
    const result = new Map<string, string>();
    for (const content of resource.value?.contents ?? []) {
        result.set(content.key, content.content);
    }
    for (const mutation of props.mutations) {
        if (mutation.fieldPath !== props.field.path) continue;
        if (mutation.type === "create") {
            result.set(resourceKeyFromSlug(mutation.slug), mutation.content ?? resource.value?.template ?? "");
        }
        if (mutation.type === "rename") {
            const nextKey = resourceKeyFromSlug(mutation.slug);
            result.set(nextKey, result.get(mutation.key) ?? "");
            result.delete(mutation.key);
        }
        if (mutation.type === "update" && mutation.content !== undefined) {
            result.set(mutation.key, mutation.content);
        }
        if (mutation.type === "remove") {
            result.delete(mutation.key);
        }
    }
    return result;
});
const selectedContent = computed(() => {
    return selectedKey.value ? contentByKey.value.get(selectedKey.value) ?? "" : "";
});
const canEdit = computed(() => !props.disabled && Boolean(selectedOption.value?.editable) && Boolean(resource.value?.capabilities.update));
const canCreate = computed(() => !props.disabled && Boolean(resource.value?.capabilities.create));
const canRename = computed(() => !props.disabled && Boolean(selectedKey.value) && Boolean(selectedOption.value?.editable) && Boolean(resource.value?.capabilities.rename));
const canManage = computed(() => canCreate.value || canRename.value || Boolean(!props.disabled && resource.value?.capabilities.remove));
const canCopyGlobalToProject = computed(() => selectedIsGlobalReadonly.value && canCreate.value && Boolean(selectedOption.value));
const deleteTargetOption = computed(() => visibleOptions.value.find((option) => option.key === deleteTargetKey.value) ?? null);
const shouldShowDisabledEmpty = computed(() => props.disabled && visibleOptions.value.length === 0 && !selectedKey.value);
const resourceDialogTitle = computed(() => resourceDialogMode.value === "create" ? "新建资源" : "重命名资源");
const resourceDialogConfirmText = computed(() => resourceDialogMode.value === "create" ? "创建并选中" : "确认重命名");
const managerLabel = computed(() => props.scope === "project" ? "管理项目资源" : "管理全局资源");

function selectKey(key: string): void {
    if (props.disabled) return;
    emit("update:modelValue", key);
}

function updateContent(content: string): void {
    if (props.disabled || !selectedKey.value) return;
    upsertMutation({
        type: "update",
        fieldPath: props.field.path,
        key: selectedKey.value,
        content,
    });
}

function openCreateDialog(): void {
    if (!canCreate.value) return;
    draftLabel.value = "";
    resourceDialogMode.value = "create";
    resourceDialogOpen.value = true;
}

function openRenameDialog(): void {
    if (!canRename.value) return;
    renameLabel.value = selectedOption.value?.label ?? "";
    resourceDialogMode.value = "rename";
    resourceDialogOpen.value = true;
}

function confirmResourceDialog(): void {
    if (resourceDialogMode.value === "create") {
        createResource();
        return;
    }
    renameResource();
}

function createResource(): void {
    const label = draftLabel.value.trim();
    const currentResource = resource.value;
    if (!label || !canCreate.value || !currentResource) return;
    const slug = uniqueSlug(label);
    upsertMutation({
        type: "create",
        fieldPath: props.field.path,
        label,
        slug,
        content: currentResource.template ?? "",
    });
    emit("update:modelValue", resourceKeyFromSlug(slug));
    draftLabel.value = "";
    resourceDialogOpen.value = false;
    managerOpen.value = true;
}

function copyGlobalToProject(): void {
    const option = selectedOption.value;
    if (!canCopyGlobalToProject.value || !option) return;
    const slug = uniqueSlugFromBase(slugFromResourceKey(option.key) || slugify(option.label));
    upsertMutation({
        type: "create",
        fieldPath: props.field.path,
        label: option.label,
        slug,
        content: selectedContent.value,
    });
    emit("update:modelValue", resourceKeyFromSlug(slug));
    managerOpen.value = true;
}

function renameResource(): void {
    const label = renameLabel.value.trim();
    if (!label || !canRename.value) return;
    const slug = uniqueSlug(label);
    upsertMutation({
        type: "rename",
        fieldPath: props.field.path,
        key: selectedKey.value,
        label,
        slug,
    });
    emit("update:modelValue", resourceKeyFromSlug(slug));
    renameLabel.value = "";
    resourceDialogOpen.value = false;
}

function openDeleteDialog(key: string): void {
    if (!canRemoveOption(key)) return;
    deleteTargetKey.value = key;
    deleteConfirmOpen.value = true;
}

function removeResource(): void {
    if (!deleteTargetKey.value || !canRemoveOption(deleteTargetKey.value)) return;
    upsertMutation({
        type: "remove",
        fieldPath: props.field.path,
        key: deleteTargetKey.value,
    });
    deleteTargetKey.value = "";
    deleteConfirmOpen.value = false;
}

function canRemoveOption(key: string): boolean {
    if (props.disabled || !resource.value?.capabilities.remove || key === selectedKey.value) {
        return false;
    }
    return Boolean(visibleOptions.value.find((option) => option.key === key)?.deletable);
}

function upsertMutation(mutation: LowCodeResourceMutationDto): void {
    const others = props.mutations.filter((item) => {
        if (item.fieldPath !== props.field.path) return true;
        if (mutation.type === "create") return item.type !== "create" || item.slug !== mutation.slug;
        if ("key" in item && "key" in mutation) return item.key !== mutation.key || item.type !== mutation.type;
        return true;
    });
    emit("update:mutations", [...others, mutation]);
}

function slugify(label: string): string {
    return label
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/gu, "-")
        .replace(/^-+|-+$/gu, "")
        || "resource";
}

function uniqueSlug(label: string): string {
    return uniqueSlugFromBase(slugify(label));
}

function uniqueSlugFromBase(baseSlug: string): string {
    const usedKeys = new Set(visibleOptions.value.filter(isWritableOption).map((option) => option.key));
    if (!usedKeys.has(resourceKeyFromSlug(baseSlug))) {
        return baseSlug;
    }
    for (let index = 2; index < 1000; index += 1) {
        const slug = `${baseSlug}-${index}`;
        if (!usedKeys.has(resourceKeyFromSlug(slug))) {
            return slug;
        }
    }
    return `${baseSlug}-${Date.now().toString(36)}`;
}

function isWritableOption(option: LowCodeResourcePresetOptionDto): boolean {
    return props.scope === "global" || option.origin !== "global";
}

function slugFromResourceKey(key: string): string {
    const prefix = resource.value?.createKeyPrefix ?? "";
    const suffix = resource.value?.createKeySuffix ?? "";
    if (!key.startsWith(prefix) || !key.endsWith(suffix)) {
        return "";
    }
    return key.slice(prefix.length, key.length - suffix.length);
}

function resourceKeyFromSlug(slug: string): string {
    return `${resource.value?.createKeyPrefix ?? ""}${slug}${resource.value?.createKeySuffix ?? ""}`;
}

function normalizeSelectedKey(key: string): string {
    if (!key || visibleOptions.value.some((option) => option.key === key)) {
        return key;
    }
    if (key.includes("/") || !resource.value?.createKeyPrefix || !resource.value.createKeySuffix) {
        return key;
    }
    const candidate = resourceKeyFromSlug(key);
    return visibleOptions.value.some((option) => option.key === candidate) ? candidate : key;
}

</script>

<template>
    <div class="grid gap-2">
        <div v-if="!resource" class="rounded-[var(--radius-control)] border border-[var(--panel-outline)] bg-[var(--bg-subtle)] px-3 py-2 text-sm text-[var(--text-muted)]">
            Resource preset is unavailable.
        </div>
        <div v-else-if="shouldShowDisabledEmpty" class="rounded-[var(--radius-control)] border border-dashed border-[var(--panel-outline)] bg-[var(--bg-subtle)]/40 px-3 py-2 text-[11px] text-[var(--text-muted)]">
            没有可用资源。
        </div>
        <template v-else>
            <!-- 资源管理器 -->
            <div class="overflow-visible rounded-[var(--radius-control)] border border-[var(--panel-outline)] bg-[var(--bg-subtle)]/25">
                <div class="flex min-w-0 items-center gap-2 px-2 py-2">
                    <FormSelect class="min-w-0 flex-1" :class="props.disabled ? 'pointer-events-none opacity-60' : ''" :model-value="selectedKey" :options="selectOptions" placeholder="选择资源" @update:model-value="selectKey" />
                    <Button v-if="canManage || selectedKey" class="shrink-0" size="sm" variant="secondary" :icon-class="managerOpen ? 'i-lucide-chevron-up' : 'i-lucide-panel-bottom-open'" :disabled="!selectedKey && !canManage" :title="managerLabel" @click="managerOpen = !managerOpen">
                        <span :class="managerOpen ? 'i-lucide-chevron-up' : 'i-lucide-panel-bottom-open'" class="h-3.5 w-3.5"></span>
                        {{ managerOpen ? "收起" : "管理" }}
                    </button>
                </div>

                <div v-if="managerOpen" class="border-t border-[var(--panel-outline)]">
                    <div v-if="canManage" class="flex flex-wrap items-center gap-1.5 border-b border-[var(--panel-outline)] px-2 py-1.5">
                        <Button v-if="canCreate" size="sm" variant="secondary" icon-class="i-lucide-plus" title="新建资源" @click="openCreateDialog">
                            <span class="i-lucide-plus h-3.5 w-3.5"></span>
                            新建
                        </button>
                        <Button v-if="resource.capabilities.rename" size="sm" variant="secondary" icon-class="i-lucide-pencil" :disabled="!canRename" title="重命名当前资源" @click="openRenameDialog">
                            <span class="i-lucide-pencil h-3.5 w-3.5"></span>
                            重命名当前
                        </button>
                        <Button v-if="canCopyGlobalToProject" size="sm" variant="secondary" icon-class="i-lucide-copy-plus" title="复制全局资源到项目并选中" @click="copyGlobalToProject">
                            <span class="i-lucide-copy-plus h-3.5 w-3.5"></span>
                            复制到项目并选中
                        </button>
                    </div>

                    <div class="grid min-h-[166px] items-stretch gap-0 md:grid-cols-[minmax(11rem,0.34fr)_minmax(0,1fr)]">
                    <!-- 资源列表 -->
                    <div class="h-full overflow-y-auto border-b border-[var(--panel-outline)] p-1.5 md:border-b-0 md:border-r md:border-[var(--panel-outline)]">
                        <div
                            v-for="option in visibleOptions"
                            :key="option.key"
                            class="group flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-[var(--radius-control)] px-2 py-1 text-left transition-colors hover:bg-[var(--bg-hover)]"
                            :class="option.key === selectedKey ? 'bg-[var(--bg-panel)] text-[var(--text-main)] shadow-sm' : 'text-[var(--text-secondary)]'"
                            @click="selectKey(option.key)"
                        >
                            <span class="h-1.5 w-1.5 shrink-0 rounded-full" :class="option.key === selectedKey ? 'bg-[var(--accent-main)]' : 'bg-[var(--text-muted)]/45'"></span>
                            <span class="min-w-0 flex-1">
                                <span class="block truncate text-xs">{{ option.label }}</span>
                                <span v-if="option.description" class="mt-0.5 block truncate text-[10px] text-[var(--text-muted)]">{{ option.description }}</span>
                            </span>
                            <span v-if="option.origin" class="rounded px-1.5 py-0.5 text-[10px]" :class="option.origin === 'global' ? 'bg-[var(--bg-subtle)] text-[var(--text-muted)]' : 'bg-[var(--accent-bg)] text-[var(--accent-text)]'">
                                {{ option.origin === "global" ? "全局" : "项目" }}
                            </span>
                            <span v-if="option.key === selectedKey" class="rounded bg-[var(--accent-bg)] px-1.5 py-0.5 text-[10px] text-[var(--accent-text)]">当前</span>
                            <IconButton
                                v-if="resource.capabilities.remove"
                                class="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                                size="sm"
                                variant="danger"
                                icon-class="i-lucide-trash-2"
                                :disabled="!canRemoveOption(option.key)"
                                title="删除资源"
                                @click.stop="openDeleteDialog(option.key)"
                            />
                        </div>
                    </div>

                    <!-- 当前资源编辑区 -->
                    <div class="min-w-0">
                        <div v-if="!selectedKey" class="px-2.5 py-2 text-[11px] text-[var(--text-muted)]">
                            请选择一个资源。
                        </div>
                        <div v-if="selectedKey" class="flex h-full flex-col gap-2 p-2">
                            <div v-if="selectedIsGlobalReadonly" class="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-[var(--panel-outline)] bg-[var(--bg-subtle)]/50 px-2.5 py-2 text-[11px] text-[var(--text-secondary)]">
                                <span class="min-w-0">这个资源来自全局库，在项目配置中只读。</span>
                                <Button v-if="canCopyGlobalToProject" class="shrink-0" size="sm" variant="secondary" icon-class="i-lucide-copy-plus" @click="copyGlobalToProject">
                                    <span class="i-lucide-copy-plus h-3.5 w-3.5"></span>
                                    复制到项目
                                </button>
                            </div>
                            <FormTextarea
                                class="min-h-[150px] w-full flex-1 font-mono text-xs leading-relaxed"
                                :model-value="selectedContent"
                                :rows="8"
                                :disabled="!canEdit"
                                spellcheck="false"
                                @update:model-value="updateContent"
                            />
                        </div>
                    </div>
                    </div>
                </div>
            </div>

            <Dialog v-model="resourceDialogOpen" :title="resourceDialogTitle" width="420px" :show-cancel="false">
                <label class="grid gap-1.5">
                    <span class="text-xs font-medium text-[var(--text-secondary)]">资源名称</span>
                    <FormInput v-if="resourceDialogMode === 'create'" v-model="draftLabel" placeholder="输入新资源名称" />
                    <FormInput v-else v-model="renameLabel" placeholder="输入新的资源名称" />
                </label>
                <template #footer="{ cancel }">
                    <Button class="flex-1" variant="secondary" @click="cancel">取消</Button>
                    <Button
                        class="flex-1"
                        :disabled="resourceDialogMode === 'create' ? !draftLabel.trim() : !renameLabel.trim()"
                        @click="confirmResourceDialog"
                    >
                        {{ resourceDialogConfirmText }}
                    </Button>
                </template>
            </Dialog>

            <Dialog v-model="deleteConfirmOpen" title="删除资源" width="420px" :show-cancel="false">
                <div class="space-y-2">
                    <p class="text-sm text-[var(--text-main)]">确定删除这个资源吗？</p>
                    <p class="rounded-[var(--radius-control)] border border-[var(--panel-outline)] bg-[var(--bg-subtle)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                        {{ deleteTargetOption?.label ?? deleteTargetKey }}
                    </p>
                </div>
                <template #footer="{ cancel }">
                    <Button class="flex-1" variant="secondary" @click="cancel">取消</Button>
                    <Button class="flex-1" variant="danger" @click="removeResource">确认删除</Button>
                </template>
            </Dialog>
        </template>
    </div>
</template>
