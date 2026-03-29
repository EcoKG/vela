// ─── UI Components ──────────────────────────────────────────────────────────
export { Input } from "./components/input.js";
export { Text } from "./components/text.js";
export { Box } from "./components/box.js";
export { Spacer } from "./components/spacer.js";
export { Markdown, createMarkdownTheme } from "./components/markdown.js";
export type { MarkdownTheme, DefaultTextStyle } from "./components/markdown.js";
export { Image } from "./components/image.js";
export type { ImageTheme, ImageDisplayOptions } from "./components/image.js";
export { MessageList } from "./components/message-list.js";
export type { DisplayMessage } from "./components/message-list.js";
export { Dashboard } from "./components/dashboard.js";
export type { DashboardData } from "./components/dashboard.js";
export { HelpOverlay, SLASH_COMMANDS } from "./components/help-overlay.js";
export type { CommandDef } from "./components/help-overlay.js";

// ─── Chat Engine ────────────────────────────────────────────────────────────
export { ChatEngine } from "./chat-engine.js";
export type { ChatEngineCallbacks, ChatEngineMessage, ChatEngineOptions, ToolActivity } from "./chat-engine.js";

// ─── Core TUI ───────────────────────────────────────────────────────────────
export {
  TUI,
  Container,
  CURSOR_MARKER,
  isFocusable,
} from "./tui.js";
export type {
  Renderable,
  OverlayHandle,
  InputListener,
  InputListenerResult,
} from "./tui.js";

// ─── Terminal ───────────────────────────────────────────────────────────────
export { ProcessTerminal } from "./terminal.js";

// ─── Overlay Layout ─────────────────────────────────────────────────────────
export {
  resolveOverlayLayout,
  compositeOverlays,
  compositeLineAt,
  applyLineResets,
  extractCursorPosition,
  parseSizeValue,
  resolveAnchorRow,
  resolveAnchorCol,
  isOverlayVisible,
} from "./overlay-layout.js";
export type {
  SizeValue,
  Anchor,
  MarginSpec,
  OverlayOptions,
  OverlayComponent,
  OverlayEntry,
  ResolvedLayout,
} from "./overlay-layout.js";

// ─── Input Handling ─────────────────────────────────────────────────────────
export { StdinBuffer } from "./stdin-buffer.js";
export type { StdinBufferOptions } from "./stdin-buffer.js";

export {
  matchesKey,
  parseKey,
  isKeyRelease,
  isKeyRepeat,
  Key,
  decodeKittyPrintable,
  setKittyProtocolActive,
  isKittyProtocolActive,
} from "./keys.js";
export type { KeyId, ParsedKeyId, KittyEventType } from "./keys.js";

export {
  EditorKeybindingsManager,
  getEditorKeybindings,
  setEditorKeybindings,
  DEFAULT_EDITOR_KEYBINDINGS,
} from "./keybindings.js";
export type { KeyBinding, KeybindingConfig } from "./keybindings.js";

// ─── Utilities ──────────────────────────────────────────────────────────────
export {
  visibleWidth,
  wrapTextWithAnsi,
  truncateToWidth,
  sliceByColumn,
  sliceWithWidth,
  extractSegments,
  applyBackgroundToLine,
  getSegmenter,
  isWhitespaceChar,
  isPunctuationChar,
} from "./utils.js";
export type { SliceResult } from "./utils.js";

// ─── Kill Ring & Undo ───────────────────────────────────────────────────────
export { KillRing } from "./kill-ring.js";
export { UndoStack } from "./undo-stack.js";

// ─── Terminal Image ─────────────────────────────────────────────────────────
export {
  getCapabilities,
  detectCapabilities,
  resetCapabilitiesCache,
  getCellDimensions,
  setCellDimensions,
  isImageLine,
  allocateImageId,
  deleteKittyImage,
  encodeKitty,
  encodeITerm2,
  calculateImageRows,
  getImageDimensions,
  renderImage,
  imageFallback,
} from "./terminal-image.js";
export type {
  ImageProtocol,
  TerminalCapabilities,
  CellDimensions,
  ImageDimensions,
  ImageRenderOptions,
} from "./terminal-image.js";
