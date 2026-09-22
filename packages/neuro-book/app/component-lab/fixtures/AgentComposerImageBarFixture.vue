<script setup lang="ts">
import AgentComposerImageBar from "../../components/novel-ide/agent/composer/AgentComposerImageBar.vue";
import {useLabEventSink} from "../lab-event-sink";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const emitLabEvent = useLabEventSink();

const images = computed(() => {
    switch (props.scene) {
        case "unsupported-model":
            return [{target: "img-1", label: "character-sheet.png"}];
        case "metadata-error":
            return [{target: "img-2", label: "map-overview.jpg"}];
        default:
            return [
                {target: "img-1", label: "character-sheet.png"},
                {target: "img-2", label: "world-map.png"},
            ];
    }
});

const modelSupportsImages = computed(() => props.scene !== "unsupported-model");
const metadataError = computed(() => props.scene === "metadata-error" ? "图片元数据损坏，无法确定尺寸" : null);
const readonly = computed(() => props.scene === "readonly");

const getImageUrl = (target: string): string | null => {
    return target ? "https://via.placeholder.com/120x80" : null;
};
</script>

<template>
    <div class="w-full p-4">
        <AgentComposerImageBar
            data-lab-subject
            class="w-full"
            :images="images"
            :model-supports-images="modelSupportsImages"
            :metadata-error="metadataError"
            :readonly="readonly"
            :get-image-url="getImageUrl"
            @remove-image="emitLabEvent('remove-image', $event)"
            @retry-metadata="emitLabEvent('retry-metadata')"
        />
    </div>
</template>
