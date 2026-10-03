import {
    isExpressionValue,
} from "nbook/app/components/profile-template-editor/profile-template-tree-utils";
import type {
    ProfileTemplateIssueDto,
    ProfileTemplatePropValue,
} from "nbook/shared/dto/profile-template.dto";
import {resolveApiErrorMessage} from "nbook/app/utils/api-error";

/**
 * 表单里显示属性值时使用的字符串。
 */
export function propInputValue(value: ProfileTemplatePropValue): string {
    if (isExpressionValue(value)) {
        return value.code;
    }
    if (value === null) {
        return "";
    }
    return String(value);
}

/**
 * 表单里的属性标签。
 */
export function propLabel(key: string): string {
    const labels: Record<string, string> = {
        id: "ID",
        name: "名称",
        status: "状态",
        role: "角色",
        source: "source",
        repeatEveryTurns: "repeatEveryTurns",
        watchPath: "watchPath",
        watchValue: "watchValue",
        when: "when",
        path: "path",
        render: "render",
        previewText: "预览文本",
        condition: "condition",
        text: "text",
    };
    return labels[key] ?? key;
}

/**
 * 返回模板问题的详细定位说明。
 */
export function issueDetail(issue: ProfileTemplateIssueDto): string {
    return [
        issue.path ? `位置：${issue.path}` : "",
        issue.nodeId ? `节点：${issue.nodeId}` : "",
        issue.sourceText ? `源码：${issue.sourceText}` : "",
        issue.sourceRange ? `源码范围：${issue.sourceRange.start}-${issue.sourceRange.end}` : "",
    ].filter(Boolean).join(" · ");
}

/**
 * 提取 $fetch / 服务端异常中对用户有意义的错误文本。
 */
export function describeFetchError(error: unknown): string {
    return resolveApiErrorMessage(error, "未知错误");
}
