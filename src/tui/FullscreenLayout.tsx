import React from 'react';
import { Box } from 'ink';
import { useScreenSize } from 'fullscreen-ink';

// ── Constants ─────────────────────────────────────────────────

const MAX_CONTENT_WIDTH = 120;
const DEFAULT_ROWS = 24;

// ── Props ─────────────────────────────────────────────────────

export interface FullscreenLayoutProps {
  /** Content rendered in the fixed-height header region. */
  header: React.ReactNode;
  /** Content rendered in the flexible-height body region. */
  body: React.ReactNode;
  /** Content rendered in the fixed-height input region. */
  input: React.ReactNode;
  /** Optional sidebar content rendered to the right of the body. */
  sidebar?: React.ReactNode;
  /** Whether the sidebar is visible. Default: false */
  sidebarVisible?: boolean;
  /** Fixed height for the header region (rows). Default: 4 */
  headerHeight?: number;
  /** Fixed height for the input region (rows). Default: 2 */
  inputHeight?: number;
}

// ── Layout Calculation ────────────────────────────────────────

export interface LayoutDimensions {
  contentWidth: number;
  marginLeft: number;
  headerHeight: number;
  bodyHeight: number;
  inputHeight: number;
  totalRows: number;
  /** Width of the main content area (contentWidth minus sidebar when visible). */
  mainWidth: number;
  /** Width of the sidebar panel (0 when hidden or terminal too narrow). */
  sidebarWidth: number;
}

/** Minimum terminal width required to show the sidebar. */
const MIN_SIDEBAR_COLS = 60;
/** Default sidebar width in columns. */
const DEFAULT_SIDEBAR_WIDTH = 30;

/**
 * Pure function that computes layout dimensions from screen size and config.
 * Exported for testability — the component uses this internally.
 */
export function computeLayout(
  columns: number | undefined,
  rows: number | undefined,
  headerHeight: number,
  inputHeight: number,
  sidebarVisible?: boolean,
  sidebarWidth?: number,
): LayoutDimensions {
  const effectiveColumns = columns ?? MAX_CONTENT_WIDTH;
  const effectiveRows = rows ?? DEFAULT_ROWS;

  const contentWidth = Math.min(effectiveColumns, MAX_CONTENT_WIDTH);
  const marginLeft = Math.floor((effectiveColumns - contentWidth) / 2);
  const bodyHeight = Math.max(effectiveRows - headerHeight - inputHeight, 1);

  // Sidebar: show only when explicitly visible AND terminal is wide enough
  const effectiveSidebarWidth = DEFAULT_SIDEBAR_WIDTH;
  const showSidebar = sidebarVisible === true && effectiveColumns >= MIN_SIDEBAR_COLS;
  const actualSidebarWidth = showSidebar ? (sidebarWidth ?? effectiveSidebarWidth) : 0;
  const mainWidth = contentWidth - actualSidebarWidth;

  return {
    contentWidth,
    marginLeft,
    headerHeight,
    bodyHeight,
    inputHeight,
    totalRows: effectiveRows,
    mainWidth,
    sidebarWidth: actualSidebarWidth,
  };
}

// ── Component ─────────────────────────────────────────────────

/**
 * 3-panel fullscreen layout with fixed header/input and flexible body.
 * Centers content within a max-width of 120 columns.
 * Designed to be used inside fullscreen-ink's FullScreenBox or withFullScreen.
 */
export function FullscreenLayout({
  header,
  body,
  input,
  sidebar,
  sidebarVisible = false,
  headerHeight: headerH = 4,
  inputHeight: inputH = 2,
}: FullscreenLayoutProps) {
  const { width: columns, height: rows } = useScreenSize();

  // rows may be undefined in ink-testing-library — computeLayout handles the fallback
  const layout = computeLayout(
    columns,
    rows,
    headerH,
    inputH,
    sidebarVisible,
  );

  const showSidebar = sidebarVisible && layout.sidebarWidth > 0 && sidebar != null;

  return (
    <Box
      flexDirection="column"
      height={layout.totalRows}
      marginLeft={layout.marginLeft}
      width={layout.contentWidth}
    >
      {/* Header region — fixed height */}
      <Box height={layout.headerHeight} flexShrink={0}>
        {header}
      </Box>

      {/* Body region — fills remaining space, overflow hidden */}
      <Box height={layout.bodyHeight} overflow="hidden" flexGrow={1}>
        {showSidebar ? (
          <Box flexDirection="row" width={layout.contentWidth}>
            <Box width={layout.mainWidth}>{body}</Box>
            <Box width={layout.sidebarWidth}>{sidebar}</Box>
          </Box>
        ) : (
          body
        )}
      </Box>

      {/* Input region — fixed height */}
      <Box height={layout.inputHeight} flexShrink={0}>
        {input}
      </Box>
    </Box>
  );
}
