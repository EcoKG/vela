/**
 * ProcessTerminal — raw terminal I/O for the TUI.
 *
 * Manages raw mode, stdin buffering (via StdinBuffer), Kitty keyboard protocol
 * detection, bracketed paste, resize events, and Windows VT input.
 * Ported from pi-tui terminal.js.
 */

import * as fs from "node:fs";
import { createRequire } from "node:module";
import { setKittyProtocolActive } from "./keys.js";
import { StdinBuffer } from "./stdin-buffer.js";

const cjsRequire = createRequire(import.meta.url);

/** Handles for Windows console mode manipulation (cached across calls). */
interface VtHandles {
  GetConsoleMode: (handle: unknown, mode: Uint32Array) => boolean;
  SetConsoleMode: (handle: unknown, mode: number) => boolean;
  handle: unknown;
}

/**
 * Real terminal backed by process.stdin / process.stdout.
 *
 * Lifecycle: construct → start(onInput, onResize) → … → drainInput() → stop()
 */
export class ProcessTerminal {
  private wasRaw = false;
  private _kittyProtocolActive = false;
  private _modifyOtherKeysActive = false;
  private writeLogPath: string = process.env.PI_TUI_WRITE_LOG || "";

  private inputHandler: ((data: string) => void) | undefined;
  private resizeHandler: (() => void) | undefined;
  private stdinBuffer: StdinBuffer | undefined;
  private stdinDataHandler: ((data: string) => void) | undefined;

  private static _vtHandles: VtHandles | null = null;

  get kittyProtocolActive(): boolean {
    return this._kittyProtocolActive;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  start(onInput: (data: string) => void, onResize: () => void): void {
    this.inputHandler = onInput;
    this.resizeHandler = onResize;

    // Save previous state and enable raw mode
    this.wasRaw = process.stdin.isRaw || false;
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(true);
    }
    process.stdin.setEncoding("utf8");
    process.stdin.resume();

    // Enable bracketed paste mode
    process.stdout.write("\x1b[?2004h");

    // Resize handler
    process.stdout.on("resize", this.resizeHandler);

    // Refresh terminal dimensions — they may be stale after suspend/resume
    if (process.platform !== "win32") {
      process.kill(process.pid, "SIGWINCH");
    }

    // Windows VT input so console sends escape sequences
    this.enableWindowsVTInput();

    // Query + enable Kitty keyboard protocol
    this.queryAndEnableKittyProtocol();
  }

  /**
   * Drain remaining stdin data before stopping.
   * Disables Kitty/modifyOtherKeys, discards input for up to `maxMs`.
   */
  async drainInput(maxMs = 1000, idleMs = 50): Promise<void> {
    if (this._kittyProtocolActive) {
      process.stdout.write("\x1b[<u");
      this._kittyProtocolActive = false;
      setKittyProtocolActive(false);
    }
    if (this._modifyOtherKeysActive) {
      process.stdout.write("\x1b[>4;0m");
      this._modifyOtherKeysActive = false;
    }

    const previousHandler = this.inputHandler;
    this.inputHandler = undefined;

    let lastDataTime = Date.now();
    const onData = () => {
      lastDataTime = Date.now();
    };
    process.stdin.on("data", onData);

    const endTime = Date.now() + maxMs;
    try {
      while (true) {
        const now = Date.now();
        if (endTime - now <= 0) break;
        if (now - lastDataTime >= idleMs) break;
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(idleMs, endTime - now)),
        );
      }
    } finally {
      process.stdin.removeListener("data", onData);
      this.inputHandler = previousHandler;
    }
  }

  stop(): void {
    // Disable bracketed paste
    process.stdout.write("\x1b[?2004l");

    // Disable Kitty if not already done by drainInput()
    if (this._kittyProtocolActive) {
      process.stdout.write("\x1b[<u");
      this._kittyProtocolActive = false;
      setKittyProtocolActive(false);
    }
    if (this._modifyOtherKeysActive) {
      process.stdout.write("\x1b[>4;0m");
      this._modifyOtherKeysActive = false;
    }

    // Clean up StdinBuffer
    if (this.stdinBuffer) {
      this.stdinBuffer.destroy();
      this.stdinBuffer = undefined;
    }

    // Remove event handlers
    if (this.stdinDataHandler) {
      process.stdin.removeListener("data", this.stdinDataHandler);
      this.stdinDataHandler = undefined;
    }
    this.inputHandler = undefined;
    if (this.resizeHandler) {
      process.stdout.removeListener("resize", this.resizeHandler);
      this.resizeHandler = undefined;
    }

    // Pause stdin to prevent buffered Ctrl+D from closing parent shell
    process.stdin.pause();

    // Restore raw mode state
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(this.wasRaw);
    }
  }

  // ── Output ────────────────────────────────────────────────────────────────

  write(data: string): void {
    process.stdout.write(data);
    if (this.writeLogPath) {
      try {
        fs.appendFileSync(this.writeLogPath, data, { encoding: "utf8" });
      } catch {
        // Ignore logging errors
      }
    }
  }

  // ── Dimensions ────────────────────────────────────────────────────────────

  get columns(): number {
    return process.stdout.columns || 80;
  }

  get rows(): number {
    return process.stdout.rows || 24;
  }

  // ── Cursor / screen ──────────────────────────────────────────────────────

  moveBy(lines: number): void {
    if (lines > 0) {
      process.stdout.write(`\x1b[${lines}B`);
    } else if (lines < 0) {
      process.stdout.write(`\x1b[${-lines}A`);
    }
  }

  hideCursor(): void {
    process.stdout.write("\x1b[?25l");
  }

  showCursor(): void {
    process.stdout.write("\x1b[?25h");
  }

  clearLine(): void {
    process.stdout.write("\x1b[K");
  }

  clearFromCursor(): void {
    process.stdout.write("\x1b[J");
  }

  clearScreen(): void {
    process.stdout.write("\x1b[2J\x1b[H");
  }

  setTitle(title: string): void {
    process.stdout.write(`\x1b]0;${title}\x07`);
  }

  // ── Internal: Kitty protocol ─────────────────────────────────────────────

  /**
   * Set up StdinBuffer to split batched input into individual sequences,
   * then query for Kitty protocol support.
   */
  private queryAndEnableKittyProtocol(): void {
    this.setupStdinBuffer();
    process.stdin.on("data", this.stdinDataHandler!);
    // Query current Kitty flags
    process.stdout.write("\x1b[?u");

    // Fallback to xterm modifyOtherKeys if no Kitty response
    setTimeout(() => {
      if (!this._kittyProtocolActive && !this._modifyOtherKeysActive) {
        process.stdout.write("\x1b[>4;2m");
        this._modifyOtherKeysActive = true;
      }
    }, 150);
  }

  private setupStdinBuffer(): void {
    this.stdinBuffer = new StdinBuffer({ timeout: 50 });

    const kittyResponsePattern = /^\x1b\[\?(\d+)u$/;

    this.stdinBuffer.on("data", (sequence: string) => {
      if (!this._kittyProtocolActive) {
        const match = sequence.match(kittyResponsePattern);
        if (match) {
          this._kittyProtocolActive = true;
          setKittyProtocolActive(true);
          // Push Kitty flags: disambiguate(1) + event types(2) + alternate keys(4)
          process.stdout.write("\x1b[>7u");
          return;
        }
      }
      if (this.inputHandler) {
        this.inputHandler(sequence);
      }
    });

    this.stdinBuffer.on("paste", (content: string) => {
      if (this.inputHandler) {
        this.inputHandler(`\x1b[200~${content}\x1b[201~`);
      }
    });

    this.stdinDataHandler = (data: string) => {
      this.stdinBuffer!.process(data);
    };
  }

  // ── Internal: Windows VT input ───────────────────────────────────────────

  private enableWindowsVTInput(): void {
    if (process.platform !== "win32") return;
    try {
      if (!ProcessTerminal._vtHandles) {
        const koffi = cjsRequire("koffi");
        const k32 = koffi.load("kernel32.dll");
        const GetStdHandle = k32.func("void* __stdcall GetStdHandle(int)");
        const GetConsoleMode = k32.func(
          "bool __stdcall GetConsoleMode(void*, _Out_ uint32_t*)",
        );
        const SetConsoleMode = k32.func(
          "bool __stdcall SetConsoleMode(void*, uint32_t)",
        );
        const STD_INPUT_HANDLE = -10;
        const handle = GetStdHandle(STD_INPUT_HANDLE);
        ProcessTerminal._vtHandles = { GetConsoleMode, SetConsoleMode, handle };
      }
      const ENABLE_VIRTUAL_TERMINAL_INPUT = 0x0200;
      const { GetConsoleMode, SetConsoleMode, handle } =
        ProcessTerminal._vtHandles;
      const mode = new Uint32Array(1);
      GetConsoleMode(handle, mode);
      if (!(mode[0]! & ENABLE_VIRTUAL_TERMINAL_INPUT)) {
        SetConsoleMode(handle, mode[0]! | ENABLE_VIRTUAL_TERMINAL_INPUT);
      }
    } catch {
      // koffi not available — Shift+Tab won't be distinguishable from Tab
    }
  }
}
