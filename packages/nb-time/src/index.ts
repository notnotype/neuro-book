/**
 * `@notnotype/nb-time`：故事时间（docs/specs/canon/time.md）。没有运行时依赖，前后端共用。
 */

export {compileCalendar, dateRange, GREGORIAN, MAX_ABS_YEAR, MAX_CYCLE_MONTHS, mod, timeParts, validateCalendar} from "./calendar";
export type {Approx, Calendar, CalendarEra, CalendarMonth, CalendarPeriod, CalendarProblem, CompiledCalendar, DateInvalid, DateParts, LeapRule, Precision, TimeUnit} from "./calendar";
export {DEFAULT_FUZZY, gapProblem, gapRange, resolveFuzzy, unitTooFine} from "./fuzzy";
export type {FuzzyProblem, FuzzyTable, Gap, GapSpec, GapUnit} from "./fuzzy";
export {lowerStatement, validateStatements} from "./statements";
export type {Basis, ConstraintTemplate, Edge, Endpoint, Lowered, Statement, StatementInvalid, StatementProblem} from "./statements";
export {assembleNetwork, MAX_CYCLES_PER_COMPONENT, solveNetwork} from "./network";
export type {AssembledNetwork, Between, Conflict, EndpointInvalid, EventRange, NetworkConstraint, NetworkEventInput, NodeRef, RangeBasis, TimeNetwork} from "./network";
