/**
 * TUI — main class for managing terminal UI with differential rendering.
 *
 * Container holds child components; TUI extends Container with overlay stack,
 * focus management, input routing, and a differential renderer (doRender) that
 * only repaints changed lines using ANSI cursor movement.
 *
 * Ported from pi-tui tui.js.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { isKeyRelease, matchesKey } from "./keys.js";
import {
  applyLineResets,
  compositeOverlays,
  extractCursorPosition,
  isOverlayVisible as isOverlayEntryVisible,
  type OverlayComponent,
  type OverlayEntry,
  type OverlayOptions,
} from "./overlay-layout.js";
import { getCapabilities, isImageLine, setCellDimensions } from "./terminal-image.js";
import { truncateToWidth, visibleWidth } from "./utils.js";
import type { ProcessTerminal } from "./terminal.js";

// ─── Public helpers ─────────────────────────────────────────────────────────

/** Type guard for components that implement the Focusable interface. */
export function isFocusable(
  component: unknown,
): component is OverlayComponent & { focused: boolean } {
  return component !== null && typeof component === "object" && "focused" in component;
}

/**
 * Cursor position marker — APC (Application Program Command) sequence.
 * Zero-width; terminals ignore it. Components emit this where the cursor
 * should be; TUI finds it, strips it, and positions the hardware cursor.
 */
export const CURSOR_MARKER = "\x1b_pi:c\x07";

export { visibleWidth };

// ─── Renderable component interface ─────────────────────────────────────────

/** Minimal interface that any component rendered by TUI must satisfy. */
export interface Renderable {
  render(width: number): string[];
  handleInput?(data: string): void;
  invalidate?(): void;
  focused?: boolean;
  wantsKeyRelease?: boolean;
}

// ─── Overlay handle returned by showOverlay ─────────────────────────────────

export interface OverlayHandle {
  hide(): void;
  setHidden(hidden: boolean): void;
  isHidden(): boolean;
  focus(): void;
  unfocus(): void;
  isFocused(): boolean;
}

// ─── Input listener ─────────────────────────────────────────────────────────

export interface InputListenerResult {
  consume?: boolean;
  data?: string;
}

export type InputListener = (data: string) => InputListenerResult | void;

// ─── Container ──────────────────────────────────────────────────────────────

/**
 * Container — a component that contains other components.
 */
export class Container implements Renderable {
  children: Renderable[] = [];

  addChild(component: Renderable): void {
    this.children.push(component);
  }

  removeChild(component: Renderable): void {
    const index = this.children.indexOf(component);
    if (index !== -1) {
      this.children.splice(index, 1);
    }
  }

  clear(): void {
    this.children = [];
  }

  invalidate(): void {
    for (const child of this.children) {
      child.invalidate?.();
    }
  }

  render(width: number): string[] {
    const lines: string[] = [];
    for (const child of this.children) {
      const rendered = child.render(width);
      for (let i = 0; i < rendered.length; i++) lines.push(rendered[i]!);
    }
    return lines;
  }
}

// ─── TUI ────────────────────────────────────────────────────────────────────

/**
 * TUI — main class with differential rendering, overlay stack, focus
 * management, and input routing.
 */
export class TUI extends Container {
  private terminal: ProcessTerminal;

  // Render state
  private previousLines: string[] = [];
  private previousWidth = 0;
  private previousHeight = 0;
  private cursorRow = 0;
  private hardwareCursorRow = 0;
  private renderRequested = false;
  private maxLinesRendered = 0;
  private previousViewportTop = 0;
  private fullRedrawCount = 0;
  private stopped = false;

  // Hardware cursor + clear-on-shrink config
  private showHardwareCursor: boolean;
  private clearOnShrink: boolean;

  // Input
  private inputBuffer = "";
  private cellSizeQueryPending = false;
  private inputListeners = new Set<InputListener>();

  // Focus
  private focusedComponent: OverlayComponent | null = null;

  // Overlay stack
  private focusOrderCounter = 0;
  private overlayStack: OverlayEntry[] = [];

  // Debug callback
  onDebug?: () => void;

  constructor(terminal: ProcessTerminal, showHardwareCursor?: boolean) {
    super();
    this.terminal = terminal;

    this.showHardwareCursor =
      showHardwareCursor ??
      (process.env.PI_HARDWARE_CURSOR === "1" ||
        process.env.TERM_PROGRAM === "WarpTerminal");

    this.clearOnShrink = process.env.PI_CLEAR_ON_SHRINK === "1";
  }

  // ── Public accessors ────────────────────────────────────────────────────

  get fullRedraws(): number {
    return this.fullRedrawCount;
  }

  getShowHardwareCursor(): boolean {
    return this.showHardwareCursor;
  }

  setShowHardwareCursor(enabled: boolean): void {
    if (this.showHardwareCursor === enabled) return;
    this.showHardwareCursor = enabled;
    if (!enabled) this.terminal.hideCursor();
    this.requestRender();
  }

  getClearOnShrink(): boolean {
    return this.clearOnShrink;
  }

  setClearOnShrink(enabled: boolean): void {
    this.clearOnShrink = enabled;
  }

  // ── Focus management ────────────────────────────────────────────────────

  setFocus(component: OverlayComponent | null): void {
    if (isFocusable(this.focusedComponent)) {
      this.focusedComponent.focused = false;
    }
    this.focusedComponent = component;
    if (isFocusable(component)) {
      component.focused = true;
    }
  }

  // ── Overlay stack ───────────────────────────────────────────────────────

  showOverlay(
    component: OverlayComponent,
    options?: OverlayOptions,
  ): OverlayHandle {
    const entry: OverlayEntry = {
      component,
      options,
      preFocus: this.focusedComponent,
      hidden: false,
      focusOrder: ++this.focusOrderCounter,
    };
    this.overlayStack.push(entry);

    if (!options?.nonCapturing && this.isOverlayVisible(entry)) {
      this.setFocus(component);
    }
    this.terminal.hideCursor();
    this.requestRender();

    return {
      hide: () => {
        const index = this.overlayStack.indexOf(entry);
        if (index !== -1) {
          this.overlayStack.splice(index, 1);
          if (this.focusedComponent === component) {
            const topVisible = this.getTopmostVisibleOverlay();
            this.setFocus(topVisible?.component ?? entry.preFocus);
          }
          if (this.overlayStack.length === 0) this.terminal.hideCursor();
          this.requestRender();
        }
      },
      setHidden: (hidden: boolean) => {
        if (entry.hidden === hidden) return;
        entry.hidden = hidden;
        if (hidden) {
          if (this.focusedComponent === component) {
            const topVisible = this.getTopmostVisibleOverlay();
            this.setFocus(topVisible?.component ?? entry.preFocus);
          }
        } else {
          if (!options?.nonCapturing && this.isOverlayVisible(entry)) {
            entry.focusOrder = ++this.focusOrderCounter;
            this.setFocus(component);
          }
        }
        this.requestRender();
      },
      isHidden: () => entry.hidden,
      focus: () => {
        if (
          !this.overlayStack.includes(entry) ||
          !this.isOverlayVisible(entry)
        )
          return;
        if (this.focusedComponent !== component) {
          this.setFocus(component);
        }
        entry.focusOrder = ++this.focusOrderCounter;
        this.requestRender();
      },
      unfocus: () => {
        if (this.focusedComponent !== component) return;
        const topVisible = this.getTopmostVisibleOverlay();
        this.setFocus(
          topVisible && topVisible !== entry
            ? topVisible.component
            : entry.preFocus,
        );
        this.requestRender();
      },
      isFocused: () => this.focusedComponent === component,
    };
  }

  hideOverlay(): void {
    const overlay = this.overlayStack.pop();
    if (!overlay) return;
    if (this.focusedComponent === overlay.component) {
      const topVisible = this.getTopmostVisibleOverlay();
      this.setFocus(topVisible?.component ?? overlay.preFocus);
    }
    if (this.overlayStack.length === 0) this.terminal.hideCursor();
    this.requestRender();
  }

  hasOverlay(): boolean {
    return this.overlayStack.some((o) => this.isOverlayVisible(o));
  }

  private isOverlayVisible(entry: OverlayEntry): boolean {
    return isOverlayEntryVisible(
      entry,
      this.terminal.columns,
      this.terminal.rows,
    );
  }

  private getTopmostVisibleOverlay(): OverlayEntry | undefined {
    for (let i = this.overlayStack.length - 1; i >= 0; i--) {
      if (this.overlayStack[i]!.options?.nonCapturing) continue;
      if (this.isOverlayVisible(this.overlayStack[i]!)) {
        return this.overlayStack[i];
      }
    }
    return undefined;
  }

  override invalidate(): void {
    super.invalidate();
    for (const overlay of this.overlayStack)
      overlay.component.invalidate?.();
  }

  // ── Start / stop ────────────────────────────────────────────────────────

  start(): void {
    this.stopped = false;
    this.terminal.start(
      (data: string) => this.handleInput(data),
      () => this.requestRender(),
    );
    this.terminal.hideCursor();
    this.queryCellSize();
    this.requestRender();
  }

  stop(): void {
    this.stopped = true;

    // Dispose all overlays
    for (const entry of this.overlayStack) {
      if (
        "dispose" in entry.component &&
        typeof entry.component.dispose === "function"
      ) {
        entry.component.dispose();
      }
    }
    this.overlayStack = [];

    // Move cursor past rendered content for clean exit
    if (this.previousLines.length > 0) {
      const targetRow = this.previousLines.length;
      const lineDiff = targetRow - this.hardwareCursorRow;
      if (lineDiff > 0) {
        this.terminal.write(`\x1b[${lineDiff}B`);
      } else if (lineDiff < 0) {
        this.terminal.write(`\x1b[${-lineDiff}A`);
      }
      this.terminal.write("\r\n");
    }
    this.terminal.showCursor();
    this.terminal.stop();
  }

  // ── Input ───────────────────────────────────────────────────────────────

  addInputListener(listener: InputListener): () => void {
    this.inputListeners.add(listener);
    return () => {
      this.inputListeners.delete(listener);
    };
  }

  removeInputListener(listener: InputListener): void {
    this.inputListeners.delete(listener);
  }

  private handleInput(data: string): void {
    // Run input listeners (middleware chain)
    if (this.inputListeners.size > 0) {
      let current = data;
      for (const listener of this.inputListeners) {
        const result = listener(current);
        if (result?.consume) return;
        if (result?.data !== undefined) current = result.data;
      }
      if (current.length === 0) return;
      data = current;
    }

    // Cell size response interception
    if (this.cellSizeQueryPending) {
      this.inputBuffer += data;
      const filtered = this.parseCellSizeResponse();
      if (filtered.length === 0) return;
      data = filtered;
    }

    // Debug key (Shift+Ctrl+D)
    if (matchesKey(data, "shift+ctrl+d") && this.onDebug) {
      this.onDebug();
      return;
    }

    // If focused overlay is no longer visible, redirect focus
    const focusedOverlay = this.overlayStack.find(
      (o) => o.component === this.focusedComponent,
    );
    if (focusedOverlay && !this.isOverlayVisible(focusedOverlay)) {
      const topVisible = this.getTopmostVisibleOverlay();
      if (topVisible) {
        this.setFocus(topVisible.component);
      } else {
        this.setFocus(focusedOverlay.preFocus);
      }
    }

    // Route to focused component
    if (this.focusedComponent?.handleInput) {
      if (isKeyRelease(data) && !this.focusedComponent.wantsKeyRelease) return;
      this.focusedComponent.handleInput(data);
      this.requestRender();
    }
  }

  // ── Cell size query ─────────────────────────────────────────────────────

  private queryCellSize(): void {
    if (!getCapabilities().images) return;
    this.cellSizeQueryPending = true;
    this.terminal.write("\x1b[16t");
  }

  private parseCellSizeResponse(): string {
    const responsePattern = /\x1b\[6;(\d+);(\d+)t/;
    const match = this.inputBuffer.match(responsePattern);
    if (match) {
      const heightPx = parseInt(match[1]!, 10);
      const widthPx = parseInt(match[2]!, 10);
      if (heightPx > 0 && widthPx > 0) {
        setCellDimensions({ widthPx, heightPx });
        this.invalidate();
        this.requestRender();
      }
      this.inputBuffer = this.inputBuffer.replace(responsePattern, "");
      this.cellSizeQueryPending = false;
    }

    // Check for partial cell size response
    const partialCellSizePattern = /\x1b(\[6?;?[\d;]*)?$/;
    if (partialCellSizePattern.test(this.inputBuffer)) {
      const lastChar = this.inputBuffer[this.inputBuffer.length - 1];
      if (lastChar && !/[a-zA-Z~]/.test(lastChar)) {
        return "";
      }
    }

    const result = this.inputBuffer;
    this.inputBuffer = "";
    this.cellSizeQueryPending = false;
    return result;
  }

  // ── Render ──────────────────────────────────────────────────────────────

  requestRender(force = false): void {
    if (force) {
      this.previousLines = [];
      this.previousWidth = -1;
      this.previousHeight = -1;
      this.cursorRow = 0;
      this.hardwareCursorRow = 0;
      this.maxLinesRendered = 0;
      this.previousViewportTop = 0;
    }
    if (this.renderRequested) return;
    this.renderRequested = true;
    process.nextTick(() => {
      this.renderRequested = false;
      this.doRender();
    });
  }

  /**
   * Core differential renderer.
   *
   * Compares previous and new line arrays; only writes changed lines using
   * ANSI cursor movement. Wraps output in synchronized output mode
   * (DEC private mode 2026) for flicker-free updates.
   */
  private doRender(): void {
    if (this.stopped) return;

    const width = this.terminal.columns;
    const height = this.terminal.rows;

    let viewportTop = Math.max(0, this.maxLinesRendered - height);
    let prevViewportTop = this.previousViewportTop;
    let hardwareCursorRow = this.hardwareCursorRow;

    const computeLineDiff = (targetRow: number): number => {
      const currentScreenRow = hardwareCursorRow - prevViewportTop;
      const targetScreenRow = targetRow - viewportTop;
      return targetScreenRow - currentScreenRow;
    };

    // Render all components
    let newLines = this.render(width);

    // Composite overlays
    if (this.overlayStack.length > 0) {
      newLines = compositeOverlays(
        newLines,
        this.overlayStack,
        width,
        height,
        this.maxLinesRendered,
      );
    }

    // Extract cursor position before resets
    const cursorPos = extractCursorPosition(newLines, height);
    newLines = applyLineResets(newLines);

    const widthChanged = this.previousWidth !== 0 && this.previousWidth !== width;
    const heightChanged = this.previousHeight !== 0 && this.previousHeight !== height;

    // ── Full render helper ─────────────────────────────────────────────

    const fullRender = (clear: boolean): void => {
      this.fullRedrawCount += 1;
      let buffer = "\x1b[?2026h"; // Begin synchronized output
      if (clear) buffer += "\x1b[2J\x1b[H";

      for (let i = 0; i < newLines.length; i++) {
        if (i > 0) buffer += "\r\n";
        let line = newLines[i]!;
        if (!isImageLine(line) && visibleWidth(line) > width) {
          line = truncateToWidth(line, width);
        }
        buffer += line;
      }

      buffer += "\x1b[?2026l"; // End synchronized output
      this.terminal.write(buffer);

      this.cursorRow = Math.max(0, newLines.length - 1);
      this.hardwareCursorRow = this.cursorRow;
      if (clear) {
        this.maxLinesRendered = newLines.length;
      } else {
        this.maxLinesRendered = Math.max(this.maxLinesRendered, newLines.length);
      }
      this.previousViewportTop = Math.max(0, this.maxLinesRendered - height);
      this.positionHardwareCursor(cursorPos, newLines.length);
      this.previousLines = newLines;
      this.previousWidth = width;
      this.previousHeight = height;
    };

    // Debug logging
    const debugRedraw = process.env.PI_DEBUG_REDRAW === "1";
    const logRedraw = (reason: string): void => {
      if (!debugRedraw) return;
      const logPath = path.join(os.homedir(), ".pi", "agent", "pi-debug.log");
      const msg = `[${new Date().toISOString()}] fullRender: ${reason} (prev=${this.previousLines.length}, new=${newLines.length}, height=${height})\n`;
      fs.appendFileSync(logPath, msg);
    };

    // ── First render ──────────────────────────────────────────────────

    if (
      this.previousLines.length === 0 &&
      !widthChanged &&
      !heightChanged
    ) {
      logRedraw("first render");
      fullRender(false);
      return;
    }

    // ── Size changed → full re-render ─────────────────────────────────

    if (widthChanged || heightChanged) {
      logRedraw(
        `terminal size changed (${this.previousWidth}x${this.previousHeight} -> ${width}x${height})`,
      );
      fullRender(true);
      return;
    }

    // ── Content shrunk → clear ────────────────────────────────────────

    if (
      this.clearOnShrink &&
      newLines.length < this.maxLinesRendered &&
      this.overlayStack.length === 0
    ) {
      logRedraw(`clearOnShrink (maxLinesRendered=${this.maxLinesRendered})`);
      fullRender(true);
      return;
    }

    // ── Differential render ───────────────────────────────────────────

    let firstChanged = -1;
    let lastChanged = -1;
    const maxLines = Math.max(newLines.length, this.previousLines.length);

    for (let i = 0; i < maxLines; i++) {
      const oldLine = i < this.previousLines.length ? this.previousLines[i] : "";
      const newLine = i < newLines.length ? newLines[i] : "";
      if (oldLine !== newLine) {
        if (firstChanged === -1) firstChanged = i;
        lastChanged = i;
      }
    }

    const appendedLines = newLines.length > this.previousLines.length;
    if (appendedLines) {
      if (firstChanged === -1) firstChanged = this.previousLines.length;
      lastChanged = newLines.length - 1;
    }

    const appendStart =
      appendedLines &&
      firstChanged === this.previousLines.length &&
      firstChanged > 0;

    // No changes
    if (firstChanged === -1) {
      this.positionHardwareCursor(cursorPos, newLines.length);
      this.previousViewportTop = Math.max(0, this.maxLinesRendered - height);
      this.previousHeight = height;
      return;
    }

    // All changes are in deleted lines
    if (firstChanged >= newLines.length) {
      if (this.previousLines.length > newLines.length) {
        let buffer = "\x1b[?2026h";
        const targetRow = Math.max(0, newLines.length - 1);
        const lineDiff = computeLineDiff(targetRow);
        if (lineDiff > 0) buffer += `\x1b[${lineDiff}B`;
        else if (lineDiff < 0) buffer += `\x1b[${-lineDiff}A`;
        buffer += "\r";

        const extraLines = this.previousLines.length - newLines.length;
        if (extraLines > height) {
          logRedraw(`extraLines > height (${extraLines} > ${height})`);
          fullRender(true);
          return;
        }

        if (extraLines > 0) buffer += "\x1b[1B";
        for (let i = 0; i < extraLines; i++) {
          buffer += "\r\x1b[2K";
          if (i < extraLines - 1) buffer += "\x1b[1B";
        }
        if (extraLines > 0) buffer += `\x1b[${extraLines}A`;

        buffer += "\x1b[?2026l";
        this.terminal.write(buffer);
        this.cursorRow = targetRow;
        this.hardwareCursorRow = targetRow;
      }
      this.positionHardwareCursor(cursorPos, newLines.length);
      this.previousLines = newLines;
      this.previousWidth = width;
      this.previousHeight = height;
      this.previousViewportTop = Math.max(0, this.maxLinesRendered - height);
      return;
    }

    // Check if firstChanged is above previous viewport
    const previousContentViewportTop = Math.max(
      0,
      this.previousLines.length - height,
    );
    if (firstChanged < previousContentViewportTop) {
      logRedraw(
        `firstChanged < viewportTop (${firstChanged} < ${previousContentViewportTop})`,
      );
      fullRender(true);
      return;
    }

    // ── Build differential update buffer ──────────────────────────────

    let buffer = "\x1b[?2026h";
    const prevViewportBottom = prevViewportTop + height - 1;
    const moveTargetRow = appendStart ? firstChanged - 1 : firstChanged;

    if (moveTargetRow > prevViewportBottom) {
      const currentScreenRow = Math.max(
        0,
        Math.min(height - 1, hardwareCursorRow - prevViewportTop),
      );
      const moveToBottom = height - 1 - currentScreenRow;
      if (moveToBottom > 0) buffer += `\x1b[${moveToBottom}B`;

      const scroll = moveTargetRow - prevViewportBottom;
      buffer += "\r\n".repeat(scroll);
      prevViewportTop += scroll;
      viewportTop += scroll;
      hardwareCursorRow = moveTargetRow;
    }

    const lineDiff = computeLineDiff(moveTargetRow);
    if (lineDiff > 0) {
      buffer += `\x1b[${lineDiff}B`;
    } else if (lineDiff < 0) {
      buffer += `\x1b[${-lineDiff}A`;
    }
    buffer += appendStart ? "\r\n" : "\r";

    const renderEnd = Math.min(lastChanged, newLines.length - 1);
    for (let i = firstChanged; i <= renderEnd; i++) {
      if (i > firstChanged) buffer += "\r\n";
      buffer += "\x1b[2K";
      let line = newLines[i]!;
      const isImage = isImageLine(line);
      if (!isImage && visibleWidth(line) > width) {
        line = truncateToWidth(line, width);
      }
      buffer += line;
    }

    let finalCursorRow = renderEnd;

    // Clear extra lines if content shrunk
    if (this.previousLines.length > newLines.length) {
      if (renderEnd < newLines.length - 1) {
        const moveDown = newLines.length - 1 - renderEnd;
        buffer += `\x1b[${moveDown}B`;
        finalCursorRow = newLines.length - 1;
      }
      const extraLines = this.previousLines.length - newLines.length;
      for (let i = newLines.length; i < this.previousLines.length; i++) {
        buffer += "\r\n\x1b[2K";
      }
      buffer += `\x1b[${extraLines}A`;
    }

    buffer += "\x1b[?2026l";

    // Debug log
    if (process.env.PI_TUI_DEBUG === "1") {
      const debugDir = path.join(os.tmpdir(), "tui");
      fs.mkdirSync(debugDir, { recursive: true });
      const debugPath = path.join(
        debugDir,
        `render-${Date.now()}-${Math.random().toString(36).slice(2)}.log`,
      );
      const debugData = [
        `firstChanged: ${firstChanged}`,
        `viewportTop: ${viewportTop}`,
        `cursorRow: ${this.cursorRow}`,
        `height: ${height}`,
        `lineDiff: ${lineDiff}`,
        `hardwareCursorRow: ${hardwareCursorRow}`,
        `renderEnd: ${renderEnd}`,
        `finalCursorRow: ${finalCursorRow}`,
        `cursorPos: ${JSON.stringify(cursorPos)}`,
        `newLines.length: ${newLines.length}`,
        `previousLines.length: ${this.previousLines.length}`,
        "",
        "=== newLines ===",
        JSON.stringify(newLines, null, 2),
        "",
        "=== previousLines ===",
        JSON.stringify(this.previousLines, null, 2),
        "",
        "=== buffer ===",
        JSON.stringify(buffer),
      ].join("\n");
      fs.writeFileSync(debugPath, debugData);
    }

    // Write entire buffer at once
    this.terminal.write(buffer);

    this.cursorRow = Math.max(0, newLines.length - 1);
    this.hardwareCursorRow = finalCursorRow;
    this.maxLinesRendered = Math.max(this.maxLinesRendered, newLines.length);
    this.previousViewportTop = Math.max(0, this.maxLinesRendered - height);

    this.positionHardwareCursor(cursorPos, newLines.length);
    this.previousLines = newLines;
    this.previousWidth = width;
    this.previousHeight = height;
  }

  // ── Hardware cursor positioning ─────────────────────────────────────────

  private positionHardwareCursor(
    cursorPos: { row: number; col: number } | null,
    totalLines: number,
  ): void {
    if (!cursorPos || totalLines <= 0) {
      this.terminal.hideCursor();
      return;
    }

    const targetRow = Math.max(0, Math.min(cursorPos.row, totalLines - 1));
    const targetCol = Math.max(0, cursorPos.col);

    const rowDelta = targetRow - this.hardwareCursorRow;
    let buffer = "";
    if (rowDelta > 0) {
      buffer += `\x1b[${rowDelta}B`;
    } else if (rowDelta < 0) {
      buffer += `\x1b[${-rowDelta}A`;
    }
    buffer += `\x1b[${targetCol + 1}G`;

    if (buffer) this.terminal.write(buffer);
    this.hardwareCursorRow = targetRow;

    if (this.showHardwareCursor) {
      this.terminal.showCursor();
    } else {
      this.terminal.hideCursor();
    }
  }
}
