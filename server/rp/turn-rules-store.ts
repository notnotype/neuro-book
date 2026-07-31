import {
    settleRpMechanicsTurn,
    validateRpMechanicsSettlement,
    type RpMechanicsSettlement,
} from "nbook/server/rp/mechanics-store";
import {
    settleRpRelationsTurn,
    validateRpRelationSettlements,
    type RpRelationSettlement,
} from "nbook/server/rp/relation-store";
import {
    settleRpCognitionTurn,
    validateRpCognitionSettlements,
    type RpCognitionSettlement,
} from "nbook/server/rp/cognition-store";

export type RpTurnRulesSettlement = {
    mechanics: RpMechanicsSettlement;
    relations: RpRelationSettlement[];
    cognition: RpCognitionSettlement[];
};

/**
 * P4 跨领域回合收口：先完整预检，再按幂等 turnId 写时间资源、关系和认知。
 * 任一步文件 I/O 中断后可安全重试；已完成领域不会重复叠加。
 */
export async function settleRpTurnRules(projectRoot: string, turnId: string, input: RpTurnRulesSettlement): Promise<void> {
    await validateRpMechanicsSettlement(projectRoot, input.mechanics);
    validateRpRelationSettlements(input.relations);
    await validateRpCognitionSettlements(projectRoot, input.cognition);
    await settleRpMechanicsTurn(projectRoot, turnId, input.mechanics);
    await settleRpRelationsTurn(projectRoot, turnId, input.relations);
    await settleRpCognitionTurn(projectRoot, turnId, input.cognition);
}
