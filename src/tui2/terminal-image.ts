/**
 * Terminal image support: capability detection, Kitty/iTerm2 image protocols,
 * dimension parsing via image-size, and escape sequence detection.
 *
 * Follows pi-tui terminal-image.ts surface — exports are backward compatible
 * with S01 stub (isImageLine, getCapabilities, setCellDimensions).
 */

import { imageSize } from "image-size";

// ── Types ──────────────────────────────────────────────────────────────────

export type ImageProtocol = "kitty" | "iterm2" | null;

export interface TerminalCapabilities {
  images: ImageProtocol;
  trueColor: boolean;
  hyperlinks: boolean;
}

export interface CellDimensions {
  widthPx: number;
  heightPx: number;
}

export interface ImageDimensions {
  widthPx: number;
  heightPx: number;
}

export interface ImageRenderOptions {
  maxWidthCells?: number;
  maxHeightCells?: number;
  preserveAspectRatio?: boolean;
  /** Kitty image ID. If provided, reuses/replaces existing image with this ID. */
  imageId?: number;
}

// ── Module State ───────────────────────────────────────────────────────────

let cachedCapabilities: TerminalCapabilities | null = null;

/** Default cell dimensions — updated by TUI when terminal responds to query */
let cellDimensions: CellDimensions = { widthPx: 9, heightPx: 18 };

// ── Cell Dimensions ────────────────────────────────────────────────────────

export function getCellDimensions(): CellDimensions {
  return cellDimensions;
}

export function setCellDimensions(dims: CellDimensions): void {
  cellDimensions = dims;
}

// ── Capability Detection ───────────────────────────────────────────────────

export function detectCapabilities(): TerminalCapabilities {
  const termProgram = process.env.TERM_PROGRAM?.toLowerCase() || "";
  const term = process.env.TERM?.toLowerCase() || "";
  const colorTerm = process.env.COLORTERM?.toLowerCase() || "";

  // Kitty
  if (process.env.KITTY_WINDOW_ID || termProgram === "kitty") {
    return { images: "kitty", trueColor: true, hyperlinks: true };
  }

  // Ghostty (supports Kitty protocol)
  if (
    termProgram === "ghostty" ||
    term.includes("ghostty") ||
    process.env.GHOSTTY_RESOURCES_DIR
  ) {
    return { images: "kitty", trueColor: true, hyperlinks: true };
  }

  // WezTerm (supports Kitty protocol)
  if (process.env.WEZTERM_PANE || termProgram === "wezterm") {
    return { images: "kitty", trueColor: true, hyperlinks: true };
  }

  // iTerm2
  if (process.env.ITERM_SESSION_ID || termProgram === "iterm.app") {
    return { images: "iterm2", trueColor: true, hyperlinks: true };
  }

  // VS Code terminal — no image support
  if (termProgram === "vscode") {
    return { images: null, trueColor: true, hyperlinks: true };
  }

  // Alacritty — no image support
  if (termProgram === "alacritty") {
    return { images: null, trueColor: true, hyperlinks: true };
  }

  const trueColor = colorTerm === "truecolor" || colorTerm === "24bit";
  return { images: null, trueColor, hyperlinks: true };
}

export function getCapabilities(): TerminalCapabilities {
  if (!cachedCapabilities) {
    cachedCapabilities = detectCapabilities();
  }
  return cachedCapabilities;
}

export function resetCapabilitiesCache(): void {
  cachedCapabilities = null;
}

// ── Image Line Detection ───────────────────────────────────────────────────

const KITTY_PREFIX = "\x1b_G";
const ITERM2_PREFIX = "\x1b]1337;File=";

/**
 * Check if a line contains an inline terminal image escape sequence.
 * Called per-line per-frame — kept fast with startsWith fast path.
 */
export function isImageLine(line: string): boolean {
  // Fast path: sequence at line start (single-row images)
  if (line.startsWith(KITTY_PREFIX) || line.startsWith(ITERM2_PREFIX)) {
    return true;
  }
  // Slow path: sequence elsewhere (multi-row images have cursor-up prefix)
  return line.includes(KITTY_PREFIX) || line.includes(ITERM2_PREFIX);
}

// ── Kitty Image ID ─────────────────────────────────────────────────────────

/**
 * Generate a random image ID for Kitty graphics protocol.
 * Range [1, 0xffffffff] to avoid collisions between module instances.
 */
export function allocateImageId(): number {
  return Math.floor(Math.random() * 0xfffffffe) + 1;
}

/**
 * Delete a Kitty graphics image by ID.
 * Uses uppercase 'I' to also free the image data.
 */
export function deleteKittyImage(imageId: number): string {
  return `\x1b_Ga=d,d=I,i=${imageId}\x1b\\`;
}

// ── Kitty Encoding ─────────────────────────────────────────────────────────

/**
 * Encode image data as a Kitty graphics protocol sequence.
 * Large payloads are chunked at 4096-byte boundaries per the protocol spec.
 */
export function encodeKitty(
  base64Data: string,
  options: {
    columns?: number;
    rows?: number;
    imageId?: number;
  } = {},
): string {
  const CHUNK_SIZE = 4096;

  const params: string[] = ["a=T", "f=100", "q=2"];

  if (options.columns) params.push(`c=${options.columns}`);
  if (options.rows) params.push(`r=${options.rows}`);
  if (options.imageId) params.push(`i=${options.imageId}`);

  if (base64Data.length <= CHUNK_SIZE) {
    return `\x1b_G${params.join(",")};${base64Data}\x1b\\`;
  }

  const chunks: string[] = [];
  let offset = 0;
  let isFirst = true;

  while (offset < base64Data.length) {
    const chunk = base64Data.slice(offset, offset + CHUNK_SIZE);
    const isLast = offset + CHUNK_SIZE >= base64Data.length;

    if (isFirst) {
      chunks.push(`\x1b_G${params.join(",")},m=1;${chunk}\x1b\\`);
      isFirst = false;
    } else if (isLast) {
      chunks.push(`\x1b_Gm=0;${chunk}\x1b\\`);
    } else {
      chunks.push(`\x1b_Gm=1;${chunk}\x1b\\`);
    }

    offset += CHUNK_SIZE;
  }

  return chunks.join("");
}

// ── iTerm2 Encoding ────────────────────────────────────────────────────────

/**
 * Encode image data as an iTerm2 inline image escape sequence.
 */
export function encodeITerm2(
  base64Data: string,
  options: {
    width?: number | string;
    height?: number | string;
    name?: string;
    preserveAspectRatio?: boolean;
    inline?: boolean;
  } = {},
): string {
  const params: string[] = [`inline=${options.inline !== false ? 1 : 0}`];

  if (options.width !== undefined) params.push(`width=${options.width}`);
  if (options.height !== undefined) params.push(`height=${options.height}`);
  if (options.name) {
    const nameBase64 = Buffer.from(options.name).toString("base64");
    params.push(`name=${nameBase64}`);
  }
  if (options.preserveAspectRatio === false) {
    params.push("preserveAspectRatio=0");
  }

  return `\x1b]1337;File=${params.join(";")}:${base64Data}\x07`;
}

// ── Dimension Parsing ──────────────────────────────────────────────────────

/**
 * Calculate how many terminal rows an image occupies at a given cell width.
 */
export function calculateImageRows(
  imageDimensions: ImageDimensions,
  targetWidthCells: number,
  cells: CellDimensions = { widthPx: 9, heightPx: 18 },
): number {
  const targetWidthPx = targetWidthCells * cells.widthPx;
  const scale = targetWidthPx / imageDimensions.widthPx;
  const scaledHeightPx = imageDimensions.heightPx * scale;
  const rows = Math.ceil(scaledHeightPx / cells.heightPx);
  return Math.max(1, rows);
}

/**
 * Parse image dimensions from a base64-encoded image buffer.
 * Uses `image-size` synchronous API wrapped in async for interface
 * compatibility with the pi-tui pattern.
 * Supports PNG, JPEG, GIF, WebP, BMP, TIFF, ICO, SVG.
 */
export async function getImageDimensions(
  base64Data: string,
): Promise<ImageDimensions | null> {
  try {
    const buffer = Buffer.from(base64Data, "base64");
    const bytes = new Uint8Array(buffer);
    const result = imageSize(bytes);
    if (result.width && result.height) {
      return { widthPx: result.width, heightPx: result.height };
    }
    return null;
  } catch {
    return null;
  }
}

// ── Render ──────────────────────────────────────────────────────────────────

/**
 * Render an image as a terminal escape sequence using the detected protocol.
 * Returns null when no image protocol is available.
 */
export function renderImage(
  base64Data: string,
  imageDimensions: ImageDimensions,
  options: ImageRenderOptions = {},
): { sequence: string; rows: number; imageId?: number } | null {
  const caps = getCapabilities();

  if (!caps.images) {
    return null;
  }

  const maxWidth = options.maxWidthCells ?? 80;
  const rows = calculateImageRows(imageDimensions, maxWidth, getCellDimensions());

  if (caps.images === "kitty") {
    const sequence = encodeKitty(base64Data, {
      columns: maxWidth,
      rows,
      imageId: options.imageId,
    });
    return { sequence, rows, imageId: options.imageId };
  }

  if (caps.images === "iterm2") {
    const sequence = encodeITerm2(base64Data, {
      width: maxWidth,
      height: "auto",
      preserveAspectRatio: options.preserveAspectRatio ?? true,
    });
    return { sequence, rows };
  }

  return null;
}

/**
 * Generate a text fallback for unsupported terminals.
 */
export function imageFallback(
  mimeType: string,
  dimensions?: ImageDimensions,
  filename?: string,
): string {
  const parts: string[] = [];
  if (filename) parts.push(filename);
  parts.push(`[${mimeType}]`);
  if (dimensions) parts.push(`${dimensions.widthPx}x${dimensions.heightPx}`);
  return `[Image: ${parts.join(" ")}]`;
}
