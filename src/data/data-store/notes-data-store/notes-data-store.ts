import { MULTI_SCHEDULING_EXTRACTOR, SM2_SCHEDULE_INFO_EXTRACTOR } from "src/data/constants";
import { IDataStore, StorageType } from "src/data/data-store/base/data-store";
import { IFileModifier } from "src/data/data-store/base/file-modifier";
import { RepItemStorageInfo } from "src/data/data-store/base/rep-item-storage-info";
import { Question } from "src/data/data-structures/card/questions/question";
import { SRSettings } from "src/data/settings";
import { refreshReviewNote } from "src/note/refresh-review-note";
import { replaceQuestionSource } from "src/note/replace-question-source";
import { RepItemScheduleInfo } from "src/scheduling/algorithms/base/rep-item-schedule-info";
import { CommentParser } from "src/utils/comment-parser";

export class NotesDataStore implements IDataStore {
    public readonly storageType = StorageType.NOTES;
    private settings: SRSettings;
    public readonly fileModifier: IFileModifier;
    public isStructureInitialized: Promise<boolean>;

    constructor(settings: SRSettings, scheduleDeleter: IFileModifier) {
        this.settings = settings;
        this.fileModifier = scheduleDeleter;
        this.isStructureInitialized = Promise.resolve(true);
    }

    /**
     * Creates scheduling information from a question text and its storage info.
     *
     * @param originalQuestionText
     * @param _
     * @returns
     */
    createSchedule(originalQuestionText: string, _: RepItemStorageInfo): RepItemScheduleInfo[] {
        const schedulingComment = originalQuestionText.match(/<!--SR:(.+?)-->/m)?.[1];
        if (schedulingComment) {
            return CommentParser.parseMultiScheduleComment(schedulingComment) ?? [];
        }

        // Handle legacy scheduling comments for backward compatibility, but prefer the multi-scheduling format if both are presentwd
        const sm2MultiScheduling = [...originalQuestionText.matchAll(MULTI_SCHEDULING_EXTRACTOR)];
        if (sm2MultiScheduling.length > 0) {
            return sm2MultiScheduling
                .map((match) =>
                    CommentParser.parseSM2Schedule(
                        match[1],
                        parseInt(match[2]),
                        parseInt(match[3]),
                    ),
                )
                .filter((info): info is RepItemScheduleInfo => info !== null);
        }

        const result: RepItemScheduleInfo[] = [];
        const scheduling = [...originalQuestionText.matchAll(SM2_SCHEDULE_INFO_EXTRACTOR)];
        for (const match of scheduling) {
            const dueDateStr = match[1];
            const interval = parseInt(match[2]);
            const ease = parseInt(match[3]);
            const parsedSchedule = CommentParser.parseSM2Schedule(dueDateStr, interval, ease);
            if (parsedSchedule) {
                result.push(parsedSchedule);
            }
        }
        return result;
    }

    /**
     * Removes scheduling information from a question text.
     *
     * @param questionText
     * @returns
     */
    removeScheduleInfo(questionText: string): string {
        return questionText.replace(/<!--SR:.+-->/gm, "");
    }

    /**
     * Writes scheduling information to the data store.
     *
     * @param question
     * @returns
     */
    async writeSchedule(question: Question): Promise<void> {
        await this.write(question);
    }

    /** 原子保存已核实的卡片；源快照冲突时抛错，成功后同步队列内的源位置。 */
    async write(question: Question): Promise<void> {
        const previousQuestionText = question.questionText;
        const update = (fileText: string): string => {
            // 同步后到点击评分之间如果又发生保存，拒绝旧快照并让界面重新同步。
            if (question.note.sourceText !== undefined && question.note.sourceText !== fileText) {
                throw new Error("原文正在保存，请等待卡片同步后重试。");
            }
            return question.updateQuestionWithinNoteText(fileText, this.settings);
        };
        let saved: string;
        try {
            if (question.note.file.process) {
                saved = await question.note.file.process(update);
            } else {
                saved = update(await question.note.file.read());
                await question.note.file.write(saved);
            }
        } catch (error) {
            question.questionText = previousQuestionText;
            throw error;
        }
        if (question.note.sourceText !== undefined)
            refreshReviewNote(question.note, this.settings, saved);
        question.hasChanged = false;
    }

    /** 仅删除当前卡片的源范围；原文又被修改时拒绝删除，避免误删同文卡片。 */
    async delete(question: Question): Promise<void> {
        const update = (text: string): string => {
            if (question.note.sourceText !== undefined && question.note.sourceText !== text) {
                throw new Error("原文正在保存，请等待卡片同步后重试。");
            }
            return replaceQuestionSource(text, question.questionText.original, "", question.lineNo);
        };
        if (question.note.file.process) await question.note.file.process(update);
        else await question.note.file.write(update(await question.note.file.read()));
    }
}
