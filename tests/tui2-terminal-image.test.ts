import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  detectCapabilities,
  getCapabilities,
  resetCapabilitiesCache,
  isImageLine,
  allocateImageId,
  deleteKittyImage,
  encodeKitty,
  encodeITerm2,
  calculateImageRows,
  getImageDimensions,
  renderImage,
  imageFallback,
  getCellDimensions,
  setCellDimensions,
} from "../src/tui2/terminal-image.js";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Minimal 1x1 red PNG (67 bytes) as base64 */
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAH" +
  "ggJ/PchI7wAAAABJRU5ErkJggg==";

/** Minimal 1x1 JPEG as base64 (generated with sharp) */
const TINY_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkS" +
  "Ew8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJ" +
  "CQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy" +
  "MjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAA" +
  "AAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QA" +
  "FBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AKwA//9k=";

function setEnv(overrides: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
}

function clearTermEnv(): void {
  for (const key of [
    "TERM_PROGRAM",
    "TERM",
    "COLORTERM",
    "KITTY_WINDOW_ID",
    "GHOSTTY_RESOURCES_DIR",
    "WEZTERM_PANE",
    "ITERM_SESSION_ID",
  ]) {
    delete process.env[key];
  }
}

// ── Capability Detection ───────────────────────────────────────────────────

describe("detectCapabilities", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      "TERM_PROGRAM",
      "TERM",
      "COLORTERM",
      "KITTY_WINDOW_ID",
      "GHOSTTY_RESOURCES_DIR",
      "WEZTERM_PANE",
      "ITERM_SESSION_ID",
    ]) {
      savedEnv[key] = process.env[key];
    }
    clearTermEnv();
    resetCapabilitiesCache();
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetCapabilitiesCache();
  });

  it("detects Kitty via KITTY_WINDOW_ID", () => {
    setEnv({ KITTY_WINDOW_ID: "1" });
    const caps = detectCapabilities();
    expect(caps.images).toBe("kitty");
    expect(caps.trueColor).toBe(true);
  });

  it("detects Kitty via TERM_PROGRAM=kitty", () => {
    setEnv({ TERM_PROGRAM: "kitty" });
    const caps = detectCapabilities();
    expect(caps.images).toBe("kitty");
  });

  it("detects Ghostty via GHOSTTY_RESOURCES_DIR", () => {
    setEnv({ GHOSTTY_RESOURCES_DIR: "/usr/share/ghostty" });
    const caps = detectCapabilities();
    expect(caps.images).toBe("kitty");
  });

  it("detects Ghostty via TERM_PROGRAM=ghostty", () => {
    setEnv({ TERM_PROGRAM: "ghostty" });
    const caps = detectCapabilities();
    expect(caps.images).toBe("kitty");
  });

  it("detects Ghostty via TERM containing ghostty", () => {
    setEnv({ TERM: "xterm-ghostty" });
    const caps = detectCapabilities();
    expect(caps.images).toBe("kitty");
  });

  it("detects WezTerm via WEZTERM_PANE", () => {
    setEnv({ WEZTERM_PANE: "0" });
    const caps = detectCapabilities();
    expect(caps.images).toBe("kitty");
  });

  it("detects WezTerm via TERM_PROGRAM=wezterm", () => {
    setEnv({ TERM_PROGRAM: "wezterm" });
    const caps = detectCapabilities();
    expect(caps.images).toBe("kitty");
  });

  it("detects iTerm2 via ITERM_SESSION_ID", () => {
    setEnv({ ITERM_SESSION_ID: "w0t0p0:abc123" });
    const caps = detectCapabilities();
    expect(caps.images).toBe("iterm2");
    expect(caps.trueColor).toBe(true);
  });

  it("detects iTerm2 via TERM_PROGRAM=iterm.app", () => {
    setEnv({ TERM_PROGRAM: "iTerm.app" });
    const caps = detectCapabilities();
    expect(caps.images).toBe("iterm2");
  });

  it("returns null images for VSCode", () => {
    setEnv({ TERM_PROGRAM: "vscode" });
    const caps = detectCapabilities();
    expect(caps.images).toBeNull();
    expect(caps.trueColor).toBe(true);
  });

  it("returns null images for Alacritty", () => {
    setEnv({ TERM_PROGRAM: "alacritty" });
    const caps = detectCapabilities();
    expect(caps.images).toBeNull();
    expect(caps.trueColor).toBe(true);
  });

  it("detects truecolor via COLORTERM", () => {
    setEnv({ COLORTERM: "truecolor" });
    const caps = detectCapabilities();
    expect(caps.images).toBeNull();
    expect(caps.trueColor).toBe(true);
  });

  it("detects 24bit via COLORTERM", () => {
    setEnv({ COLORTERM: "24bit" });
    const caps = detectCapabilities();
    expect(caps.trueColor).toBe(true);
  });

  it("defaults to no images, no truecolor for unknown terminal", () => {
    const caps = detectCapabilities();
    expect(caps.images).toBeNull();
    expect(caps.trueColor).toBe(false);
    expect(caps.hyperlinks).toBe(true);
  });
});

describe("getCapabilities (caching)", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ["KITTY_WINDOW_ID", "TERM_PROGRAM"]) {
      savedEnv[key] = process.env[key];
    }
    clearTermEnv();
    resetCapabilitiesCache();
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetCapabilitiesCache();
  });

  it("caches the result after first call", () => {
    setEnv({ KITTY_WINDOW_ID: "1" });
    const first = getCapabilities();
    delete process.env.KITTY_WINDOW_ID;
    const second = getCapabilities();
    expect(second).toBe(first); // same reference — cached
    expect(second.images).toBe("kitty");
  });

  it("resetCapabilitiesCache clears the cache", () => {
    setEnv({ KITTY_WINDOW_ID: "1" });
    getCapabilities();
    resetCapabilitiesCache();
    clearTermEnv();
    const fresh = getCapabilities();
    expect(fresh.images).toBeNull();
  });
});

// ── isImageLine ────────────────────────────────────────────────────────────

describe("isImageLine", () => {
  it("detects Kitty prefix at start", () => {
    expect(isImageLine("\x1b_Ga=T,f=100;abcdef\x1b\\")).toBe(true);
  });

  it("detects iTerm2 prefix at start", () => {
    expect(isImageLine("\x1b]1337;File=inline=1:abcdef\x07")).toBe(true);
  });

  it("detects Kitty prefix after cursor movement", () => {
    expect(isImageLine("\x1b[1A\x1b_Ga=T;data\x1b\\")).toBe(true);
  });

  it("detects iTerm2 prefix after cursor movement", () => {
    expect(isImageLine("\x1b[2B\x1b]1337;File=inline=1:data\x07")).toBe(true);
  });

  it("returns false for plain text", () => {
    expect(isImageLine("hello world")).toBe(false);
  });

  it("returns false for ANSI color codes", () => {
    expect(isImageLine("\x1b[31mred text\x1b[0m")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isImageLine("")).toBe(false);
  });
});

// ── allocateImageId ────────────────────────────────────────────────────────

describe("allocateImageId", () => {
  it("returns a positive integer", () => {
    const id = allocateImageId();
    expect(id).toBeGreaterThanOrEqual(1);
    expect(id).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(id)).toBe(true);
  });

  it("returns different values on repeated calls (probabilistic)", () => {
    const ids = new Set<number>();
    for (let i = 0; i < 100; i++) {
      ids.add(allocateImageId());
    }
    // With 32-bit range, 100 calls should all be unique
    expect(ids.size).toBe(100);
  });
});

// ── deleteKittyImage ───────────────────────────────────────────────────────

describe("deleteKittyImage", () => {
  it("generates correct delete escape sequence", () => {
    expect(deleteKittyImage(42)).toBe("\x1b_Ga=d,d=I,i=42\x1b\\");
  });
});

// ── encodeKitty ────────────────────────────────────────────────────────────

describe("encodeKitty", () => {
  it("encodes small data in a single chunk", () => {
    const result = encodeKitty("AAAA");
    expect(result).toBe("\x1b_Ga=T,f=100,q=2;AAAA\x1b\\");
  });

  it("includes column and row params", () => {
    const result = encodeKitty("AAAA", { columns: 40, rows: 10 });
    expect(result).toContain("c=40");
    expect(result).toContain("r=10");
  });

  it("includes imageId param", () => {
    const result = encodeKitty("AAAA", { imageId: 7 });
    expect(result).toContain("i=7");
  });

  it("chunks large data at 4096-byte boundaries", () => {
    const largeData = "A".repeat(4096 * 2 + 100);
    const result = encodeKitty(largeData);

    // First chunk has params + m=1
    expect(result).toContain("a=T,f=100,q=2,m=1;");

    // Middle chunks have m=1
    const middlePattern = "\x1b_Gm=1;";
    expect(result).toContain(middlePattern);

    // Last chunk has m=0
    expect(result).toContain("\x1b_Gm=0;");

    // All chunks end with ST
    const chunks = result.split("\x1b\\");
    // Last split element is empty string after final ST
    expect(chunks.length).toBeGreaterThanOrEqual(4); // 3 chunks + trailing ""
  });

  it("boundary: exactly 4096 bytes fits single chunk", () => {
    const data = "A".repeat(4096);
    const result = encodeKitty(data);
    // Single chunk, no m= parameter
    expect(result).not.toContain("m=");
  });

  it("boundary: 4097 bytes triggers chunking", () => {
    const data = "A".repeat(4097);
    const result = encodeKitty(data);
    expect(result).toContain("m=1");
    expect(result).toContain("m=0");
  });
});

// ── encodeITerm2 ───────────────────────────────────────────────────────────

describe("encodeITerm2", () => {
  it("encodes with default inline=1", () => {
    const result = encodeITerm2("AAAA");
    expect(result).toBe("\x1b]1337;File=inline=1:AAAA\x07");
  });

  it("includes width and height params", () => {
    const result = encodeITerm2("AAAA", { width: 40, height: "auto" });
    expect(result).toContain("width=40");
    expect(result).toContain("height=auto");
  });

  it("includes base64-encoded name", () => {
    const result = encodeITerm2("AAAA", { name: "test.png" });
    const expectedName = Buffer.from("test.png").toString("base64");
    expect(result).toContain(`name=${expectedName}`);
  });

  it("disables preserveAspectRatio when false", () => {
    const result = encodeITerm2("AAAA", { preserveAspectRatio: false });
    expect(result).toContain("preserveAspectRatio=0");
  });

  it("does not include preserveAspectRatio when true/default", () => {
    const result = encodeITerm2("AAAA", { preserveAspectRatio: true });
    expect(result).not.toContain("preserveAspectRatio");
  });

  it("respects inline=false", () => {
    const result = encodeITerm2("AAAA", { inline: false });
    expect(result).toContain("inline=0");
  });
});

// ── calculateImageRows ────────────────────────────────────────────────────

describe("calculateImageRows", () => {
  it("calculates rows for a simple case", () => {
    // 100x100 image, 10 cells wide, 10px wide cells, 20px tall cells
    // targetWidthPx = 10*10 = 100, scale = 1, scaledHeight = 100
    // rows = ceil(100/20) = 5
    const rows = calculateImageRows(
      { widthPx: 100, heightPx: 100 },
      10,
      { widthPx: 10, heightPx: 20 },
    );
    expect(rows).toBe(5);
  });

  it("scales proportionally for wider target", () => {
    // 50x100 image, 10 cells wide, 10px wide cells, 20px tall cells
    // targetWidthPx = 100, scale = 2, scaledHeight = 200
    // rows = ceil(200/20) = 10
    const rows = calculateImageRows(
      { widthPx: 50, heightPx: 100 },
      10,
      { widthPx: 10, heightPx: 20 },
    );
    expect(rows).toBe(10);
  });

  it("returns minimum of 1 for tiny images", () => {
    const rows = calculateImageRows(
      { widthPx: 1000, heightPx: 1 },
      80,
      { widthPx: 9, heightPx: 18 },
    );
    expect(rows).toBeGreaterThanOrEqual(1);
  });

  it("uses default cell dimensions when not provided", () => {
    // Default: widthPx=9, heightPx=18
    // 180x180 image at 20 cells: targetPx = 180, scale=1, rows = ceil(180/18) = 10
    const rows = calculateImageRows({ widthPx: 180, heightPx: 180 }, 20);
    expect(rows).toBe(10);
  });
});

// ── getImageDimensions ─────────────────────────────────────────────────────

describe("getImageDimensions", () => {
  it("parses PNG dimensions", async () => {
    const dims = await getImageDimensions(TINY_PNG_B64);
    expect(dims).not.toBeNull();
    expect(dims!.widthPx).toBe(1);
    expect(dims!.heightPx).toBe(1);
  });

  it("parses JPEG dimensions", async () => {
    const dims = await getImageDimensions(TINY_JPEG_B64);
    expect(dims).not.toBeNull();
    expect(dims!.widthPx).toBe(1);
    expect(dims!.heightPx).toBe(1);
  });

  it("returns null for invalid data", async () => {
    const dims = await getImageDimensions("not-valid-base64-image");
    expect(dims).toBeNull();
  });

  it("returns null for empty string", async () => {
    const dims = await getImageDimensions("");
    expect(dims).toBeNull();
  });

  it("returns null for truncated image", async () => {
    // Take just the first few bytes of the PNG
    const truncated = TINY_PNG_B64.slice(0, 10);
    const dims = await getImageDimensions(truncated);
    // image-size may or may not parse partial data — either null or valid is ok
    // but it must not throw
    expect(dims === null || (dims.widthPx > 0 && dims.heightPx > 0)).toBe(true);
  });
});

// ── Cell Dimensions ────────────────────────────────────────────────────────

describe("getCellDimensions / setCellDimensions", () => {
  it("returns defaults", () => {
    const dims = getCellDimensions();
    expect(dims.widthPx).toBe(9);
    expect(dims.heightPx).toBe(18);
  });

  it("updates after setCellDimensions", () => {
    const original = { ...getCellDimensions() };
    setCellDimensions({ widthPx: 12, heightPx: 24 });
    expect(getCellDimensions()).toEqual({ widthPx: 12, heightPx: 24 });
    // Restore
    setCellDimensions(original);
  });
});

// ── renderImage ────────────────────────────────────────────────────────────

describe("renderImage", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      "KITTY_WINDOW_ID",
      "ITERM_SESSION_ID",
      "TERM_PROGRAM",
      "TERM",
      "COLORTERM",
      "GHOSTTY_RESOURCES_DIR",
      "WEZTERM_PANE",
    ]) {
      savedEnv[key] = process.env[key];
    }
    clearTermEnv();
    resetCapabilitiesCache();
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetCapabilitiesCache();
  });

  it("returns null when no image protocol available", () => {
    const result = renderImage("AAAA", { widthPx: 100, heightPx: 100 });
    expect(result).toBeNull();
  });

  it("returns Kitty sequence in Kitty terminal", () => {
    setEnv({ KITTY_WINDOW_ID: "1" });
    const result = renderImage("AAAA", { widthPx: 100, heightPx: 100 });
    expect(result).not.toBeNull();
    expect(result!.sequence).toContain("\x1b_G");
    expect(result!.rows).toBeGreaterThanOrEqual(1);
  });

  it("returns iTerm2 sequence in iTerm2 terminal", () => {
    setEnv({ ITERM_SESSION_ID: "w0t0p0:test" });
    const result = renderImage("AAAA", { widthPx: 100, heightPx: 100 });
    expect(result).not.toBeNull();
    expect(result!.sequence).toContain("\x1b]1337;File=");
    expect(result!.rows).toBeGreaterThanOrEqual(1);
  });

  it("includes imageId in Kitty mode when provided", () => {
    setEnv({ KITTY_WINDOW_ID: "1" });
    const result = renderImage("AAAA", { widthPx: 100, heightPx: 100 }, { imageId: 42 });
    expect(result!.imageId).toBe(42);
    expect(result!.sequence).toContain("i=42");
  });

  it("respects maxWidthCells option", () => {
    setEnv({ KITTY_WINDOW_ID: "1" });
    const result = renderImage("AAAA", { widthPx: 100, heightPx: 100 }, { maxWidthCells: 40 });
    expect(result!.sequence).toContain("c=40");
  });
});

// ── imageFallback ──────────────────────────────────────────────────────────

describe("imageFallback", () => {
  it("returns formatted fallback with just mimeType", () => {
    expect(imageFallback("image/png")).toBe("[Image: [image/png]]");
  });

  it("includes filename when provided", () => {
    expect(imageFallback("image/png", undefined, "photo.png")).toBe(
      "[Image: photo.png [image/png]]",
    );
  });

  it("includes dimensions when provided", () => {
    expect(imageFallback("image/jpeg", { widthPx: 800, heightPx: 600 })).toBe(
      "[Image: [image/jpeg] 800x600]",
    );
  });

  it("includes all parts when all provided", () => {
    expect(
      imageFallback("image/gif", { widthPx: 320, heightPx: 240 }, "anim.gif"),
    ).toBe("[Image: anim.gif [image/gif] 320x240]");
  });
});
