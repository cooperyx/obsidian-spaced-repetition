/** 浮动窗口左上角相对视口的位置。 */
export interface FloatingWindowPosition {
    x: number;
    y: number;
}

/** 浮动窗口的实际渲染尺寸。 */
export interface FloatingWindowSize {
    width: number;
    height: number;
}

/** 当前 Obsidian 窗口的可见区域尺寸。 */
export interface FloatingWindowViewport {
    width: number;
    height: number;
}

/**
 * 将浮动窗口限制在当前窗口可见区域内，避免复习按钮被拖到屏幕外。
 */
export function clampFloatingWindowPosition(
    position: FloatingWindowPosition,
    size: FloatingWindowSize,
    viewport: FloatingWindowViewport,
): FloatingWindowPosition {
    return {
        x: Math.min(Math.max(position.x, 0), Math.max(viewport.width - size.width, 0)),
        y: Math.min(Math.max(position.y, 0), Math.max(viewport.height - size.height, 0)),
    };
}

/**
 * 为固定定位的窗口提供顶部拖动和视口边界约束。
 *
 * 该控制器只改变窗口的 CSS 位置，不会重建或移动其中的卡片 DOM，
 * 因而拖动期间会保留当前卡片和答案显示状态。
 */
export class FloatingWindowController {
    private activePointerId: number | null = null;
    private initialPositionFrame: number | null = null;
    private resizeObserver: ResizeObserver | null = null;

    public constructor(
        private readonly floatingWindowEl: HTMLElement,
        private readonly dragHandleEl: HTMLElement,
    ) {}

    /** 注册拖动与位置约束监听。 */
    public enable(): void {
        this.dragHandleEl.addEventListener("pointerdown", this.onPointerDown);
        this.dragHandleEl.addEventListener("pointermove", this.onPointerMove);
        this.dragHandleEl.addEventListener("pointerup", this.onPointerUp);
        this.dragHandleEl.addEventListener("pointercancel", this.onPointerUp);
        this.window.addEventListener("resize", this.keepWithinViewport);
        // 卡片内容异步渲染后高度会变化，此观察只重新约束位置，不提供窗口缩放。
        this.resizeObserver = new ResizeObserver(this.keepWithinViewport);
        this.resizeObserver.observe(this.floatingWindowEl);

        // Modal 刚加入文档时才能取得实际尺寸；初始位置仅在本次打开期间使用。
        this.initialPositionFrame = this.window.requestAnimationFrame(() => {
            this.initialPositionFrame = null;
            const rect = this.floatingWindowEl.getBoundingClientRect();
            this.setPosition({
                x: (this.viewport.width - rect.width) / 2,
                y: (this.viewport.height - rect.height) / 2,
            });
        });
    }

    /** 释放当前打开周期注册的监听，避免关闭后继续影响工作区。 */
    public destroy(): void {
        this.dragHandleEl.removeEventListener("pointerdown", this.onPointerDown);
        this.dragHandleEl.removeEventListener("pointermove", this.onPointerMove);
        this.dragHandleEl.removeEventListener("pointerup", this.onPointerUp);
        this.dragHandleEl.removeEventListener("pointercancel", this.onPointerUp);
        this.window.removeEventListener("resize", this.keepWithinViewport);
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;

        if (this.initialPositionFrame !== null) {
            this.window.cancelAnimationFrame(this.initialPositionFrame);
            this.initialPositionFrame = null;
        }
        this.releasePointer();
    }

    private get window(): Window {
        return this.floatingWindowEl.ownerDocument.defaultView ?? window;
    }

    private get viewport(): FloatingWindowViewport {
        const documentEl = this.floatingWindowEl.ownerDocument.documentElement;
        return { width: documentEl.clientWidth, height: documentEl.clientHeight };
    }

    private onPointerDown = (event: PointerEvent): void => {
        if (event.button !== 0) return;

        event.preventDefault();
        this.activePointerId = event.pointerId;
        this.dragHandleEl.setPointerCapture(event.pointerId);
        this.dragHandleEl.addClass("is-dragging");
    };

    private onPointerMove = (event: PointerEvent): void => {
        if (event.pointerId !== this.activePointerId) return;

        const rect = this.floatingWindowEl.getBoundingClientRect();
        this.setPosition({
            x: rect.left + event.movementX,
            y: rect.top + event.movementY,
        });
    };

    private onPointerUp = (event: PointerEvent): void => {
        if (event.pointerId !== this.activePointerId) return;
        this.releasePointer();
    };

    private keepWithinViewport = (): void => {
        const rect = this.floatingWindowEl.getBoundingClientRect();
        this.setPosition({ x: rect.left, y: rect.top });
    };

    private setPosition(position: FloatingWindowPosition): void {
        const rect = this.floatingWindowEl.getBoundingClientRect();
        const constrainedPosition = clampFloatingWindowPosition(
            position,
            { width: rect.width, height: rect.height },
            this.viewport,
        );
        this.floatingWindowEl.setCssProps({
            left: `${constrainedPosition.x}px`,
            top: `${constrainedPosition.y}px`,
        });
    }

    private releasePointer(): void {
        if (
            this.activePointerId !== null &&
            this.dragHandleEl.hasPointerCapture(this.activePointerId)
        ) {
            this.dragHandleEl.releasePointerCapture(this.activePointerId);
        }
        this.activePointerId = null;
        this.dragHandleEl.removeClass("is-dragging");
    }
}
