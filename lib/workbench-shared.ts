export type WorkbenchTab = {
  id: string;
  title: string;
  content: string;
};

export type WorkbenchLayout = {
  sidebar_width_px: number;
  output_height_px: number;
  output_split_percent: number;
};

export type WorkbenchState = {
  open_tab_ids: string[];
  active_tab_id: string | null;
  layout?: Partial<WorkbenchLayout>;
};

export type WorkbenchBootstrapData = {
  tabs: WorkbenchTab[];
  activeTabId: string | null;
  layout: WorkbenchLayout;
  vimModeEnabled: boolean;
};

export const DEFAULT_CODE = `package main

import "fmt"

func main() {
	fmt.Println("Hello, world!")
}
`;

export const DEFAULT_SIDEBAR_WIDTH_PX = 280;
export const DEFAULT_OUTPUT_HEIGHT_PX = 190;
export const DEFAULT_OUTPUT_SPLIT_PERCENT = 55;

export const MIN_SIDEBAR_WIDTH_PX = 210;
export const MAX_SIDEBAR_WIDTH_PX = 520;
export const MIN_OUTPUT_HEIGHT_PX = 36;
export const MAX_OUTPUT_HEIGHT_PX = 520;
export const MIN_OUTPUT_SPLIT_PERCENT = 25;
export const MAX_OUTPUT_SPLIT_PERCENT = 75;

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeLayout(raw: unknown): WorkbenchLayout {
  const obj =
    raw && typeof raw === "object" ? (raw as Partial<WorkbenchLayout>) : null;

  const sidebar =
    typeof obj?.sidebar_width_px === "number" ? obj.sidebar_width_px : DEFAULT_SIDEBAR_WIDTH_PX;
  const output =
    typeof obj?.output_height_px === "number" ? obj.output_height_px : DEFAULT_OUTPUT_HEIGHT_PX;
  const split =
    typeof obj?.output_split_percent === "number"
      ? obj.output_split_percent
      : DEFAULT_OUTPUT_SPLIT_PERCENT;

  return {
    sidebar_width_px: clampNumber(sidebar, MIN_SIDEBAR_WIDTH_PX, MAX_SIDEBAR_WIDTH_PX),
    output_height_px: clampNumber(output, MIN_OUTPUT_HEIGHT_PX, MAX_OUTPUT_HEIGHT_PX),
    output_split_percent: clampNumber(split, MIN_OUTPUT_SPLIT_PERCENT, MAX_OUTPUT_SPLIT_PERCENT),
  };
}
