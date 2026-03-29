/**
 * Image component for tui2.
 *
 * Renders inline images using Kitty or iTerm2 terminal image protocols
 * when supported, or a styled text fallback when the terminal lacks
 * image capabilities.
 *
 * Follows the render(width) → string[] contract.
 * Uses terminal-image.ts (T01) for protocol detection, encoding, and
 * dimension parsing.
 */

import {
  getCapabilities,
  getImageDimensions,
  renderImage,
  imageFallback,
  type ImageDimensions,
} from '../terminal-image.js';
import { visibleWidth } from '../utils.js';

// ── ANSI SGR constants ──────────────────────────────────────────────────────

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const ITALIC = '\x1b[3m';

// ── Interfaces ──────────────────────────────────────────────────────────────

/** Theme for Image component styling (fallback text). */
export interface ImageTheme {
  /** Style the fallback text when images aren't supported */
  fallback: (text: string) => string;
  /** Style the filename/alt text */
  label: (text: string) => string;
}

/** Display options for Image rendering. */
export interface ImageDisplayOptions {
  /** Alt text / filename shown in fallback */
  alt?: string;
  /** MIME type hint (e.g. 'image/png') — used in fallback text */
  mimeType?: string;
  /** Maximum width in terminal cells. Defaults to available width. */
  maxWidthCells?: number;
  /** Maximum height in terminal rows. */
  maxHeightCells?: number;
  /** Preserve aspect ratio. Defaults to true. */
  preserveAspectRatio?: boolean;
}

// ── Default theme ───────────────────────────────────────────────────────────

function createDefaultImageTheme(): ImageTheme {
  return {
    fallback: (text: string) => `${DIM}${text}${RESET}`,
    label: (text: string) => `${DIM}${ITALIC}${text}${RESET}`,
  };
}

// ── Image component ─────────────────────────────────────────────────────────

/**
 * Image component — renders terminal inline images or styled fallback text.
 *
 * Constructor takes base64 image data and options. Dimensions are parsed
 * asynchronously via getImageDimensions(); the component caches the result
 * and uses it on subsequent render() calls.
 *
 * First render() triggers dimension parsing. Until dimensions resolve,
 * renders fallback text. After resolution, renders the image protocol
 * escape sequence (Kitty/iTerm2) or fallback if unsupported.
 */
export class Image {
  private base64Data: string;
  private options: ImageDisplayOptions;
  private theme: ImageTheme;

  // Async dimension state
  private dimensions: ImageDimensions | null = null;
  private dimensionsParsed = false;
  private dimensionsPromise: Promise<void> | null = null;

  // Render cache
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(
    base64Data: string,
    options: ImageDisplayOptions = {},
    theme?: ImageTheme,
  ) {
    this.base64Data = base64Data;
    this.options = options;
    this.theme = theme ?? createDefaultImageTheme();

    // Kick off async dimension parsing immediately
    this.dimensionsPromise = this.parseDimensions();
  }

  private async parseDimensions(): Promise<void> {
    const dims = await getImageDimensions(this.base64Data);
    this.dimensions = dims;
    this.dimensionsParsed = true;
    // Invalidate cache so next render picks up dimensions
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  /** Check if dimensions have been resolved. */
  isReady(): boolean {
    return this.dimensionsParsed;
  }

  /** Await dimension parsing completion. Useful for callers that want to wait. */
  async waitReady(): Promise<void> {
    if (this.dimensionsPromise) {
      await this.dimensionsPromise;
    }
  }

  setTheme(theme: ImageTheme): void {
    this.theme = theme;
    this.invalidate();
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }

    const lines = this.doRender(width);
    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  private doRender(width: number): string[] {
    // If dimensions haven't resolved yet, show fallback
    if (!this.dimensionsParsed) {
      return this.renderFallback(width);
    }

    // If dimension parsing failed, show fallback
    if (!this.dimensions) {
      return this.renderFallback(width);
    }

    // Check terminal capabilities
    const caps = getCapabilities();
    if (!caps.images) {
      return this.renderFallback(width);
    }

    // Attempt protocol rendering
    const maxWidth = this.options.maxWidthCells ?? width;
    const effectiveWidth = Math.min(maxWidth, width);

    const result = renderImage(this.base64Data, this.dimensions, {
      maxWidthCells: effectiveWidth,
      maxHeightCells: this.options.maxHeightCells,
      preserveAspectRatio: this.options.preserveAspectRatio ?? true,
    });

    if (!result) {
      return this.renderFallback(width);
    }

    // The escape sequence is a single line containing the full image data.
    // Terminal protocols handle multi-row display internally.
    const lines: string[] = [result.sequence];

    // Add alt text caption below image if provided
    if (this.options.alt) {
      const caption = this.theme.label(this.options.alt);
      lines.push(caption);
    }

    return lines;
  }

  private renderFallback(width: number): string[] {
    const alt = this.options.alt || 'image';
    const mimeType = this.options.mimeType || 'image/*';

    // Build fallback using terminal-image's imageFallback
    const fallbackText = imageFallback(
      mimeType,
      this.dimensions ?? undefined,
      alt,
    );

    const styled = this.theme.fallback(fallbackText);

    // Ensure it fits within width
    const vis = visibleWidth(styled);
    if (vis > width) {
      // Truncate label to fit
      const plain = fallbackText.slice(0, Math.max(1, width - 2)) + '…';
      return [this.theme.fallback(plain)];
    }

    return [styled];
  }
}
