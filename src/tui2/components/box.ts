import { applyBackgroundToLine, visibleWidth } from "../utils.js";

/** Minimal child interface — any component with render() and optional invalidate(). */
interface BoxChild {
  render(width: number): string[];
  invalidate?(): void;
}

interface BoxCache {
  childLines: string[];
  width: number;
  bgSample: string | undefined;
  lines: string[];
}

/**
 * Box component — a container that applies padding and background to children.
 */
export class Box {
  children: BoxChild[] = [];

  private paddingX: number;
  private paddingY: number;
  private bgFn?: (text: string) => string;
  private cache?: BoxCache;

  constructor(
    paddingX = 1,
    paddingY = 1,
    bgFn?: (text: string) => string,
  ) {
    this.paddingX = paddingX;
    this.paddingY = paddingY;
    this.bgFn = bgFn;
  }

  addChild(component: BoxChild): void {
    this.children.push(component);
    this.invalidateCache();
  }

  insertChildBefore(component: BoxChild, before: BoxChild): void {
    const index = this.children.indexOf(before);
    if (index !== -1) {
      this.children.splice(index, 0, component);
    } else {
      this.children.push(component);
    }
    this.invalidateCache();
  }

  removeChild(component: BoxChild): void {
    const index = this.children.indexOf(component);
    if (index !== -1) {
      this.children.splice(index, 1);
      this.invalidateCache();
    }
  }

  clear(): void {
    this.children = [];
    this.invalidateCache();
  }

  setBgFn(bgFn?: (text: string) => string): void {
    this.bgFn = bgFn;
    // Don't invalidate here — detect bgFn changes by sampling output
  }

  private invalidateCache(): void {
    this.cache = undefined;
  }

  private matchCache(
    width: number,
    childLines: string[],
    bgSample: string | undefined,
  ): boolean {
    const cache = this.cache;
    return (
      !!cache &&
      cache.width === width &&
      cache.bgSample === bgSample &&
      cache.childLines.length === childLines.length &&
      cache.childLines.every((line, i) => line === childLines[i])
    );
  }

  invalidate(): void {
    this.invalidateCache();
    for (const child of this.children) {
      child.invalidate?.();
    }
  }

  render(width: number): string[] {
    if (this.children.length === 0) {
      return [];
    }

    const contentWidth = Math.max(1, width - this.paddingX * 2);
    const leftPad = " ".repeat(this.paddingX);

    // Render all children
    const childLines: string[] = [];
    for (const child of this.children) {
      const lines = child.render(contentWidth);
      for (const line of lines) {
        childLines.push(leftPad + line);
      }
    }

    if (childLines.length === 0) {
      return [];
    }

    // Check if bgFn output changed
    const bgSample = this.bgFn ? this.bgFn("test") : undefined;

    if (this.matchCache(width, childLines, bgSample)) {
      return this.cache!.lines;
    }

    const result: string[] = [];

    // Top padding
    for (let i = 0; i < this.paddingY; i++) {
      result.push(this.applyBg("", width));
    }

    // Content
    for (const line of childLines) {
      result.push(this.applyBg(line, width));
    }

    // Bottom padding
    for (let i = 0; i < this.paddingY; i++) {
      result.push(this.applyBg("", width));
    }

    this.cache = { childLines, width, bgSample, lines: result };
    return result;
  }

  private applyBg(line: string, width: number): string {
    const visLen = visibleWidth(line);
    const padNeeded = Math.max(0, width - visLen);
    const padded = line + " ".repeat(padNeeded);

    if (this.bgFn) {
      return applyBackgroundToLine(padded, width, this.bgFn);
    }
    return padded;
  }
}
