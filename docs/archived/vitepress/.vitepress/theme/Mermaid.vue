<script lang="ts">
/**
 * 渲染序号必须是模块级的：`<script setup>` 里的顶层变量每个组件实例各有一份，
 * 同一页两张图就都会拿到 id `docs-mermaid-0`，而 mermaid 用这个 id 生成 style
 * 选择器和箭头 marker，重号会让第二张图引用到第一张的定义。
 */
let renderSeq = 0
</script>

<script setup lang="ts">
/**
 * 文档站 Mermaid 图渲染组件。
 *
 * 由 config.ts 的 fence 规则把 ```mermaid 代码块替换成 <Mermaid code="..." />，
 * code 经过 encodeURIComponent 编码，避免图源里的引号、尖括号和换行破坏 HTML 属性。
 *
 * 约束：
 * - mermaid 需要真实 DOM，只能在 onMounted 之后惰性 import，SSR 阶段渲染占位。
 * - 明暗主题切换时必须重新 initialize 再重渲染，mermaid 的 theme 是全局配置。
 * - 语法错误收窄为「展示原始图源」，不让一张图炸掉整页。
 */
import {ref, onMounted, watch} from 'vue'
import {useData} from 'vitepress'

const props = defineProps<{
    /** encodeURIComponent 编码后的 mermaid 图源 */
    code: string
}>()

const {isDark} = useData()

/** 渲染成功时的 SVG 字符串；未渲染或失败时为空 */
const svg = ref('')
/** 渲染失败原因；成功时为空 */
const error = ref('')
/** 是否已挂载，用于避免 SSR 阶段访问 DOM */
const mounted = ref(false)

const source = decodeURIComponent(props.code)

async function render() {
    try {
        const mermaid = (await import('mermaid')).default
        mermaid.initialize({
            startOnLoad: false,
            theme: isDark.value ? 'dark' : 'neutral',
            flowchart: {curve: 'basis'},
            // 文档站图源全部来自仓库内 markdown，不接受用户输入，放宽以支持中文标签换行
            securityLevel: 'loose',
        })
        const result = await mermaid.render(`docs-mermaid-${renderSeq++}`, source)
        svg.value = result.svg
        error.value = ''
    } catch (cause) {
        svg.value = ''
        error.value = cause instanceof Error ? cause.message : String(cause)
    }
}

onMounted(async () => {
    mounted.value = true
    await render()
})

// 主题切换后重渲染，否则深色页面上会留着浅色底的图
watch(isDark, () => {
    if (mounted.value) render()
})
</script>

<template>
    <!-- mermaid 图容器：横向可滚动，避免宽流程图撑破正文栏 -->
    <div class="docs-mermaid">
        <div v-if="svg" v-html="svg" />
        <template v-else>
            <pre v-if="error" class="docs-mermaid-error">mermaid 渲染失败：{{ error }}

{{ source }}</pre>
            <pre v-else class="docs-mermaid-pending">{{ source }}</pre>
        </template>
    </div>
</template>

<style scoped>
.docs-mermaid {
    margin: 16px 0;
    padding: 12px;
    overflow-x: auto;
    border: 1px solid var(--vp-c-divider);
    border-radius: 8px;
    background: var(--vp-c-bg-soft);
    text-align: center;
}

.docs-mermaid :deep(svg) {
    max-width: 100%;
    height: auto;
}

.docs-mermaid-error,
.docs-mermaid-pending {
    margin: 0;
    text-align: left;
    font-size: 12px;
    white-space: pre-wrap;
    color: var(--vp-c-text-2);
}

.docs-mermaid-error {
    color: var(--vp-c-danger-1);
}
</style>
