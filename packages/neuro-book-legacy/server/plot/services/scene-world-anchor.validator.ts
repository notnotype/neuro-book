import type {SceneWorldAnchor} from "nbook/server/plot/core/types";
import {throwPlotBadRequest} from "nbook/server/plot/core/errors";

/**
 * 校验 Scene 与 World Engine 的桥接锚点。
 */
export class SceneWorldAnchorValidator {
    /**
     * 校验时间范围、subject 去重和地点字段形状。
     */
    validate(anchor: SceneWorldAnchor): void {
        if (anchor.startInstant !== null && anchor.endInstant !== null && anchor.startInstant > anchor.endInstant) {
            throwPlotBadRequest("Scene World Anchor 的 startInstant 不能晚于 endInstant");
        }

        const seenSubjectIds = new Set<string>();
        for (const subjectId of anchor.subjectIds) {
            const normalized = subjectId.trim();
            if (!normalized) {
                throwPlotBadRequest("Scene World Anchor 的 subjectIds 不能包含空字符串");
            }
            if (seenSubjectIds.has(normalized)) {
                throwPlotBadRequest(`Scene World Anchor 的 subjectIds 存在重复项：${normalized}`);
            }
            seenSubjectIds.add(normalized);
        }

        if (anchor.locationSubjectId !== null && !anchor.locationSubjectId.trim()) {
            throwPlotBadRequest("Scene World Anchor 的 locationSubjectId 不能为空字符串");
        }
    }
}
