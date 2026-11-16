import { STATIC_TEMPLATE_CROPS } from "../config/templates";
import { TemplateROICrop, TimesheetTemplateId } from "../types/timesheet";

const ANALYSIS_WIDTH = 480;
const ANALYSIS_HEIGHT = 340;
const ADAPTIVE_RADIUS = 14;
const ADAPTIVE_THRESHOLD_RATIO = 0.95;
const MAX_OUTPUT_SIZE = 3000;
const HORIZONTAL_BUCKETS = 10;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothSeries(
  values: Float32Array,
  startIdx: number,
  endIdx: number
): Float32Array {
  const out = new Float32Array(values.length);
  for (let i = startIdx; i <= endIdx; i++) {
    const lo = Math.max(startIdx, i - 2);
    const hi = Math.min(endIdx, i + 2);
    let sum = 0;
    for (let k = lo; k <= hi; k++) {
      sum += values[k];
    }
    out[i] = sum / (hi - lo + 1);
  }
  return out;
}

function findMainTableSpan(
  scores: Float32Array,
  startIdx: number,
  endIdx: number,
  threshold: number,
  maxGap: number,
  minNoiseLength: number,
  minMainBlockLength: number
): [number, number] | null {
  const runs: Array<{ start: number; end: number }> = [];
  let runStart = -1;

  for (let i = startIdx; i <= endIdx; i++) {
    if (scores[i] >= threshold) {
      if (runStart === -1) runStart = i;
    } else if (runStart !== -1) {
      runs.push({ start: runStart, end: i - 1 });
      runStart = -1;
    }
  }
  if (runStart !== -1) {
    runs.push({ start: runStart, end: endIdx });
  }

  if (runs.length === 0) return null;

  const merged: Array<{ start: number; end: number }> = [{ ...runs[0] }];
  for (let i = 1; i < runs.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = runs[i];
    if (curr.start - prev.end - 1 <= maxGap) {
      prev.end = curr.end;
    } else {
      merged.push({ ...curr });
    }
  }

  const hasMainBlock = merged.some(
    (r) => r.end - r.start + 1 >= minMainBlockLength
  );
  const filtered = hasMainBlock
    ? merged.filter((r) => r.end - r.start + 1 >= minNoiseLength)
    : merged;

  if (filtered.length === 0) return null;

  let longest = filtered[0];
  for (let i = 1; i < filtered.length; i++) {
    if (filtered[i].end - filtered[i].start > longest.end - longest.start) {
      longest = filtered[i];
    }
  }

  if (longest.end - longest.start + 1 >= minMainBlockLength) {
    return [longest.start, longest.end];
  }

  return [filtered[0].start, filtered[filtered.length - 1].end];
}

/**
 * Detects the actual table boundaries on a sheet using a 2D integral image for
 * lighting-invariant adaptive thresholding and ink + edge-transition projections,
 * crops top and bottom to the detected table borders (preserving the outer grid lines),
 * trims 10% from the left side of the table, and leaves the right edge uncropped.
 */
export function detectTableBoundsAndAutoCrop(
  sourceCanvas: HTMLCanvasElement
): TemplateROICrop {
  const fallbackROI: TemplateROICrop = {
    left: 0.1,
    top: 0.1,
    width: 0.9,
    height: 0.8,
  };

  if (!sourceCanvas || sourceCanvas.width === 0 || sourceCanvas.height === 0) {
    return fallbackROI;
  }

  const W = ANALYSIS_WIDTH;
  const H = ANALYSIS_HEIGHT;
  const analysisCanvas = document.createElement("canvas");
  analysisCanvas.width = W;
  analysisCanvas.height = H;
  const ctx = analysisCanvas.getContext("2d");
  if (!ctx) {
    return fallbackROI;
  }

  ctx.drawImage(sourceCanvas, 0, 0, W, H);
  const { data } = ctx.getImageData(0, 0, W, H);

  const lum = new Uint8Array(W * H);
  const integralStride = W + 1;
  const integral = new Int32Array(integralStride * (H + 1));

  for (let y = 0; y < H; y++) {
    let rowSum = 0;
    const rowOff = y * W;
    const intRowOff = (y + 1) * integralStride;
    const prevIntRowOff = y * integralStride;

    for (let x = 0; x < W; x++) {
      const p = (rowOff + x) * 4;
      const gray = Math.round(
        0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]
      );
      lum[rowOff + x] = gray;
      rowSum += gray;
      integral[intRowOff + x + 1] = integral[prevIntRowOff + x + 1] + rowSum;
    }
  }

  const xMin = Math.floor(W * 0.02);
  const xMax = Math.ceil(W * 0.98);
  const yMin = Math.floor(H * 0.02);
  const yMax = Math.ceil(H * 0.98);

  const binary = new Uint8Array(W * H);
  for (let y = yMin; y <= yMax; y++) {
    const y1 = Math.max(0, y - ADAPTIVE_RADIUS);
    const y2 = Math.min(H - 1, y + ADAPTIVE_RADIUS);
    const r1 = y1 * integralStride;
    const r2 = (y2 + 1) * integralStride;
    const rowOff = y * W;

    for (let x = xMin; x <= xMax; x++) {
      const x1 = Math.max(0, x - ADAPTIVE_RADIUS);
      const x2 = Math.min(W - 1, x + ADAPTIVE_RADIUS);
      const area = (x2 - x1 + 1) * (y2 - y1 + 1);
      const sum =
        integral[r2 + x2 + 1] -
        integral[r1 + x2 + 1] -
        integral[r2 + x1] +
        integral[r1 + x1];
      const localMean = sum / area;
      if (lum[rowOff + x] < localMean * ADAPTIVE_THRESHOLD_RATIO) {
        binary[rowOff + x] = 1;
      }
    }
  }

  // Vertical table span [yStart, yEnd] with horizontal grid-continuity coverage
  const rxStart = Math.floor(W * 0.03);
  const rxEnd = Math.ceil(W * 0.97);
  const rxSpan = Math.max(1, rxEnd - rxStart + 1);
  const rowScores = new Float32Array(H);
  let maxRowScore = 0;

  for (let y = yMin; y <= yMax; y++) {
    const rowOff = y * W;
    let inkPixels = 0;
    let transitions = 0;
    let prev = binary[rowOff + rxStart];
    let bucketMask = 0;

    for (let x = rxStart; x <= rxEnd; x++) {
      const curr = binary[rowOff + x];
      inkPixels += curr;
      if (curr) {
        const bucketIdx = Math.min(
          HORIZONTAL_BUCKETS - 1,
          Math.floor(((x - rxStart) * HORIZONTAL_BUCKETS) / rxSpan)
        );
        bucketMask |= 1 << bucketIdx;
      }
      if (curr !== prev) {
        transitions++;
      }
      prev = curr;
    }

    let activeBuckets = 0;
    for (let b = 0; b < HORIZONTAL_BUCKETS; b++) {
      if (bucketMask & (1 << b)) activeBuckets++;
    }
    const gridCoverageFactor =
      activeBuckets >= 5 ? 1 + (activeBuckets - 4) * 0.25 : 0.45;
    const cappedInk = Math.min(inkPixels, W * 0.35);
    rowScores[y] = (cappedInk + 1.5 * transitions) * gridCoverageFactor;
  }

  const smoothedRows = smoothSeries(rowScores, yMin, yMax);
  for (let y = yMin; y <= yMax; y++) {
    if (smoothedRows[y] > maxRowScore) maxRowScore = smoothedRows[y];
  }

  const rowThresh = Math.max(W * 0.035, maxRowScore * 0.08);
  const rowSpan = findMainTableSpan(
    smoothedRows,
    yMin,
    yMax,
    rowThresh,
    Math.round(H * 0.16),
    Math.max(2, Math.round(H * 0.03)),
    Math.round(H * 0.35)
  );
  if (!rowSpan) return fallbackROI;

  const [yStart, yEnd] = rowSpan;

  // Horizontal table span [xStart, xEnd] strictly within [yStart, yEnd]
  const colScores = new Float32Array(W);
  let maxColScore = 0;

  for (let x = xMin; x <= xMax; x++) {
    let inkPixels = 0;
    let transitions = 0;
    let prev = binary[yStart * W + x];
    for (let y = yStart; y <= yEnd; y++) {
      const curr = binary[y * W + x];
      inkPixels += curr;
      if (curr !== prev) {
        transitions++;
      }
      prev = curr;
    }
    colScores[x] = inkPixels + 1.5 * transitions;
  }

  const smoothedCols = smoothSeries(colScores, xMin, xMax);
  for (let x = xMin; x <= xMax; x++) {
    if (smoothedCols[x] > maxColScore) maxColScore = smoothedCols[x];
  }

  const colSpanHeight = Math.max(1, yEnd - yStart + 1);
  // Low threshold so empty right-hand absence columns are included in tableW
  const colThresh = Math.max(colSpanHeight * 0.04, maxColScore * 0.06);
  const colSpan = findMainTableSpan(
    smoothedCols,
    xMin,
    xMax,
    colThresh,
    Math.round(W * 0.04),
    Math.max(2, Math.round(W * 0.02)),
    Math.round(W * 0.45)
  );
  if (!colSpan) return fallbackROI;

  const [xStart, xEnd] = colSpan;

  let tLeft = xStart / W;
  let tRight = xEnd / W;
  let tTop = yStart / H;
  let tBottom = yEnd / H;

  if (tRight - tLeft < 0.5 || tBottom - tTop < 0.35) {
    tLeft = 0;
    tRight = 1;
    tTop = 0;
    tBottom = 1;
  }

  const tableW = tRight - tLeft;

  // Left: crop 10% inside the table from tLeft (removes the employee name/title columns)
  const left = clamp01(tLeft + tableW * 0.1);
  // Top & Bottom: crop to the detected table borders, never cutting deeper than 10% from sheet edges
  const top = Math.min(0.1, clamp01(tTop - 0.01));
  const bottom = Math.max(0.9, clamp01(tBottom + 0.01));
  const height = clamp01(bottom - top);
  // Right: 0% crop (left + width === 1.0)
  const width = clamp01(1.0 - left);

  return {
    left,
    top,
    width,
    height: Math.min(height, 1 - top),
  };
}

export function resolveTemplateROICrop(
  sourceCanvas: HTMLCanvasElement,
  mode: TimesheetTemplateId
): TemplateROICrop {
  if (mode === "auto") {
    return detectTableBoundsAndAutoCrop(sourceCanvas);
  }
  return STATIC_TEMPLATE_CROPS[mode];
}

/**
 * Extracts only the anonymized timesheet grid according to the template's ROI crop,
 * stripping employee names, organization headers, and signature footers before upload.
 */
export function cropCanvasByTemplateROI(
  sourceCanvas: HTMLCanvasElement,
  cropRect: { x: number; y: number; w: number; h: number },
  roi: TemplateROICrop
): string {
  const finalX = Math.round(cropRect.x + cropRect.w * roi.left);
  const finalY = Math.round(cropRect.y + cropRect.h * roi.top);
  const rightEdge = Math.min(
    cropRect.x + cropRect.w,
    Math.round(cropRect.x + cropRect.w * (roi.left + roi.width))
  );
  const bottomEdge = Math.min(
    cropRect.y + cropRect.h,
    Math.round(cropRect.y + cropRect.h * (roi.top + roi.height))
  );
  const finalW = Math.max(1, rightEdge - finalX);
  const finalH = Math.max(1, bottomEdge - finalY);

  let targetW = finalW;
  let targetH = finalH;
  if (finalW > MAX_OUTPUT_SIZE || finalH > MAX_OUTPUT_SIZE) {
    const resizeRatio = Math.min(
      MAX_OUTPUT_SIZE / finalW,
      MAX_OUTPUT_SIZE / finalH
    );
    targetW = finalW * resizeRatio;
    targetH = finalH * resizeRatio;
  }

  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = Math.max(1, Math.round(targetW));
  outputCanvas.height = Math.max(1, Math.round(targetH));

  const ctx = outputCanvas.getContext("2d");
  if (!ctx) {
    return "";
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "medium";
  ctx.filter = "contrast(112%)";
  ctx.drawImage(
    sourceCanvas,
    finalX,
    finalY,
    finalW,
    finalH,
    0,
    0,
    outputCanvas.width,
    outputCanvas.height
  );
  ctx.filter = "none";

  return outputCanvas.toDataURL("image/jpeg", 0.95);
}
