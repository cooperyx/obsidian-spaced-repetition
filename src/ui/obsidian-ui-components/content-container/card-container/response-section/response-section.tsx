import "src/ui/obsidian-ui-components/content-container/card-container/response-section/response-section.css";

import { SRSettings } from "src/data/settings";
import { t } from "src/lang/helpers";
import { RepItemScheduleInfo } from "src/scheduling/algorithms/base/rep-item-schedule-info";
import { ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";
import { formatScheduleInterval } from "src/scheduling/algorithms/schedule-display";
import { FlashcardReviewMode } from "src/scheduling/flashcard-review-sequencer";
import SRResponseButtonComponent from "src/ui/obsidian-ui-components/content-container/card-container/response-section/sr-response-button";

/** 直接展示全部日期档位；Again 的标签和行为仍来自上游调度。 */
export default class ResponseSectionComponent {
    public responseEl: HTMLDivElement;
    public againButton: SRResponseButtonComponent;
    public answerButton: SRResponseButtonComponent;
    private dayButtons: SRResponseButtonComponent[] = [];
    private completeButton: SRResponseButtonComponent;
    private settings: SRSettings;
    private manualReview: (days: number) => Promise<void>;

    constructor(
        container: HTMLElement,
        settings: SRSettings,
        showAnswer: () => void,
        processReview: (response: ReviewResponse) => Promise<void>,
        manualReview: (days: number) => Promise<void>,
    ) {
        this.settings = settings;
        this.manualReview = manualReview;
        this.responseEl = container.createDiv({ cls: "sr-response sr-manual-response" });
        this.answerButton = new SRResponseButtonComponent(this.responseEl, {
            classNames: ["sr-bg-blue", "sr-show-answer-button"],
            text: t("SHOW_ANSWER"),
            onClick: showAnswer,
        });
        this.againButton = new SRResponseButtonComponent(this.responseEl, {
            classNames: ["sr-bg-red", "sr-again-button", "sr-show-large-text", "sr-is-hidden"],
            text: "Again",
            onClick: () => processReview(ReviewResponse.Again),
        });
        // 临时练习不写入调度，保留上游 Cram 的完成语义。
        this.completeButton = new SRResponseButtonComponent(this.responseEl, {
            classNames: ["sr-bg-green", "sr-show-large-text", "sr-is-hidden"],
            text: "完成",
            onClick: () => processReview(ReviewResponse.Easy),
        });
    }

    /** 新卡先显示问题，必须显示答案后才能提交复习。 */
    public resetResponseButtons(): void {
        this.responseEl.removeClass("sr-is-hidden");
        this.answerButton.buttonEl.removeClass("sr-is-hidden");
        this.againButton.buttonEl.addClass("sr-is-hidden");
        this.completeButton.buttonEl.addClass("sr-is-hidden");
        this.dayButtons.forEach((button) => button.buttonEl.addClass("sr-is-hidden"));
    }

    /** 无有效卡片时隐藏评分区。 */
    public hideAllButtons(): void {
        this.responseEl.addClass("sr-is-hidden");
    }

    /** 同步或写入期间禁用按钮，阻止重复提交。 */
    public setDisabled(disabled: boolean): void {
        [this.answerButton, this.againButton, this.completeButton, ...this.dayButtons].forEach(
            (button) => button.setDisabled(disabled),
        );
    }

    /** 根据当前设置重建日期按钮，使重新进入卡片时即时反映配置。 */
    public showRatingButtons(
        reviewMode: FlashcardReviewMode,
        settings: SRSettings,
        determineButtonSchedule: (response: ReviewResponse) => RepItemScheduleInfo | null,
    ): void {
        this.settings = settings;
        this.responseEl.removeClass("sr-is-hidden");
        this.answerButton.buttonEl.addClass("sr-is-hidden");
        this.againButton.buttonEl.removeClass("sr-is-hidden");
        this.dayButtons.forEach((button) => button.buttonEl.remove());
        this.dayButtons = [];
        const cram = reviewMode === FlashcardReviewMode.Cram;
        this.completeButton.buttonEl.toggleClass("sr-is-hidden", !cram);
        const interval =
            !cram && settings.showIntervalInReviewButtons
                ? ` · ${formatScheduleInterval(determineButtonSchedule(ReviewResponse.Again), false)}`
                : "";
        this.againButton.setSmallText(`Again${interval}`);
        this.againButton.setLargeText(`Again${interval}`);
        if (cram) return;
        for (const days of this.settings.manualReviewDays) {
            this.dayButtons.push(
                new SRResponseButtonComponent(this.responseEl, {
                    classNames: ["sr-bg-blue", "sr-day-button", "sr-show-large-text"],
                    text: `${days}天`,
                    onClick: () => this.manualReview(days),
                }),
            );
        }
    }
}
