<script setup lang="ts">
import Dialog from "nbook/app/components/common/Dialog.vue";
import ProfileTemplateVisualEditor from "nbook/app/components/profile-template-editor/ProfileTemplateVisualEditor.vue";

const props = defineProps<{
    modelValue: boolean;
}>();

const emit = defineEmits<{
    (e: "update:modelValue", value: boolean): void;
}>();
</script>

<template>
    <Dialog
        :model-value="props.modelValue"
        size="full"
        overlay-type="opaque"
        :show-footer="false"
        :show-header="false"
        :close-on-overlay="false"
        body-class="!gap-0 !overflow-hidden !p-0"
        @update:model-value="emit('update:modelValue', $event)"
    >
        <ProfileTemplateVisualEditor
            mode="user-profile"
            preferred-template="builtin/leader.assets.profile.tsx"
            thread-profile-key="leader.assets"
            closable
            class="h-full"
            @close="emit('update:modelValue', false)"
        />
    </Dialog>
</template>
