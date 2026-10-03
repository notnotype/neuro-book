<script setup lang="ts">
import Dialog from "nbook/app/components/common/Dialog.vue";
import NovelIdePassportProfilePanel from "nbook/app/components/novel-ide/profile/NovelIdePassportProfilePanel.vue";

defineProps<{
    modelValue: boolean;
}>();

const emit = defineEmits<{
    (event: "update:modelValue", value: boolean): void;
}>();

const {t} = useI18n();
</script>

<template>
    <!-- 官网账号与云备份独立于本地技术设置。 -->
    <Dialog
        :model-value="modelValue"
        :title="t('ide.profile.profileTitle')"
        size="xl"
        :show-footer="false"
        body-class="custom-scrollbar"
        @update:model-value="emit('update:modelValue', $event)"
    >
        <NovelIdePassportProfilePanel />
    </Dialog>
</template>
