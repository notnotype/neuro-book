/** nb-ui 自带的英文目录（命名空间 `nb-ui`），键与 `zh-CN.ts` 相同。 */

import type {Catalog} from "../text";

export default {
    alertDialog: {
        title: "Confirm action",
        confirm: "OK",
        cancel: "Cancel",
    },
    banner: {
        close: "Close",
    },
    breadcrumb: {
        label: "Breadcrumb",
    },
    codeBlock: {
        empty: "No content",
        truncated: "Only part of the content is shown",
    },
    copyButton: {
        copy: "Copy",
        copied: "Copied",
        failed: "Copy failed; select manually",
    },
    detailDialog: {
        copy: "Copy output",
        close: "Close",
        truncated: "Output too long; truncated",
    },
    diffView: {
        mode: "Display",
        inline: "Inline",
        split: "Split",
        unchanged: "No changes",
        foldedLines: "Show {{count}} unchanged lines",
        foldedChars: "… ({{count}} chars) …",
    },
    colorPicker: {
        value: "Color value",
        presets: "Preset colors",
    },
    colorSwatches: {
        label: "Color",
    },
    dateInput: {
        open: "Choose date",
        previousMonth: "Previous month",
        nextMonth: "Next month",
    },
    dialog: {
        untitled: "Dialog",
        cancel: "Cancel",
        confirm: "Confirm",
        close: "Close",
    },
    drawer: {
        untitled: "Panel",
        close: "Close",
    },
    emptyState: {
        title: "No data",
    },
    floatingWindow: {
        resizeWidth: "Resize window width",
        resizeHeight: "Resize window height",
        resize: "Resize window",
    },
    imagePreviewDialog: {
        close: "Close",
        downloadOriginal: "Download Original",
        loading: "Loading the original image",
        loadFailed: "Original image failed to load",
        retry: "Retry",
    },
    infoTip: {
        label: "Info",
    },
    input: {
        clear: "Clear input",
    },
    notification: {
        close: "Dismiss notification",
        inProgress: "In progress",
        detail: "Details",
        detailTitle: "{{title}}: details",
        region: "Notifications",
        folded: "Show {{count}} earlier",
        collapse: "Show less",
    },
    numberInput: {
        increase: "Increase",
        decrease: "Decrease",
    },
    searchSelect: {
        empty: "No matching options",
    },
    slider: {
        thumb: "Slider {{index}}",
    },
    spinner: {
        loading: "Loading",
    },
    splitter: {
        resizeWidth: "Resize width between {{before}} and {{after}}",
        resizeHeight: "Resize height between {{before}} and {{after}}",
        collapsed: "Collapsed",
        pixels: "{{size}} pixels",
    },
    table: {
        empty: "No data",
    },
    tabs: {
        more: "More",
    },
    tagInput: {
        remove: "Remove {{item}}",
    },
    toolbar: {
        label: "Toolbar",
    },
} satisfies Catalog;
