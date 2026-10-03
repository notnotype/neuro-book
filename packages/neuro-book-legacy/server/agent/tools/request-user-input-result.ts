import type {UserInputAnswer} from "nbook/server/agent/tools/types";

export type RequestUserInputOption = {
    label: string;
    description?: string;
};

export type RequestUserInputQuestion = {
    question: string;
    header?: string;
    options?: RequestUserInputOption[];
};

export type RequestUserInputParams = {
    questions: RequestUserInputQuestion[];
};

/**
 * 把 request_user_input 的原始用户答案转成人类可读答案。
 */
export function buildRequestUserInputResult(params: RequestUserInputParams, userInput: unknown): {
    answers: UserInputAnswer[];
    text: string;
} {
    if (Array.isArray(userInput)) {
        const answers = userInput.flatMap((answer, index): UserInputAnswer[] => {
            if (!isRecord(answer)) {
                return [];
            }
            const questionIndex = typeof answer.questionIndex === "number" && Number.isInteger(answer.questionIndex)
                ? answer.questionIndex
                : index;
            const question = params.questions[questionIndex];
            const selectedOptionIndex = typeof answer.selectedOptionIndex === "number" && Number.isInteger(answer.selectedOptionIndex)
                ? answer.selectedOptionIndex
                : undefined;
            const note = typeof answer.note === "string" ? answer.note.trim() : "";
            const text = typeof answer.text === "string" && answer.text
                ? answer.text
                : selectedOptionIndex !== undefined && question
                    ? optionLabel(question, selectedOptionIndex)
                    : note;

            return [{
                questionIndex,
                text,
                ...(selectedOptionIndex !== undefined ? {selectedOptionIndex} : {}),
                ...(note ? {note} : {}),
                ...(typeof answer.ignored === "boolean" ? {ignored: answer.ignored} : {}),
            }];
        });
        return {
            answers,
            text: formatRequestUserInputAnswers(params, answers),
        };
    }

    const formData = isRecord(userInput) ? userInput : {};
    const answers = params.questions.map((question, index): UserInputAnswer => {
        const answerPath = `answer_${index}`;
        const value = Object.prototype.hasOwnProperty.call(formData, answerPath)
            ? formData[answerPath]
            : undefined;

        if (question.options?.length) {
            const selectedOptionIndex = normalizeSelectedIndex(value);
            return {
                questionIndex: index,
                text: selectedOptionIndex === undefined ? "" : optionLabel(question, selectedOptionIndex),
                ...(selectedOptionIndex === undefined ? {} : {selectedOptionIndex}),
            };
        }

        return {
            questionIndex: index,
            text: value === undefined || value === null ? "" : String(value),
        };
    });

    return {
        answers,
        text: formatRequestUserInputAnswers(params, answers),
    };
}

/**
 * 格式化 request_user_input 答案，供模型继续执行时阅读。
 */
export function formatRequestUserInputAnswers(params: RequestUserInputParams | undefined, answers: UserInputAnswer[]): string {
    return [...answers]
        .sort((left, right) => left.questionIndex - right.questionIndex)
        .map((answer, index) => {
            const questionIndex = answer.questionIndex ?? index;
            const question = params?.questions[questionIndex]?.question ?? `问题 ${questionIndex + 1}`;
            const answerText = answer.text || answer.note || "";
            return `${questionIndex + 1}. ${question}\n回答：${answerText}`;
        })
        .join("\n\n");
}

/**
 * 从未知参数里读取 request_user_input schema 需要的最小结构。
 */
export function parseRequestUserInputParams(value: unknown): RequestUserInputParams | undefined {
    if (!isRecord(value) || !Array.isArray(value.questions)) {
        return undefined;
    }
    const questions = value.questions.flatMap((question): RequestUserInputQuestion[] => {
        if (!isRecord(question) || typeof question.question !== "string") {
            return [];
        }
        const options = Array.isArray(question.options)
            ? question.options.flatMap((option): RequestUserInputOption[] => {
                return isRecord(option) && typeof option.label === "string"
                    ? [{
                        label: option.label,
                        ...(typeof option.description === "string" ? {description: option.description} : {}),
                    }]
                    : [];
            })
            : undefined;
        return [{
            question: question.question,
            ...(typeof question.header === "string" ? {header: question.header} : {}),
            ...(options ? {options} : {}),
        }];
    });
    return questions.length ? {questions} : undefined;
}

function normalizeSelectedIndex(value: unknown): number | undefined {
    if (typeof value !== "number" || !Number.isInteger(value)) {
        return undefined;
    }
    return value;
}

function optionLabel(question: RequestUserInputQuestion, optionIndex: number): string {
    if (optionIndex === -1) {
        return "其他答案";
    }
    return question.options?.[optionIndex]?.label ?? String(optionIndex);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
