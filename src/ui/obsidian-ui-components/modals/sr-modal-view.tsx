import "src/ui/obsidian-ui-components/modals/modal-view.css";
import { App, Modal, Platform } from "obsidian";

import { SettingsManager } from "src/data/settings-manager";
import type SRPlugin from "src/main";
import ContentManager from "src/ui/obsidian-ui-components/content-container/content-manager";
import { FloatingWindowController } from "src/ui/obsidian-ui-components/modals/floating-window";
import { ReviewQueueLoader } from "src/ui/review-queue-loader";
import EmulatedPlatform from "src/utils/platform-detector";

/** 复用上游复习视图，在桌面端释放模态焦点限制并支持顶部拖动。 */
export class SRModalView extends Modal {
    private contentManager: ContentManager;
    private plugin: SRPlugin;
    private settingsManager: SettingsManager;
    private floatingWindow: FloatingWindowController | null = null;
    private focusTrackingDocument: Document | null = null;

    constructor(
        app: App,
        plugin: SRPlugin,
        settingsManager: SettingsManager,
        reviewQueueLoader: ReviewQueueLoader,
    ) {
        super(app);
        this.plugin = plugin;
        this.settingsManager = settingsManager;

        // Setup base containers
        if (Platform.isMobile || EmulatedPlatform().isMobile) {
            this.setModalSize(
                this.settingsManager.settings.flashcardHeightPercentageMobile,
                this.settingsManager.settings.flashcardWidthPercentageMobile,
            );
        } else {
            this.setModalSize(
                this.settingsManager.settings.flashcardHeightPercentage,
                this.settingsManager.settings.flashcardWidthPercentage,
            );

            this.createFloatingWindow();
        }

        this.modalEl.setAttribute("id", "sr-modal-view");
        this.modalEl.addClass("sr-view");

        this.contentEl.addClass("sr-modal-content");

        // Init static elements in views
        this.contentManager = new ContentManager(
            app,
            plugin,
            reviewQueueLoader,
            this.settingsManager.settings,
            this.contentEl,
            () => {
                this.close();
            },
        );
        this.plugin.uiManager.setContentManager(this.contentManager);
    }

    /** 打开期间注册拖动与焦点监听，再加载卡组。 */
    onOpen(): void {
        if (!this.isMobile()) {
            this.floatingWindow?.enable();
            this.startFocusTracking();
        }
        void this.contentManager.open();
    }

    /** 关闭时释放窗口、焦点及卡片会话的全部监听。 */
    onClose(): void {
        this.stopFocusTracking();
        this.floatingWindow?.destroy();
        this.contentManager.close();
    }

    /** 保留 Modal 生命周期，但将键盘和 Tab 焦点控制权归还工作区。 */
    open(): void {
        super.open();

        if (!this.isMobile()) {
            // Modal 默认接管整个按键 scope。浮动窗口打开后需让原文编辑器继续接收快捷键。
            this.app.keymap.popScope(this.scope);
        }
    }

    private setRoundedModalCorners(rounded: boolean) {
        this.modalEl.setCssProps({ "border-Radius": rounded ? "var(--modal-radius)" : "0" });
    }

    private setModalSize(heightPercent: number, widthPercent: number) {
        this.modalEl.setCssProps({ height: heightPercent + "%" });
        this.modalEl.setCssProps({ width: widthPercent + "%" });

        this.setRoundedModalCorners(
            !(
                parseInt(this.modalEl.getCssPropertyValue("height").split("%")[0]) >= 100 ||
                parseInt(this.modalEl.getCssPropertyValue("width").split("%")[0]) >= 100
            ),
        );
    }

    private createFloatingWindow(): void {
        this.containerEl.addClass("sr-floating-modal-container");

        const dragHandle = this.modalEl.createDiv("sr-floating-window-drag-handle");
        dragHandle.setAttr("aria-label", "拖动复习窗口");
        this.contentEl.before(dragHandle);
        this.floatingWindow = new FloatingWindowController(this.modalEl, dragHandle);
    }

    private isMobile(): boolean {
        return Platform.isMobile || EmulatedPlatform().isMobile;
    }

    private startFocusTracking(): void {
        this.focusTrackingDocument = this.modalEl.ownerDocument;
        this.focusTrackingDocument.addEventListener("focusin", this.updateReviewFocus, true);
        this.focusTrackingDocument.addEventListener("pointerdown", this.updateReviewFocus, true);
        this.plugin.uiManager.setSRViewInFocus(true);
    }

    private stopFocusTracking(): void {
        if (this.focusTrackingDocument === null) return;
        this.focusTrackingDocument.removeEventListener("focusin", this.updateReviewFocus, true);
        this.focusTrackingDocument.removeEventListener("pointerdown", this.updateReviewFocus, true);
        this.focusTrackingDocument = null;
    }

    private updateReviewFocus = (event: FocusEvent | PointerEvent): void => {
        const isWithinReviewWindow = event.composedPath().includes(this.modalEl);

        // 卡片快捷键由 document 监听；编辑原文时必须先停用，避免输入被当成评分操作。
        this.plugin.uiManager.setSRViewInFocus(isWithinReviewWindow);
    };
}
