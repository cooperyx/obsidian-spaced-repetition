import { now } from "moment";
import { App, EventRef, MarkdownView, Notice } from "obsidian";

import { DataManager } from "src/data/data-manager";
import { Card } from "src/data/data-structures/card/card";
import { Question } from "src/data/data-structures/card/questions/question";
import { Deck } from "src/data/data-structures/deck/deck";
import { SRSettings } from "src/data/settings";
import { t } from "src/lang/helpers";
import SRPlugin from "src/main";
import { Note } from "src/note/note";
import { refreshReviewNote } from "src/note/refresh-review-note";
import { RepItemScheduleInfo } from "src/scheduling/algorithms/base/rep-item-schedule-info";
import { ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";
import {
    DeckStats,
    FlashcardReviewMode,
    IFlashcardReviewSequencer,
} from "src/scheduling/flashcard-review-sequencer";
import { CardContainer } from "src/ui/obsidian-ui-components/content-container/card-container/card-container";
import CardInfoNotice from "src/ui/obsidian-ui-components/content-container/card-container/toolbar/toolbar-buttons/card-info-notice";
import { DeckContainer } from "src/ui/obsidian-ui-components/content-container/deck-container/deck-container";
import { ConfirmationModal } from "src/ui/obsidian-ui-components/modals/confirmation-modal";
import { ReviewQueueLoader } from "src/ui/review-queue-loader";
import { UIManager, UIState } from "src/ui/ui-manager";

export enum ContentState {
    Deck,
    CardFront,
    CardBack,
    Closed,
}

export enum CardState {
    Front,
    Back,
    Closed,
}

export interface CardData {
    currentCard: Card | null;
    currentCardState: CardState;
}

export interface DeckData {
    chosenDeck: Deck;
    currentDeck: Deck | null;
    previousDeck: Deck | null;
    currentDeckTotalCardsInQueue: number;
    currentDeckStats: DeckStats | null;
    previousDeckStats: DeckStats | null;
    chosenDeckStats: DeckStats;
}

export interface SessionData {
    cardData: CardData;
    deckData: DeckData;

    totalDecksInSession: number;
    totalCardsInSession: number;

    currentQuestion: Question;
    currentNote: Note;
}

// TODO: Refactor/integrate this code with the backend

/**
 * Manages the content of the deck and flashcard views, by determining their behavior.
 *
 * @method open - Opens the content manager, loading the review queue and initializing the deck and flashcard views.
 * @method close - Closes the content manager, shutting down the deck and flashcard views.
 */
export default class ContentManager {
    private app: App;
    private plugin: SRPlugin;
    private uiManager: UIManager;
    private dataManager: DataManager;
    private reviewSequencer: IFlashcardReviewSequencer | null = null;
    private settings: SRSettings;
    private reviewMode: FlashcardReviewMode;
    private deckContainer: DeckContainer;
    private cardContainer: CardContainer;

    private reviewQueueLoader: ReviewQueueLoader;
    private sessionData: SessionData | null = null;

    private lastPressedOnProcessReview: number = 0;
    private pendingResumeTimeout: number | null = null;
    private sourceEvents: EventRef[] = [];
    private workspaceEvents: EventRef[] = [];
    private busy = false;
    private refreshQueued = false;
    private isOpen = false;

    constructor(
        app: App,
        plugin: SRPlugin,
        reviewQueueLoader: ReviewQueueLoader,
        settings: SRSettings,
        parentEl: HTMLElement,
        closeModal?: () => void,
    ) {
        this.app = app;
        this.plugin = plugin;
        this.reviewQueueLoader = reviewQueueLoader;
        this.settings = settings;
        this.reviewMode = reviewQueueLoader.getReviewMode();

        this.uiManager = this.plugin.uiManager;
        this.dataManager = this.plugin.dataManager;

        this.deckContainer = new DeckContainer(
            parentEl,
            this._changeReviewMode.bind(this),
            this._startReviewOfDeck.bind(this),
            closeModal,
        );

        this.cardContainer = new CardContainer(
            this.app,
            this.plugin,
            this.settings,
            parentEl,
            this._deleteCurrentCard.bind(this),
            this._showDecksList.bind(this),
            this._doEditQuestionText.bind(this),
            this._processReview.bind(this),
            this._skipCurrentCard.bind(this),
            this._showAnswer.bind(this),
            this._jumpToCurrentCard.bind(this),
            this._displayCurrentCardInfoNotice.bind(this),
            this._processManualReview.bind(this),
            closeModal,
        );
    }

    /** 关闭会话并移除原文监听，阻止尚未完成的异步操作重新显示窗口。 */
    public close() {
        this.isOpen = false;
        this.sourceEvents.forEach((event) => this.app.vault.offref(event));
        this.workspaceEvents.forEach((event) => this.app.workspace.offref(event));
        this.sourceEvents = [];
        this.workspaceEvents = [];
        this._clearPendingResumeTimeout();
        this.uiManager.setSRViewInFocus(false);
        this.deckContainer.closeList();
        this.cardContainer.closeSession();
        this.uiManager.setUIState(UIState.Closed);
    }

    /** 加载复习队列，并只在当前会话存活期间监听原文保存与编辑。 */
    public async open() {
        this.isOpen = true;
        const onFileChange = (file: { path: string }) => {
            if (file.path === this.reviewSequencer?.currentNote?.filePath)
                this.queueSourceRefresh();
        };
        this.sourceEvents = [
            this.app.vault.on("modify", onFileChange),
            this.app.vault.on("delete", onFileChange),
            this.app.vault.on("rename", () => this.queueSourceRefresh()),
        ];
        this.workspaceEvents = [
            this.app.workspace.on("editor-change", () => this.queueSourceRefresh()),
        ];
        // Prepare a review queue to display
        this.reviewSequencer = await this.reviewQueueLoader.loadReviewQueue();
        if (!this.isOpen) return;

        // Determine if the card view should be opened immediately
        const subdecksWithCardsInQueue: Deck[] = this.reviewSequencer.getSubDecksWithCardsInQueue(
            this.reviewSequencer.originalDeckTree,
        );

        let openImmediately: boolean = false;
        let deckWithCards: Deck | null = null;

        // Loop through all decks and determine if any have cards in queue
        for (const subdeck of subdecksWithCardsInQueue) {
            const subdeckStats = this.reviewSequencer.getDeckStats(subdeck.getTopicPath());

            if (
                openImmediately &&
                (subdeckStats.cardsInQueueOfThisDeckCount ||
                    this.reviewMode === FlashcardReviewMode.Cram)
            ) {
                openImmediately = false;
                break;
            }

            if (
                subdeckStats.cardsInQueueOfThisDeckCount ||
                this.reviewMode === FlashcardReviewMode.Cram
            ) {
                openImmediately = true;
                deckWithCards = subdeck;
            }
        }

        if (openImmediately && deckWithCards !== null) {
            await this._reviewDeck(deckWithCards);
        } else {
            await this._showDecksList();
        }
    }

    // MARK: Content Manager

    private async _showDecksList(reloadReviewQueue: boolean = false): Promise<void> {
        if (!this.isOpen) return;
        this._clearPendingResumeTimeout();
        if (reloadReviewQueue) {
            this.reviewSequencer = await this.reviewQueueLoader.loadReviewQueue();
        }
        if (this.reviewSequencer === null) return;
        this.cardContainer.closeSession();
        this.uiManager.setUIState(UIState.DeckList);
        this.deckContainer.showList(this.reviewSequencer, this.settings, this.reviewMode);
    }

    private async _reviewDeck(deck: Deck): Promise<void> {
        this.deckContainer.closeList();
        this.sessionData = this._getNewSessionData(deck);
        if (this.sessionData === null) return;
        this.uiManager.setUIState(UIState.CardFront);
        await this.cardContainer.openSession(this.sessionData, this.settings);
        await this.syncCurrentSource();
    }

    private async _showNextCard(): Promise<void> {
        if (this.sessionData === null || this.reviewSequencer === null) {
            await this._showDecksList(true);
            return;
        }

        if (!this.reviewSequencer.hasCurrentCard) {
            // TODO: Re-enable pending state, once it is more integrated with the rest of the ui & once data refreshing is better implemented
            // if (this.reviewSequencer.hasPendingCards) {
            //     await this._showPendingState();
            // } else {
            //     await this._showDecksList(true);
            // }
            await this._showDecksList(true);
            return;
        }

        if (this.reviewSequencer.currentDeck === null) {
            await this._showDecksList(true);
            return;
        }

        const chosenDeckStats = this.reviewSequencer.getDeckStats(
            this.sessionData.deckData.chosenDeck.getTopicPath(),
        );
        this.sessionData.deckData.chosenDeckStats = chosenDeckStats;

        this.sessionData.deckData.previousDeck = this.sessionData.deckData.currentDeck;
        this.sessionData.deckData.previousDeckStats = this.sessionData.deckData.currentDeckStats;

        this.sessionData.deckData.currentDeck = this.reviewSequencer.currentDeck;

        const currentDeckStats = this.reviewSequencer.getDeckStats(
            this.reviewSequencer.currentDeck.getTopicPath(),
        );
        this.sessionData.deckData.currentDeckStats = currentDeckStats;

        if (this.sessionData.deckData.previousDeck !== this.sessionData.deckData.currentDeck) {
            this.sessionData.deckData.currentDeckTotalCardsInQueue =
                currentDeckStats.cardsInQueueOfThisDeckCount;
        }

        this.sessionData.currentNote = this.reviewSequencer.currentNote;
        this.sessionData.currentQuestion = this.reviewSequencer.currentQuestion;

        this.sessionData.cardData.currentCard = this.reviewSequencer.currentCard;
        this.uiManager.setUIState(UIState.CardFront);
        this.sessionData.cardData.currentCardState = CardState.Front;

        if (
            this.sessionData.cardData.currentCard !== null &&
            this.sessionData.cardData.currentCard !== undefined
        ) {
            await this.cardContainer.drawCardFront(this.sessionData, this.settings);
            await this.syncCurrentSource();
        } else {
            await this._showDecksList(true);
        }
    }

    private async _showPendingState(): Promise<void> {
        if (this.reviewSequencer === null) return;
        this._clearPendingResumeTimeout();
        const nextPendingDueUnix = this.reviewSequencer.nextPendingDueUnix;
        if (nextPendingDueUnix === null) {
            await this._showDecksList(true);
            return;
        }

        this.uiManager.setUIState(UIState.CardFront);
        this.cardContainer.drawPendingState(nextPendingDueUnix);

        const delayMs = Math.max(0, nextPendingDueUnix - Date.now());
        this.pendingResumeTimeout = window.setTimeout(() => {
            if (this.reviewSequencer === null) return;
            this.reviewSequencer.refreshCurrentDeck();
            void this._showNextCard();
        }, delayMs + 50);
    }

    private _getNewSessionData(deck: Deck): SessionData | null {
        if (this.reviewSequencer === null) return null;
        const chosenDeckStats = this.reviewSequencer.getDeckStats(deck.getTopicPath());
        const totalCardsInSession: number = chosenDeckStats.cardsInQueueCount;
        const totalDecksInSession: number = chosenDeckStats.decksInQueueOfThisDeckCount;
        const currentCardState: CardState = CardState.Front;

        const currentDeckStats =
            this.reviewSequencer.currentDeck === null
                ? null
                : this.reviewSequencer.getDeckStats(
                      this.reviewSequencer.currentDeck.getTopicPath(),
                  );

        return {
            cardData: {
                currentCard: this.reviewSequencer.currentCard,
                currentCardState,
            },
            deckData: {
                chosenDeck: deck,
                currentDeck: this.reviewSequencer.currentDeck,
                previousDeck: null,
                currentDeckTotalCardsInQueue:
                    currentDeckStats === null ? 0 : currentDeckStats.cardsInQueueOfThisDeckCount,
                currentDeckStats: currentDeckStats,
                previousDeckStats: null,
                chosenDeckStats: chosenDeckStats,
            },
            totalCardsInSession,
            totalDecksInSession,
            currentQuestion: this.reviewSequencer.currentQuestion,
            currentNote: this.reviewSequencer.currentNote,
        };
    }

    // MARK: Card button handlers

    public _deleteCurrentCard() {
        if (
            this.sessionData === null ||
            this.reviewSequencer === null ||
            this.dataManager.data === null
        )
            return;

        const timeNow = now();
        if (
            this.lastPressedOnProcessReview &&
            timeNow - this.lastPressedOnProcessReview <
                this.dataManager.data.settings.reviewButtonDelay
        ) {
            return;
        }
        this.lastPressedOnProcessReview = timeNow;

        new ConfirmationModal(
            this.app,
            t("DELETE_CARD"),
            t("DELETE_CARD_CONFIRMATION"),
            t("CANCEL"),
            async () => {
                if (this.sessionData === null || this.reviewSequencer === null) return;
                await this.withCurrentSource(async () => {
                    const note = this.reviewSequencer.currentNote;
                    await this.reviewSequencer.deleteCurrentCardFromNote();
                    refreshReviewNote(note, this.settings, await note.file.read());
                    await this._showNextCard();
                });
            },
        ).open();
    }

    /** 显示答案与保存事件串行执行，防止刷新覆盖刚显示的答案。 */
    public async _showAnswer() {
        if (this.sessionData === null || this.busy) return;
        const timeNow = now();
        if (timeNow - this.lastPressedOnProcessReview < this.settings.reviewButtonDelay) return;
        await this.withCurrentSource(async () => {
            this.lastPressedOnProcessReview = timeNow;
            this.uiManager.setUIState(UIState.CardBack);
            this.sessionData.cardData.currentCardState = CardState.Back;
            await this.cardContainer.drawBack(
                this.sessionData,
                this.reviewMode,
                this.settings,
                this._determineButtonSchedule.bind(this),
            );
        });
    }

    /** 编辑入口直接进入已定位的原文，避免同时维护第二份可写卡片副本。 */
    private async _doEditQuestionText(): Promise<void> {
        await this._jumpToCurrentCard();
    }

    /** 在可编辑 Markdown 视图定位当前源行，不推进队列或提交复习。 */
    public async _jumpToCurrentCard(): Promise<void> {
        await this.withCurrentSource(async () => {
            const question = this.reviewSequencer.currentQuestion;
            const file = question.note.file.tfile;
            const line = question.lineNo;
            const leaf =
                this.app.workspace
                    .getLeavesOfType("markdown")
                    .find((item) => (item.view as MarkdownView).file?.path === file.path) ??
                this.app.workspace.getLeaf("tab");
            await leaf.openFile(file, { active: true, eState: { line } });
            await leaf.setViewState({
                type: "markdown",
                state: { ...leaf.getViewState().state, file: file.path, mode: "source" },
                active: true,
            });
            await this.app.workspace.revealLeaf(leaf);
            const view = leaf.view as MarkdownView;
            const position = { line, ch: 0 };
            view.editor.setCursor(position);
            view.editor.scrollIntoView({ from: position, to: position }, true);
            view.editor.focus();
            this.uiManager.setSRViewInFocus(false);
        });
    }

    public async _skipCurrentCard() {
        if (this.reviewSequencer === null || this.busy) return;
        this.reviewSequencer.skipCurrentCard();
        await this._showNextCard();
    }

    private _displayCurrentCardInfoNotice() {
        if (this.sessionData === null) return;
        new CardInfoNotice(
            this.sessionData.cardData.currentCard.scheduleInfo,
            this.sessionData.currentNote.file.path,
        );
    }

    /** Again 保留上游行为；旧 Hard/Good/Easy 快捷命令不再提交普通复习。 */
    public async _processReview(response: ReviewResponse): Promise<void> {
        if (
            this.reviewMode === FlashcardReviewMode.Review &&
            response !== ReviewResponse.Again &&
            response !== ReviewResponse.Reset
        )
            return;
        await this.submitReview(() => this.reviewSequencer.processReview(response));
    }

    /** 将所选自然日交给调度器，持久化成功后才进入下一张。 */
    public async _processManualReview(days: number): Promise<void> {
        await this.submitReview(() => this.reviewSequencer.processManualReview(days));
    }

    private async submitReview(review: () => Promise<void>): Promise<void> {
        if (this.sessionData?.cardData.currentCardState !== CardState.Back) return;
        const timeNow = now();
        if (timeNow - this.lastPressedOnProcessReview < this.settings.reviewButtonDelay) return;
        await this.withCurrentSource(async () => {
            this.lastPressedOnProcessReview = timeNow;
            const note = this.reviewSequencer.currentNote;
            await review();
            refreshReviewNote(note, this.settings, await note.file.read());
            if (this.isOpen) await this._showNextCard();
        });
    }

    /** 保存事件只串行刷新当前会话；评分期间收到的事件在写入结束后处理。 */
    private queueSourceRefresh(): void {
        if (!this.isOpen || !this.sessionData || !this.reviewSequencer?.currentQuestion) return;
        if (this.busy) {
            this.refreshQueued = true;
            return;
        }
        void this.withCurrentSource(async () => {});
    }

    private async withCurrentSource(action: () => Promise<void>): Promise<void> {
        if (!this.isOpen || this.busy || !this.reviewSequencer?.currentQuestion) return;
        this.busy = true;
        try {
            this.cardContainer.setSourceStatus("正在同步原文…", true);
            if (!(await this.syncCurrentSource())) return;
            if (!this.isOpen) return;
            this.cardContainer.setSourceStatus("", true);
            await action();
            if (this.isOpen) await this.syncCurrentSource();
        } catch (error) {
            const message = error instanceof Error ? error.message : "读取或保存卡片失败，请重试。";
            this.cardContainer.setSourceStatus(message, true);
            new Notice(message);
        } finally {
            this.busy = false;
            if (this.refreshQueued) {
                this.refreshQueued = false;
                this.queueSourceRefresh();
            }
        }
    }

    /** 重读保存后的内容，并保持当前卡片、答案状态和队列对象不变。 */
    private async syncCurrentSource(): Promise<boolean> {
        const question = this.reviewSequencer?.currentQuestion;
        if (!question || !this.sessionData || !this.isOpen) return false;
        const note = question.note;
        if (!this.app.vault.getAbstractFileByPath(note.filePath)) {
            this.cardContainer.setSourceStatus(
                "原文件已不存在，不能继续评分。可跳过或返回卡组。",
                true,
            );
            return false;
        }
        const source = await note.file.read();
        if (!this.isOpen) return false;
        const changed = refreshReviewNote(note, this.settings, source);
        if (question.reviewSourceInvalid) {
            this.cardContainer.setSourceStatus(
                "当前卡片已删除、语法失效或无法可靠定位。请跳过或返回卡组重新载入。",
                true,
            );
            return false;
        }
        if (changed) {
            if (this.sessionData.cardData.currentCardState === CardState.Back) {
                await this.cardContainer.drawBack(
                    this.sessionData,
                    this.reviewMode,
                    this.settings,
                    this._determineButtonSchedule.bind(this),
                    true,
                );
            } else {
                await this.cardContainer.drawCardFront(this.sessionData, this.settings, true);
            }
        }
        const unsaved = this.app.workspace.getLeavesOfType("markdown").some((leaf) => {
            const view = leaf.view as MarkdownView;
            return (
                view.file?.path === note.filePath &&
                view.getMode() === "source" &&
                view.editor.getValue().replaceAll("\r\n", "\n") !== source.replaceAll("\r\n", "\n")
            );
        });
        this.cardContainer.setSourceStatus(unsaved ? "等待 Obsidian 保存原文…" : "", unsaved);
        return !unsaved;
    }

    // MARK: Deck button handlers

    private async _startReviewOfDeck(deck: Deck) {
        if (this.reviewSequencer === null) return;
        this.reviewSequencer.setCurrentDeck(deck.getTopicPath());
        if (this.reviewSequencer.hasCurrentCard) {
            await this._reviewDeck(deck);
        } else {
            await this._showDecksList();
        }
    }

    private async _changeReviewMode(reviewMode: FlashcardReviewMode) {
        this.reviewQueueLoader.setReviewMode(reviewMode);
        this.reviewMode = reviewMode;
        this.reviewSequencer = await this.reviewQueueLoader.loadReviewQueue();
        this.deckContainer.closeList();
        await this._showDecksList();
    }

    // MARK: Utils

    private _determineButtonSchedule(reviewResponse: ReviewResponse): RepItemScheduleInfo | null {
        if (this.sessionData === null) return null;
        if (this.reviewSequencer === null) return null;
        return this.reviewSequencer.determineCardSchedule(
            reviewResponse,
            this.sessionData.cardData.currentCard,
        );
    }

    private _clearPendingResumeTimeout(): void {
        if (this.pendingResumeTimeout !== null) {
            window.clearTimeout(this.pendingResumeTimeout);
            this.pendingResumeTimeout = null;
        }
    }
}
