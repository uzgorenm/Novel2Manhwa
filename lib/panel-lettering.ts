import "server-only";

import sharp from "sharp";

import type { StoryboardPanel } from "@/lib/storyboard";

const MAX_INPUT_PIXELS = 20_000_000;
const MIN_FONT_SIZE = 14;
const JPEG_QUALITIES = [86, 80, 74, 68, 62, 56, 50, 44, 38, 32] as const;
const FONT_STACK =
  "Arial, Helvetica, &quot;DejaVu Sans&quot;, sans-serif";

type HorizontalPlacement = "left" | "center" | "right";
type VerticalPlacement = "upper" | "middle" | "lower";
type TextRole = "speech" | "thought" | "narration" | "sfx";

type Placement = {
  horizontal: HorizontalPlacement;
  vertical: VerticalPlacement;
};

type TextLayout = {
  fontSize: number;
  lineHeight: number;
  lines: string[];
  width: number;
  height: number;
};

type LetteringItem = {
  role: TextRole;
  text: string;
};

/**
 * Composites exact, deterministic SVG lettering into a panel and returns a
 * bounded JPEG data URL. Gemini is intentionally responsible only for the
 * text-free artwork so spelling never depends on an image model.
 */
export async function embedPanelLettering(
  imageDataUrl: string,
  panel: StoryboardPanel,
  maxOutputBytes: number,
): Promise<string> {
  const input = parseImageDataUrl(imageDataUrl);
  const items = letteringItems(panel);

  if (items.length === 0) {
    return imageDataUrl;
  }

  const { data: pixels, info } = await sharp(input, {
    failOn: "error",
    limitInputPixels: MAX_INPUT_PIXELS,
  })
    .rotate()
    .toColourspace("srgb")
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (!info.width || !info.height) {
    throw new Error("Panel image dimensions are unavailable.");
  }

  const svg = buildLetteringSvg(
    panel,
    items,
    info.width,
    info.height,
  );
  const composited = sharp(pixels, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels,
    },
  }).composite([{ input: Buffer.from(svg), left: 0, top: 0 }]);

  for (const quality of JPEG_QUALITIES) {
    const jpeg = await composited
      .clone()
      .jpeg({
        quality,
        mozjpeg: true,
        chromaSubsampling: "4:4:4",
      })
      .toBuffer();

    if (jpeg.byteLength <= maxOutputBytes) {
      return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
    }
  }

  throw new Error("Lettered panel exceeds the image response size limit.");
}

function parseImageDataUrl(value: string): Buffer {
  const match = value.match(
    /^data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/]*={0,2})$/i,
  );
  if (!match?.[1]) {
    throw new Error("Panel image data URL is invalid.");
  }

  const decoded = Buffer.from(match[1], "base64");
  if (decoded.byteLength === 0) {
    throw new Error("Panel image data is empty.");
  }
  return decoded;
}

function letteringItems(panel: StoryboardPanel): LetteringItem[] {
  if (panel.balloonType === "none") {
    return [];
  }

  const items: LetteringItem[] = [];
  const narration = normalizeLetteringText(panel.narration);
  const dialogue = normalizeLetteringText(panel.dialogue);

  if (narration) {
    items.push({ role: "narration", text: narration });
  }
  if (dialogue) {
    items.push({
      role:
        panel.balloonType === "thought" ||
        panel.balloonType === "narration" ||
        panel.balloonType === "sfx"
          ? panel.balloonType
          : "speech",
      text: dialogue,
    });
  }

  return items;
}

function normalizeLetteringText(value: string): string {
  return value
    .replace(
      // XML 1.0 excludes these controls even when they are escaped.
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function buildLetteringSvg(
  panel: StoryboardPanel,
  items: LetteringItem[],
  canvasWidth: number,
  canvasHeight: number,
): string {
  const placement = parsePlacement(panel.balloonPlacement);
  const margin = Math.max(12, Math.round(canvasWidth * 0.045));
  const gap = Math.max(10, Math.round(canvasHeight * 0.018));
  const rendered: string[] = [];
  let narrationBottom = margin;

  for (const [index, item] of items.entries()) {
    const layout = layoutText(
      item.text,
      item.role,
      canvasWidth,
      canvasHeight,
    );
    const position = resolvePosition(
      item.role,
      layout,
      placement,
      canvasWidth,
      canvasHeight,
      margin,
      narrationBottom,
    );

    if (item.role === "narration") {
      narrationBottom = position.y + layout.height + gap;
    }

    rendered.push(
      renderItem(
        item,
        layout,
        position.x,
        position.y,
        placement,
        index,
      ),
    );
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}">`,
    `<g font-family="${FONT_STACK}" text-rendering="geometricPrecision">`,
    rendered.join(""),
    "</g>",
    "</svg>",
  ].join("");
}

function layoutText(
  text: string,
  role: TextRole,
  canvasWidth: number,
  canvasHeight: number,
): TextLayout {
  const widthRatio = role === "narration" ? 0.82 : role === "sfx" ? 0.68 : 0.72;
  const maximumWidth = Math.floor(canvasWidth * widthRatio);
  const maximumHeight = Math.floor(
    canvasHeight * (role === "narration" ? 0.25 : 0.38),
  );
  const initialFontSize = Math.max(
    MIN_FONT_SIZE,
    Math.round(canvasWidth * (role === "sfx" ? 0.052 : 0.0375)),
  );

  for (
    let fontSize = initialFontSize;
    fontSize >= MIN_FONT_SIZE;
    fontSize -= 1
  ) {
    const horizontalPadding = Math.round(fontSize * 1.15);
    const verticalPadding = Math.round(fontSize * 0.72);
    const usableWidth = maximumWidth - horizontalPadding * 2;
    const maxWidthUnits = Math.max(5, usableWidth / fontSize);
    const lines = wrapText(text, maxWidthUnits, role);
    const lineHeight = Math.round(fontSize * 1.28);
    const measuredWidth =
      Math.max(...lines.map((line) => estimateTextWidth(line, fontSize, role))) +
      horizontalPadding * 2;
    const width = Math.min(maximumWidth, Math.ceil(measuredWidth));
    const height = lines.length * lineHeight + verticalPadding * 2;

    if (height <= maximumHeight && lines.length <= 10) {
      return { fontSize, lineHeight, lines, width, height };
    }
  }

  throw new Error("Panel lettering is too long to render legibly.");
}

function wrapText(
  text: string,
  maxWidthUnits: number,
  role: TextRole,
): string[] {
  const tokens = text.split(/\s+/).flatMap((token) => {
    if (estimateTextWidthUnits(token, role) <= maxWidthUnits) {
      return [token];
    }
    return chunkGraphemes(token, maxWidthUnits, role);
  });
  const lines: string[] = [];
  let current = "";

  for (const token of tokens) {
    const candidate = current ? `${current} ${token}` : token;
    if (
      current &&
      estimateTextWidthUnits(candidate, role) > maxWidthUnits
    ) {
      lines.push(current);
      current = token;
    } else {
      current = candidate;
    }
  }
  if (current) {
    lines.push(current);
  }

  return lines.length > 0 ? lines : [""];
}

function chunkGraphemes(
  value: string,
  maxWidthUnits: number,
  role: TextRole,
): string[] {
  const chunks: string[] = [];
  let current = "";
  let currentWidth = 0;

  for (const grapheme of segmentGraphemes(value)) {
    const graphemeWidth = estimateGraphemeWidthUnits(grapheme, role);
    if (current && currentWidth + graphemeWidth > maxWidthUnits) {
      chunks.push(current);
      current = grapheme;
      currentWidth = graphemeWidth;
    } else {
      current += grapheme;
      currentWidth += graphemeWidth;
    }
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

function estimateTextWidth(
  value: string,
  fontSize: number,
  role: TextRole,
): number {
  return estimateTextWidthUnits(value, role) * fontSize;
}

function estimateTextWidthUnits(value: string, role: TextRole): number {
  return segmentGraphemes(value).reduce(
    (total, grapheme) =>
      total + estimateGraphemeWidthUnits(grapheme, role),
    0,
  );
}

function estimateGraphemeWidthUnits(
  grapheme: string,
  role: TextRole,
): number {
  const weight = role === "sfx" ? 1.12 : 1;

  if (/^\s$/u.test(grapheme)) {
    return 0.34;
  }
  if (
    /\p{Extended_Pictographic}/u.test(grapheme) ||
    /[\u1100-\u11FF\u2E80-\uA4CF\uAC00-\uD7AF\uF900-\uFAFF\uFE10-\uFE6F\uFF01-\uFF60\uFFE0-\uFFE6]/u.test(
      grapheme,
    )
  ) {
    return 1.02 * weight;
  }
  if (/[WM@%&#]/u.test(grapheme)) {
    return 0.92 * weight;
  }
  if (/[A-Z]/u.test(grapheme)) {
    return 0.68 * weight;
  }
  if (/[ijlI.,'`:;!|]/u.test(grapheme)) {
    return 0.32 * weight;
  }
  if (/[mw]/u.test(grapheme)) {
    return 0.82 * weight;
  }
  return 0.58 * weight;
}

function segmentGraphemes(value: string): string[] {
  return Array.from(
    new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value),
    ({ segment }) => segment,
  );
}

function parsePlacement(value: string): Placement {
  const normalized = value.toLowerCase();
  const paired = normalized.match(
    /\b(upper|top|middle|center|lower|bottom)[\s-]+(left|center|right)\b/,
  );
  if (paired) {
    return {
      horizontal: paired[2] as HorizontalPlacement,
      vertical: verticalPlacement(paired[1]),
    };
  }

  const firstHorizontal = normalized.match(/\b(left|right)\b/)?.[1];
  const firstVertical = normalized.match(
    /\b(upper|top|middle|lower|bottom)\b/,
  )?.[1];
  const horizontal: HorizontalPlacement =
    firstHorizontal === "left" || firstHorizontal === "right"
      ? firstHorizontal
      : "center";
  const vertical = verticalPlacement(firstVertical);
  return { horizontal, vertical };
}

function verticalPlacement(value: string | undefined): VerticalPlacement {
  if (value === "lower" || value === "bottom") {
    return "lower";
  }
  if (value === "middle" || value === "center") {
    return "middle";
  }
  return "upper";
}

function resolvePosition(
  role: TextRole,
  layout: TextLayout,
  placement: Placement,
  canvasWidth: number,
  canvasHeight: number,
  margin: number,
  narrationBottom: number,
): { x: number; y: number } {
  const x =
    placement.horizontal === "left"
      ? margin
      : placement.horizontal === "right"
        ? canvasWidth - margin - layout.width
        : Math.round((canvasWidth - layout.width) / 2);

  if (role === "narration") {
    return {
      x,
      y: Math.max(margin, narrationBottom),
    };
  }

  const desiredY =
    placement.vertical === "lower"
      ? canvasHeight * 0.67
      : placement.vertical === "middle"
        ? canvasHeight * 0.4
        : canvasHeight * 0.07;
  const maximumY = canvasHeight - margin - layout.height;

  return {
    x,
    y: Math.max(
      narrationBottom,
      Math.min(Math.round(desiredY), maximumY),
    ),
  };
}

function renderItem(
  item: LetteringItem,
  layout: TextLayout,
  x: number,
  y: number,
  placement: Placement,
  index: number,
): string {
  if (item.role === "sfx") {
    return renderSfx(item.text, layout, x, y, index);
  }

  const body =
    item.role === "narration"
      ? renderNarrationBody(layout, x, y)
      : item.role === "thought"
        ? renderThoughtBody(layout, x, y, placement)
        : renderSpeechBody(layout, x, y, placement);
  const fill = item.role === "narration" ? "#fffdf8" : "#111827";
  const text = renderTextLines(layout, x, y, fill);

  return `<g>${body}${text}</g>`;
}

function renderNarrationBody(
  layout: TextLayout,
  x: number,
  y: number,
): string {
  const radius = Math.max(7, Math.round(layout.fontSize * 0.45));
  const stroke = Math.max(2, Math.round(layout.fontSize * 0.12));
  return `<rect x="${x}" y="${y}" width="${layout.width}" height="${layout.height}" rx="${radius}" fill="#111827" fill-opacity="0.94" stroke="#fffdf8" stroke-width="${stroke}"/>`;
}

function renderSpeechBody(
  layout: TextLayout,
  x: number,
  y: number,
  placement: Placement,
): string {
  const stroke = Math.max(2, Math.round(layout.fontSize * 0.13));
  const radius = Math.round(Math.min(layout.height / 2, layout.fontSize * 2.3));
  const tail = speechTail(layout, x, y, placement, stroke);
  return [
    `<rect x="${x}" y="${y}" width="${layout.width}" height="${layout.height}" rx="${radius}" fill="#fffdf8" stroke="#111827" stroke-width="${stroke}"/>`,
    tail,
  ].join("");
}

function speechTail(
  layout: TextLayout,
  x: number,
  y: number,
  placement: Placement,
  stroke: number,
): string {
  const baseY = y + layout.height - stroke;
  const tailWidth = Math.max(12, Math.round(layout.fontSize * 0.9));
  const tailHeight = Math.max(12, Math.round(layout.fontSize * 1.05));
  const centerX =
    placement.horizontal === "left"
      ? x + layout.width * 0.76
      : placement.horizontal === "right"
        ? x + layout.width * 0.24
        : x + layout.width * 0.56;
  const pointX =
    placement.horizontal === "left"
      ? centerX + tailWidth * 0.55
      : placement.horizontal === "right"
        ? centerX - tailWidth * 0.55
        : centerX;

  return `<path d="M ${centerX - tailWidth / 2} ${baseY} L ${pointX} ${baseY + tailHeight} L ${centerX + tailWidth / 2} ${baseY}" fill="#fffdf8" stroke="#111827" stroke-width="${stroke}" stroke-linejoin="round"/>`;
}

function renderThoughtBody(
  layout: TextLayout,
  x: number,
  y: number,
  placement: Placement,
): string {
  const stroke = Math.max(2, Math.round(layout.fontSize * 0.13));
  const w = layout.width;
  const h = layout.height;
  const cloudPath = [
    `M ${x + w * 0.13} ${y + h * 0.22}`,
    `Q ${x + w * 0.18} ${y - h * 0.02} ${x + w * 0.34} ${y + h * 0.1}`,
    `Q ${x + w * 0.48} ${y - h * 0.08} ${x + w * 0.61} ${y + h * 0.1}`,
    `Q ${x + w * 0.82} ${y - h * 0.02} ${x + w * 0.85} ${y + h * 0.23}`,
    `Q ${x + w * 1.02} ${y + h * 0.34} ${x + w * 0.9} ${y + h * 0.53}`,
    `Q ${x + w * 0.99} ${y + h * 0.75} ${x + w * 0.78} ${y + h * 0.81}`,
    `Q ${x + w * 0.66} ${y + h * 1.02} ${x + w * 0.5} ${y + h * 0.89}`,
    `Q ${x + w * 0.31} ${y + h * 1.02} ${x + w * 0.22} ${y + h * 0.82}`,
    `Q ${x - w * 0.02} ${y + h * 0.76} ${x + w * 0.09} ${y + h * 0.54}`,
    `Q ${x - w * 0.02} ${y + h * 0.34} ${x + w * 0.13} ${y + h * 0.22} Z`,
  ].join(" ");
  const dotX =
    placement.horizontal === "left"
      ? x + w * 0.8
      : placement.horizontal === "right"
        ? x + w * 0.2
        : x + w * 0.58;
  const dotDirection = placement.horizontal === "right" ? -1 : 1;
  const firstRadius = Math.max(4, Math.round(layout.fontSize * 0.25));
  const secondRadius = Math.max(3, Math.round(layout.fontSize * 0.16));

  return [
    `<path d="${cloudPath}" fill="#fffdf8" stroke="#111827" stroke-width="${stroke}" stroke-linejoin="round"/>`,
    `<circle cx="${dotX}" cy="${y + h + firstRadius * 1.5}" r="${firstRadius}" fill="#fffdf8" stroke="#111827" stroke-width="${stroke}"/>`,
    `<circle cx="${dotX + dotDirection * firstRadius * 1.8}" cy="${y + h + firstRadius * 3.3}" r="${secondRadius}" fill="#fffdf8" stroke="#111827" stroke-width="${Math.max(1, stroke - 1)}"/>`,
  ].join("");
}

function renderSfx(
  text: string,
  layout: TextLayout,
  x: number,
  y: number,
  index: number,
): string {
  const stroke = Math.max(3, Math.round(layout.fontSize * 0.19));
  const centerX = x + layout.width / 2;
  const centerY = y + layout.height / 2;
  const angle = index % 2 === 0 ? -7 : 7;
  return [
    `<g transform="rotate(${angle} ${centerX} ${centerY})">`,
    renderTextLines(layout, x, y, "#fffdf8", {
      fontWeight: 900,
      stroke: "#111827",
      strokeWidth: stroke,
    }),
    "</g>",
  ].join("");
}

function renderTextLines(
  layout: TextLayout,
  x: number,
  y: number,
  fill: string,
  options: {
    fontWeight?: number;
    stroke?: string;
    strokeWidth?: number;
  } = {},
): string {
  const firstBaseline =
    y +
    (layout.height - layout.lines.length * layout.lineHeight) / 2 +
    layout.fontSize;
  const strokeAttributes =
    options.stroke && options.strokeWidth
      ? ` stroke="${options.stroke}" stroke-width="${options.strokeWidth}" paint-order="stroke fill" stroke-linejoin="round"`
      : "";

  return [
    `<text x="${x + layout.width / 2}" y="${firstBaseline}" text-anchor="middle" fill="${fill}" font-size="${layout.fontSize}" font-weight="${options.fontWeight ?? 700}" letter-spacing="0.15"${strokeAttributes}>`,
    ...layout.lines.map(
      (line, index) =>
        `<tspan x="${x + layout.width / 2}" dy="${index === 0 ? 0 : layout.lineHeight}">${escapeXml(line)}</tspan>`,
    ),
    "</text>",
  ].join("");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
