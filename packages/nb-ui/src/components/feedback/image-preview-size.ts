/**
 * `ImagePreviewDialog` 里图片的显示尺寸（同名 .md 的“布局与交互”）：原尺寸；长边不到 `minSize` 的放大到它；超出可用空间时
 * 等比缩小。放大与缩小冲突时缩小优先：放不下就不放大。结果至少 1 像素、取整到像素。
 */

export interface Size {
    readonly width: number;
    readonly height: number;
}

export function previewImageSize(natural: Size, available: Size, minSize: number): Size {
    const enlarge = Math.max(1, minSize / Math.max(natural.width, natural.height));
    const scale = Math.min(enlarge, available.width / natural.width, available.height / natural.height);
    return {width: Math.max(1, Math.floor(natural.width * scale)), height: Math.max(1, Math.floor(natural.height * scale))};
}
