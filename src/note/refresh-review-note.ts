import { DataStore } from "src/data/data-store/base/data-store";
import { RepItemStorageInfo } from "src/data/data-store/base/rep-item-storage-info";
import { QuestionText } from "src/data/data-structures/card/questions/question";
import { CardFrontBackUtil } from "src/data/data-structures/card/questions/question-type";
import { SRSettings } from "src/data/settings";
import { Note } from "src/note/note";
import { findUpdatedReviewQuestion } from "src/note/review-source-tracker";
import { parse } from "src/parser";
import { splitNoteIntoFrontmatterAndContent } from "src/utils/strings";

/**
 * 用保存后的文本刷新队列中已有的对象，不重建队列、不写文件、不提交复习。
 * 对象引用保持不变，因此正反向卡片、当前进度以及已经显示答案的状态可以保留。
 */
export function refreshReviewNote(note: Note, settings: SRSettings, source: string): boolean {
    if (note.sourceText === source) return false;
    const previous = note.sourceText;
    const [, content] = splitNoteIntoFrontmatterAndContent(source);
    const parsed = parse(content, settings);
    for (const question of note.questionList) {
        if (question.reviewSourceInvalid) continue;
        const updated =
            previous === undefined
                ? null
                : findUpdatedReviewQuestion(previous, question.parsedQuestionInfo, source, parsed);
        if (!updated) {
            question.reviewSourceInvalid = true;
            continue;
        }
        const text = QuestionText.create(
            updated.text,
            question.questionText.textDirection,
            settings,
        );
        const cards = CardFrontBackUtil.expand(updated.cardType, text.actualQuestion, settings);
        // 增删挖空或改变正反向结构会改变 cardIdx 的含义，此时不猜测当前子卡片。
        if (cards.length !== question.cards.length || cards.length === 0) {
            question.reviewSourceInvalid = true;
            continue;
        }
        const schedules = DataStore.getInstance().createSchedule(
            updated.text,
            new RepItemStorageInfo(note.filePath, text.textHash),
        );
        question.parsedQuestionInfo = updated;
        question.questionText = text;
        question.questionContext = note.file.getQuestionContext(updated.firstLineNum);
        question.hasChanged = false;
        question.cards.forEach((card, index) => {
            card.front = cards[index].front;
            card.back = cards[index].back;
            card.scheduleInfo = schedules[index] ?? null;
        });
    }
    note.sourceText = source;
    return true;
}
