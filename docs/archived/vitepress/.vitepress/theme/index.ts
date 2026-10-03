import type {Theme} from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import Mermaid from './Mermaid.vue'

/**
 * 文档站主题：默认主题 + 全局 Mermaid 组件。
 *
 * 之所以不引第三方 vitepress-plugin-mermaid：它的 peerDependencies 只声明 vitepress ^1，
 * 且会拖进 mermaid 9 时代的 @mermaid-js/mermaid-mindmap。mermaid 本体已经是本仓依赖，
 * 一个 fence 规则加一个组件就够了。
 */
export default {
    extends: DefaultTheme,
    enhanceApp({app}) {
        app.component('Mermaid', Mermaid)
    },
} satisfies Theme
