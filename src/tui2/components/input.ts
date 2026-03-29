import { getEditorKeybindings } from "../keybindings.js";
import { decodeKittyPrintable } from "../keys.js";
import { KillRing } from "../kill-ring.js";
import { CURSOR_MARKER } from "../tui.js";
import { UndoStack } from "../undo-stack.js";
import {
  getSegmenter,
  isPunctuationChar,
  isWhitespaceChar,
  visibleWidth,
} from "../utils.js";

const segmenter = getSegmenter();

interface UndoSnapshot {
  value: string;
  cursor: number;
}

/**
 * Input component — single-line text input with horizontal scrolling,
 * grapheme-aware cursor/word movement, kill ring, undo, and bracketed paste.
 */
export class Input {
  value = "";
  cursor = 0;
  placeholder = "";

  /** Configurable prompt string (may contain ANSI escapes). */
  private promptText = "> ";

  /** Focusable interface — set by TUI when focus changes */
  _focused = false;

  // Bracketed paste buffering
  private pasteBuffer = "";
  private isInPaste = false;

  // Kill ring for Emacs-style kill/yank
  private killRing = new KillRing();
  private lastAction: string | null = null;

  // Undo support
  private undoStack = new UndoStack<UndoSnapshot>();

  // External callbacks
  onSubmit?: (value: string) => void;
  onEscape?: () => void;

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    if (!value) {
      this.isInPaste = false;
      this.pasteBuffer = "";
    }
  }

  getValue(): string {
    return this.value;
  }

  setValue(value: string): void {
    this.value = value;
    this.cursor = Math.min(this.cursor, value.length);
  }

  /**
   * Set the prompt string displayed before user input.
   * May contain ANSI escape codes — width is computed via visibleWidth().
   */
  setPrompt(text: string): void {
    this.promptText = text;
  }

  /** Get the current prompt string. */
  getPrompt(): string {
    return this.promptText;
  }

  handleInput(data: string): void {
    // ── Bracketed paste mode ──────────────────────────────────────────
    if (data.includes("\x1b[200~")) {
      this.isInPaste = true;
      this.pasteBuffer = "";
      data = data.replace("\x1b[200~", "");
    }

    if (this.isInPaste) {
      this.pasteBuffer += data;
      const endIndex = this.pasteBuffer.indexOf("\x1b[201~");
      if (endIndex !== -1) {
        const pasteContent = this.pasteBuffer.substring(0, endIndex);
        this.handlePaste(pasteContent);
        this.isInPaste = false;
        const remaining = this.pasteBuffer.substring(endIndex + 6);
        this.pasteBuffer = "";
        if (remaining) {
          this.handleInput(remaining);
        }
      }
      return;
    }

    const kb = getEditorKeybindings();

    // Escape / Cancel
    if (kb.matches(data, "selectCancel")) {
      this.onEscape?.();
      return;
    }

    // Undo
    if (kb.matches(data, "undo")) {
      this.undo();
      return;
    }

    // Submit
    if (kb.matches(data, "submit") || data === "\n") {
      this.onSubmit?.(this.value);
      return;
    }

    // Deletion
    if (kb.matches(data, "deleteCharBackward")) {
      this.handleBackspace();
      return;
    }
    if (kb.matches(data, "deleteCharForward")) {
      this.handleForwardDelete();
      return;
    }
    if (kb.matches(data, "deleteWordBackward")) {
      this.deleteWordBackwards();
      return;
    }
    if (kb.matches(data, "deleteWordForward")) {
      this.deleteWordForward();
      return;
    }
    if (kb.matches(data, "deleteToLineStart")) {
      this.deleteToLineStart();
      return;
    }
    if (kb.matches(data, "deleteToLineEnd")) {
      this.deleteToLineEnd();
      return;
    }

    // Kill ring
    if (kb.matches(data, "yank")) {
      this.yank();
      return;
    }
    if (kb.matches(data, "yankPop")) {
      this.yankPop();
      return;
    }

    // Cursor movement
    if (kb.matches(data, "cursorLeft")) {
      this.lastAction = null;
      if (this.cursor > 0) {
        const beforeCursor = this.value.slice(0, this.cursor);
        const graphemes = [...segmenter.segment(beforeCursor)];
        const lastGrapheme = graphemes[graphemes.length - 1];
        this.cursor -= lastGrapheme ? lastGrapheme.segment.length : 1;
      }
      return;
    }
    if (kb.matches(data, "cursorRight")) {
      this.lastAction = null;
      if (this.cursor < this.value.length) {
        const afterCursor = this.value.slice(this.cursor);
        const graphemes = [...segmenter.segment(afterCursor)];
        const firstGrapheme = graphemes[0];
        this.cursor += firstGrapheme ? firstGrapheme.segment.length : 1;
      }
      return;
    }
    if (kb.matches(data, "cursorLineStart")) {
      this.lastAction = null;
      this.cursor = 0;
      return;
    }
    if (kb.matches(data, "cursorLineEnd")) {
      this.lastAction = null;
      this.cursor = this.value.length;
      return;
    }
    if (kb.matches(data, "cursorWordLeft")) {
      this.moveWordBackwards();
      return;
    }
    if (kb.matches(data, "cursorWordRight")) {
      this.moveWordForwards();
      return;
    }

    // Kitty CSI-u printable character
    const kittyPrintable = decodeKittyPrintable(data);
    if (kittyPrintable !== undefined) {
      this.insertCharacter(kittyPrintable);
      return;
    }

    // Regular printable characters — reject control chars
    const hasControlChars = [...data].some((ch) => {
      const code = ch.charCodeAt(0);
      return code < 32 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
    });
    if (!hasControlChars) {
      this.insertCharacter(data);
    }
  }

  // ── Character insertion ───────────────────────────────────────────────

  private insertCharacter(char: string): void {
    if (isWhitespaceChar(char) || this.lastAction !== "type-word") {
      this.pushUndo();
    }
    this.lastAction = "type-word";
    this.value =
      this.value.slice(0, this.cursor) + char + this.value.slice(this.cursor);
    this.cursor += char.length;
  }

  // ── Backspace / forward-delete ────────────────────────────────────────

  private handleBackspace(): void {
    this.lastAction = null;
    if (this.cursor > 0) {
      this.pushUndo();
      const beforeCursor = this.value.slice(0, this.cursor);
      const graphemes = [...segmenter.segment(beforeCursor)];
      const lastGrapheme = graphemes[graphemes.length - 1];
      const graphemeLength = lastGrapheme ? lastGrapheme.segment.length : 1;
      this.value =
        this.value.slice(0, this.cursor - graphemeLength) +
        this.value.slice(this.cursor);
      this.cursor -= graphemeLength;
    }
  }

  private handleForwardDelete(): void {
    this.lastAction = null;
    if (this.cursor < this.value.length) {
      this.pushUndo();
      const afterCursor = this.value.slice(this.cursor);
      const graphemes = [...segmenter.segment(afterCursor)];
      const firstGrapheme = graphemes[0];
      const graphemeLength = firstGrapheme ? firstGrapheme.segment.length : 1;
      this.value =
        this.value.slice(0, this.cursor) +
        this.value.slice(this.cursor + graphemeLength);
    }
  }

  // ── Line-level kill ───────────────────────────────────────────────────

  private deleteToLineStart(): void {
    if (this.cursor === 0) return;
    this.pushUndo();
    const deletedText = this.value.slice(0, this.cursor);
    this.killRing.push(deletedText, {
      prepend: true,
      accumulate: this.lastAction === "kill",
    });
    this.lastAction = "kill";
    this.value = this.value.slice(this.cursor);
    this.cursor = 0;
  }

  private deleteToLineEnd(): void {
    if (this.cursor >= this.value.length) return;
    this.pushUndo();
    const deletedText = this.value.slice(this.cursor);
    this.killRing.push(deletedText, {
      prepend: false,
      accumulate: this.lastAction === "kill",
    });
    this.lastAction = "kill";
    this.value = this.value.slice(0, this.cursor);
  }

  // ── Word-level kill ───────────────────────────────────────────────────

  private deleteWordBackwards(): void {
    if (this.cursor === 0) return;
    const wasKill = this.lastAction === "kill";
    this.pushUndo();
    const oldCursor = this.cursor;
    this.moveWordBackwards();
    const deleteFrom = this.cursor;
    this.cursor = oldCursor;
    const deletedText = this.value.slice(deleteFrom, this.cursor);
    this.killRing.push(deletedText, { prepend: true, accumulate: wasKill });
    this.lastAction = "kill";
    this.value =
      this.value.slice(0, deleteFrom) + this.value.slice(this.cursor);
    this.cursor = deleteFrom;
  }

  private deleteWordForward(): void {
    if (this.cursor >= this.value.length) return;
    const wasKill = this.lastAction === "kill";
    this.pushUndo();
    const oldCursor = this.cursor;
    this.moveWordForwards();
    const deleteTo = this.cursor;
    this.cursor = oldCursor;
    const deletedText = this.value.slice(this.cursor, deleteTo);
    this.killRing.push(deletedText, { prepend: false, accumulate: wasKill });
    this.lastAction = "kill";
    this.value =
      this.value.slice(0, this.cursor) + this.value.slice(deleteTo);
  }

  // ── Yank / yank-pop ──────────────────────────────────────────────────

  private yank(): void {
    const text = this.killRing.peek();
    if (!text) return;
    this.pushUndo();
    this.value =
      this.value.slice(0, this.cursor) + text + this.value.slice(this.cursor);
    this.cursor += text.length;
    this.lastAction = "yank";
  }

  private yankPop(): void {
    if (this.lastAction !== "yank" || this.killRing.length <= 1) return;
    this.pushUndo();
    const prevText = this.killRing.peek() || "";
    this.value =
      this.value.slice(0, this.cursor - prevText.length) +
      this.value.slice(this.cursor);
    this.cursor -= prevText.length;
    this.killRing.rotate();
    const text = this.killRing.peek() || "";
    this.value =
      this.value.slice(0, this.cursor) + text + this.value.slice(this.cursor);
    this.cursor += text.length;
    this.lastAction = "yank";
  }

  // ── Undo ──────────────────────────────────────────────────────────────

  private pushUndo(): void {
    this.undoStack.push({ value: this.value, cursor: this.cursor });
  }

  private undo(): void {
    const snapshot = this.undoStack.pop();
    if (!snapshot) return;
    this.value = snapshot.value;
    this.cursor = snapshot.cursor;
    this.lastAction = null;
  }

  // ── Word movement ─────────────────────────────────────────────────────

  private moveWordBackwards(): void {
    if (this.cursor === 0) return;
    this.lastAction = null;

    const textBeforeCursor = this.value.slice(0, this.cursor);
    const graphemes = [...segmenter.segment(textBeforeCursor)];

    // Skip trailing whitespace
    while (
      graphemes.length > 0 &&
      isWhitespaceChar(graphemes[graphemes.length - 1]?.segment || "")
    ) {
      this.cursor -= graphemes.pop()?.segment.length || 0;
    }

    if (graphemes.length > 0) {
      const lastGrapheme = graphemes[graphemes.length - 1]?.segment || "";
      if (isPunctuationChar(lastGrapheme)) {
        while (
          graphemes.length > 0 &&
          isPunctuationChar(graphemes[graphemes.length - 1]?.segment || "")
        ) {
          this.cursor -= graphemes.pop()?.segment.length || 0;
        }
      } else {
        while (
          graphemes.length > 0 &&
          !isWhitespaceChar(graphemes[graphemes.length - 1]?.segment || "") &&
          !isPunctuationChar(graphemes[graphemes.length - 1]?.segment || "")
        ) {
          this.cursor -= graphemes.pop()?.segment.length || 0;
        }
      }
    }
  }

  private moveWordForwards(): void {
    if (this.cursor >= this.value.length) return;
    this.lastAction = null;

    const textAfterCursor = this.value.slice(this.cursor);
    const segments = segmenter.segment(textAfterCursor);
    const iterator = segments[Symbol.iterator]();
    let next = iterator.next();

    // Skip leading whitespace
    while (!next.done && isWhitespaceChar(next.value.segment)) {
      this.cursor += next.value.segment.length;
      next = iterator.next();
    }

    if (!next.done) {
      const firstGrapheme = next.value.segment;
      if (isPunctuationChar(firstGrapheme)) {
        while (!next.done && isPunctuationChar(next.value.segment)) {
          this.cursor += next.value.segment.length;
          next = iterator.next();
        }
      } else {
        while (
          !next.done &&
          !isWhitespaceChar(next.value.segment) &&
          !isPunctuationChar(next.value.segment)
        ) {
          this.cursor += next.value.segment.length;
          next = iterator.next();
        }
      }
    }
  }

  // ── Paste handling ────────────────────────────────────────────────────

  private handlePaste(pastedText: string): void {
    this.lastAction = null;
    this.pushUndo();
    const cleanText = pastedText
      .replace(/\r\n/g, "")
      .replace(/\r/g, "")
      .replace(/\n/g, "");
    this.value =
      this.value.slice(0, this.cursor) +
      cleanText +
      this.value.slice(this.cursor);
    this.cursor += cleanText.length;
  }

  // ── Renderable interface ──────────────────────────────────────────────

  invalidate(): void {
    // No cached state to invalidate
  }

  render(width: number): string[] {
    const prompt = this.promptText;
    const availableWidth = width - visibleWidth(prompt);

    if (availableWidth <= 0) {
      return [prompt];
    }

    // Placeholder when value is empty
    if (this.value === "" && this.placeholder) {
      const placeholderText = this.placeholder.slice(0, availableWidth - 1);
      const marker = this.focused ? CURSOR_MARKER : "";
      const cursorChar = "\x1b[7m \x1b[27m";
      const dimPlaceholder = `\x1b[2m${placeholderText}\x1b[22m`;
      const padding = " ".repeat(
        Math.max(0, availableWidth - visibleWidth(placeholderText) - 1),
      );
      return [prompt + marker + cursorChar + dimPlaceholder + padding];
    }

    let visibleText = "";
    let cursorDisplay = this.cursor;

    if (this.value.length < availableWidth) {
      visibleText = this.value;
    } else {
      // Horizontal scrolling
      const scrollWidth =
        this.cursor === this.value.length
          ? availableWidth - 1
          : availableWidth;
      const halfWidth = Math.floor(scrollWidth / 2);

      const findValidStart = (start: number): number => {
        while (start < this.value.length) {
          const charCode = this.value.charCodeAt(start);
          if (charCode >= 0xdc00 && charCode < 0xe000) {
            start++;
            continue;
          }
          break;
        }
        return start;
      };

      const findValidEnd = (end: number): number => {
        while (end > 0) {
          const charCode = this.value.charCodeAt(end - 1);
          if (charCode >= 0xd800 && charCode < 0xdc00) {
            end--;
            continue;
          }
          break;
        }
        return end;
      };

      if (this.cursor < halfWidth) {
        visibleText = this.value.slice(0, findValidEnd(scrollWidth));
        cursorDisplay = this.cursor;
      } else if (this.cursor > this.value.length - halfWidth) {
        const start = findValidStart(this.value.length - scrollWidth);
        visibleText = this.value.slice(start);
        cursorDisplay = this.cursor - start;
      } else {
        const start = findValidStart(this.cursor - halfWidth);
        visibleText = this.value.slice(
          start,
          findValidEnd(start + scrollWidth),
        );
        cursorDisplay = halfWidth;
      }
    }

    // Build line with fake cursor (inverse video)
    const graphemes = [
      ...segmenter.segment(visibleText.slice(cursorDisplay)),
    ];
    const cursorGrapheme = graphemes[0];
    const beforeCursor = visibleText.slice(0, cursorDisplay);
    const atCursor = cursorGrapheme?.segment ?? " ";
    const afterCursor = visibleText.slice(cursorDisplay + atCursor.length);

    const marker = this.focused ? CURSOR_MARKER : "";
    const cursorChar = `\x1b[7m${atCursor}\x1b[27m`;
    const textWithCursor = beforeCursor + marker + cursorChar + afterCursor;

    const visualLength = visibleWidth(textWithCursor);
    const padding = " ".repeat(Math.max(0, availableWidth - visualLength));
    return [prompt + textWithCursor + padding];
  }
}
