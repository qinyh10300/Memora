"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type {
  CSSProperties,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { clampNumber, readStoredNumber, storeNumber } from "@/features/shared/utils";

const SPLIT_GUTTER_PX = 8;
const SPLIT_KEY_STEP = 4;
const SPLIT_KEY_LARGE_STEP = 10;
const SPLIT_COLLAPSE_RESISTANCE_PX = 56;
const SPLIT_REOPEN_DRAG_PX = 44;
export const COMPOSER_DEFAULT_HEIGHT = 112;
const COMPOSER_MIN_HEIGHT = 96;
const COMPOSER_MAX_HEIGHT = 360;
const COMPOSER_KEY_STEP = 18;

function splitBounds(containerWidth: number, minLeftPx: number, minRightPx: number) {
  const width = Math.max(containerWidth, minLeftPx + minRightPx + SPLIT_GUTTER_PX);
  const min = (minLeftPx / width) * 100;
  const max = ((width - minRightPx - SPLIT_GUTTER_PX) / width) * 100;
  return max > min ? { min, max } : { min: 0, max: 100 };
}

export function ResizableSplit({
  className,
  label,
  storageKey,
  defaultLeftPercent,
  minLeftPx,
  minRightPx,
  rightCollapsed,
  onRightCollapsedChange,
  left,
  right,
}: {
  className: string;
  label: string;
  storageKey?: string;
  defaultLeftPercent: number;
  minLeftPx: number;
  minRightPx: number;
  rightCollapsed?: boolean;
  onRightCollapsedChange?: (collapsed: boolean) => void;
  left: ReactNode;
  right: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [leftPercent, setLeftPercent] = useState(rightCollapsed ? 100 : defaultLeftPercent);
  const leftPercentRef = useRef(leftPercent);
  const lastVisiblePercentRef = useRef(defaultLeftPercent);
  const suppressClickRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  const normalizeSplitPercent = useCallback(
    (value: number) => {
      if (value <= 0) return 0;
      if (value >= 100) return 100;
      const width =
        containerRef.current?.getBoundingClientRect().width ??
        minLeftPx + minRightPx + SPLIT_GUTTER_PX;
      const { min, max } = splitBounds(width, minLeftPx, minRightPx);
      return clampNumber(value, min, max);
    },
    [minLeftPx, minRightPx],
  );

  const setAndPersistSplit = useCallback(
    (value: number) => {
      const nextValue = normalizeSplitPercent(value);
      leftPercentRef.current = nextValue;
      if (nextValue > 0 && nextValue < 100) lastVisiblePercentRef.current = nextValue;
      setLeftPercent(nextValue);
      if (storageKey) storeNumber(storageKey, Number(nextValue.toFixed(2)));
      onRightCollapsedChange?.(nextValue >= 100);
    },
    [normalizeSplitPercent, onRightCollapsedChange, storageKey],
  );

  useEffect(() => {
    if (!storageKey || rightCollapsed) return undefined;
    const timer = window.setTimeout(() => {
      const stored = readStoredNumber(storageKey);
      if (stored !== null && stored >= 0 && stored <= 100) setAndPersistSplit(stored);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [rightCollapsed, setAndPersistSplit, storageKey]);

  useEffect(() => {
    if (rightCollapsed === undefined) return;
    if (rightCollapsed && leftPercentRef.current < 100) {
      setAndPersistSplit(100);
    } else if (!rightCollapsed && leftPercentRef.current >= 100) {
      setAndPersistSplit(lastVisiblePercentRef.current);
    }
  }, [rightCollapsed, setAndPersistSplit]);

  useEffect(() => {
    const clampAfterResize = () => setAndPersistSplit(leftPercentRef.current);
    window.addEventListener("resize", clampAfterResize);
    return () => window.removeEventListener("resize", clampAfterResize);
  }, [setAndPersistSplit]);

  function percentFromClientX(clientX: number) {
    const container = containerRef.current;
    if (!container) return leftPercent;
    const rect = container.getBoundingClientRect();
    const width = rect.width || minLeftPx + minRightPx + SPLIT_GUTTER_PX;
    const { min, max } = splitBounds(width, minLeftPx, minRightPx);
    const rawPx = clampNumber(clientX - rect.left, 0, width - SPLIT_GUTTER_PX);
    const rawPercent = (rawPx / width) * 100;
    const current = leftPercentRef.current;

    if (current <= 0) {
      return rawPx <= SPLIT_REOPEN_DRAG_PX ? 0 : min;
    }
    if (current >= 100) {
      return rawPx >= width - SPLIT_GUTTER_PX - SPLIT_REOPEN_DRAG_PX ? 100 : max;
    }

    const leftCollapseAt = Math.max(24, minLeftPx - SPLIT_COLLAPSE_RESISTANCE_PX);
    const rightCollapseAt = width - minRightPx - SPLIT_GUTTER_PX + SPLIT_COLLAPSE_RESISTANCE_PX;
    if (rawPx <= leftCollapseAt) return 0;
    if (rawPx >= rightCollapseAt) return 100;
    return clampNumber(rawPercent, min, max);
  }

  function restoreSplit(useDefault = false) {
    setAndPersistSplit(useDefault ? defaultLeftPercent : lastVisiblePercentRef.current);
  }

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const pointerStartX = event.clientX;
    let moved = false;
    setDragging(true);
    document.body.classList.add("is-resizing-panels");
    const initialPercent = percentFromClientX(event.clientX);
    leftPercentRef.current = initialPercent;
    setLeftPercent(initialPercent);

    const resize = (moveEvent: globalThis.PointerEvent) => {
      moveEvent.preventDefault();
      if (Math.abs(moveEvent.clientX - pointerStartX) > 3) moved = true;
      const nextPercent = percentFromClientX(moveEvent.clientX);
      leftPercentRef.current = nextPercent;
      setLeftPercent(nextPercent);
    };
    const stopResize = () => {
      suppressClickRef.current = moved;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
      setAndPersistSplit(leftPercentRef.current);
      setDragging(false);
      document.body.classList.remove("is-resizing-panels");
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };

    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? SPLIT_KEY_LARGE_STEP : SPLIT_KEY_STEP;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (leftPercentRef.current >= 100) restoreSplit();
      else setAndPersistSplit(leftPercentRef.current - step);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      if (leftPercentRef.current <= 0) restoreSplit();
      else setAndPersistSplit(leftPercentRef.current + step);
    } else if (event.key === "Home") {
      event.preventDefault();
      setAndPersistSplit(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setAndPersistSplit(100);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (leftPercentRef.current <= 0 || leftPercentRef.current >= 100) restoreSplit();
      else setAndPersistSplit(0);
    }
  }

  const leftCollapsed = leftPercent <= 0;
  const rightIsCollapsed = leftPercent >= 100;
  const splitStyle = {
    "--split-left": `${leftPercent.toFixed(2)}%`,
    "--split-left-min": `${minLeftPx}px`,
    "--split-right-min": `${minRightPx}px`,
    "--split-gutter": `${SPLIT_GUTTER_PX}px`,
  } as CSSProperties;

  return (
    <div
      ref={containerRef}
      className={`${className} resizable-split ${dragging ? "is-dragging" : ""} ${leftCollapsed ? "is-left-collapsed" : ""} ${rightIsCollapsed ? "is-right-collapsed" : ""}`}
      style={splitStyle}
    >
      {left}
      <div
        className="split-handle"
        role="separator"
        aria-label={label}
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(leftPercent)}
        aria-valuetext={
          leftCollapsed
            ? "左侧已隐藏"
            : rightIsCollapsed
              ? "右侧已隐藏"
              : `左侧占 ${Math.round(leftPercent)}%`
        }
        tabIndex={0}
        title={
          leftCollapsed || rightIsCollapsed
            ? "点击或按 Enter 恢复面板"
            : "拖动调整宽度，拖到边缘隐藏，双击恢复默认"
        }
        onPointerDown={startResize}
        onClick={() => {
          if (suppressClickRef.current) return;
          if (leftCollapsed || rightIsCollapsed) restoreSplit();
        }}
        onDoubleClick={() => restoreSplit(true)}
        onKeyDown={resizeWithKeyboard}
      >
        <span className="split-handle-indicator" aria-hidden="true">
          {leftCollapsed ? (
            <ChevronRight size={13} strokeWidth={2} />
          ) : rightIsCollapsed ? (
            <ChevronLeft size={13} strokeWidth={2} />
          ) : null}
        </span>
      </div>
      {right}
    </div>
  );
}

export function ComposerResizeHandle({
  height,
  onHeightChange,
}: {
  height: number;
  onHeightChange: (height: number) => void;
}) {
  const dragOrigin = useRef<{ clientY: number; height: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;

    const resize = (event: globalThis.PointerEvent) => {
      const origin = dragOrigin.current;
      if (!origin) return;
      event.preventDefault();
      onHeightChange(
        clampNumber(
          origin.height + origin.clientY - event.clientY,
          COMPOSER_MIN_HEIGHT,
          COMPOSER_MAX_HEIGHT,
        ),
      );
    };
    const stopResize = () => {
      dragOrigin.current = null;
      setDragging(false);
    };

    document.body.classList.add("is-resizing-composer");
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);

    return () => {
      document.body.classList.remove("is-resizing-composer");
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };
  }, [dragging, onHeightChange]);

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragOrigin.current = { clientY: event.clientY, height };
    setDragging(true);
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      onHeightChange(
        clampNumber(height + COMPOSER_KEY_STEP, COMPOSER_MIN_HEIGHT, COMPOSER_MAX_HEIGHT),
      );
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      onHeightChange(
        clampNumber(height - COMPOSER_KEY_STEP, COMPOSER_MIN_HEIGHT, COMPOSER_MAX_HEIGHT),
      );
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      onHeightChange(event.key === "Home" ? COMPOSER_MIN_HEIGHT : COMPOSER_MAX_HEIGHT);
    }
  }

  return (
    <div
      className={`composer-resize-handle ${dragging ? "is-dragging" : ""}`}
      role="separator"
      aria-label="调整输入区高度"
      aria-orientation="horizontal"
      aria-valuemin={COMPOSER_MIN_HEIGHT}
      aria-valuemax={COMPOSER_MAX_HEIGHT}
      aria-valuenow={Math.round(height)}
      tabIndex={0}
      title="拖动调整输入区高度，双击恢复默认"
      onPointerDown={startResize}
      onDoubleClick={() => onHeightChange(COMPOSER_DEFAULT_HEIGHT)}
      onKeyDown={resizeWithKeyboard}
    >
      <span />
    </div>
  );
}

export function clampComposerHeight(height: number) {
  return clampNumber(height, COMPOSER_MIN_HEIGHT, COMPOSER_MAX_HEIGHT);
}
