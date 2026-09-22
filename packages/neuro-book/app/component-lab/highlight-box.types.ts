/**
 * HighlightBox 的对外类型。`<script setup>` 不允许 export，因此单独成文件。
 */

export type HighlightRect = {
    /** 视口坐标，单位像素。直接用 getBoundingClientRect() 的四个值。 */
    top: number;
    left: number;
    width: number;
    height: number;
};

export type HighlightTone = "subject" | "probe";
