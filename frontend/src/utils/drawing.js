import { getStroke } from "perfect-freehand";

export const TOOLS = {
  PEN: "pen",
  ERASER: "eraser",
  RECT: "rect",
  ELLIPSE: "ellipse",
  LINE: "line",
  ARROW: "arrow",
  TEXT: "text",
  STICKY: "sticky",
  SELECT: "select",
};

export const STICKY_COLORS = [
  "#fef08a",
  "#fda4af",
  "#a7f3d0",
  "#bfdbfe",
  "#e9d5ff",
  "#fed7aa",
];

export const PALETTE = [
  "#0f172a",
  "#e11d48",
  "#ea580c",
  "#ca8a04",
  "#16a34a",
  "#2563eb",
  "#7c3aed",
  "#db2777",
  "#ffffff",
];

export function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function getSvgPathFromStroke(stroke) {
  if (!stroke.length) return "";
  const d = stroke.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ["M", ...stroke[0], "Q"]
  );
  d.push("Z");
  return d.join(" ");
}

export function buildPenPath(points, strokeWidth) {
  const stroke = getStroke(points, {
    size: strokeWidth,
    thinning: 0.6,
    smoothing: 0.5,
    streamline: 0.5,
    easing: (t) => t,
    start: { taper: 0, cap: true },
    end: { taper: 0, cap: true },
  });
  return getSvgPathFromStroke(stroke);
}

export function elementBounds(el) {
  if (el.type === "pen" || el.type === "eraser") {
    const xs = el.points.map((p) => p[0]);
    const ys = el.points.map((p) => p[1]);
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
  }
  if (el.type === "rect" || el.type === "ellipse" || el.type === "line" || el.type === "arrow") {
    return {
      x: Math.min(el.x1, el.x2),
      y: Math.min(el.y1, el.y2),
      w: Math.abs(el.x2 - el.x1),
      h: Math.abs(el.y2 - el.y1),
    };
  }
  if (el.type === "text") {
    return { x: el.x, y: el.y - el.fontSize, w: el.text.length * el.fontSize * 0.55, h: el.fontSize * 1.4 };
  }
  if (el.type === "sticky") {
    return { x: el.x, y: el.y, w: el.width, h: el.height };
  }
  return { x: 0, y: 0, w: 0, h: 0 };
}

export function hitTest(el, x, y) {
  const pad = 8;
  const b = elementBounds(el);
  return x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;
}

export function renderElement(el) {
  if (el.type === "pen" || el.type === "eraser") {
    const d = buildPenPath(el.points, el.strokeWidth);
    return {
      tag: "path",
      props: {
        d,
        fill: el.color,
        opacity: el.type === "eraser" ? 1 : 1,
      },
    };
  }
  if (el.type === "rect") {
    return {
      tag: "rect",
      props: {
        x: Math.min(el.x1, el.x2),
        y: Math.min(el.y1, el.y2),
        width: Math.abs(el.x2 - el.x1),
        height: Math.abs(el.y2 - el.y1),
        fill: "none",
        stroke: el.color,
        strokeWidth: el.strokeWidth,
        rx: 4,
      },
    };
  }
  if (el.type === "ellipse") {
    const cx = (el.x1 + el.x2) / 2;
    const cy = (el.y1 + el.y2) / 2;
    const rx = Math.abs(el.x2 - el.x1) / 2;
    const ry = Math.abs(el.y2 - el.y1) / 2;
    return {
      tag: "ellipse",
      props: { cx, cy, rx, ry, fill: "none", stroke: el.color, strokeWidth: el.strokeWidth },
    };
  }
  if (el.type === "line" || el.type === "arrow") {
    const line = {
      tag: "line",
      props: {
        x1: el.x1,
        y1: el.y1,
        x2: el.x2,
        y2: el.y2,
        stroke: el.color,
        strokeWidth: el.strokeWidth,
        strokeLinecap: "round",
      },
    };
    if (el.type === "line") return line;
    const angle = Math.atan2(el.y2 - el.y1, el.x2 - el.x1);
    const head = 10 + el.strokeWidth;
    const x3 = el.x2 - head * Math.cos(angle - Math.PI / 6);
    const y3 = el.y2 - head * Math.sin(angle - Math.PI / 6);
    const x4 = el.x2 - head * Math.cos(angle + Math.PI / 6);
    const y4 = el.y2 - head * Math.sin(angle + Math.PI / 6);
    return {
      tag: "g",
      children: [
        line,
        {
          tag: "polygon",
          props: {
            points: `${el.x2},${el.y2} ${x3},${y3} ${x4},${y4}`,
            fill: el.color,
          },
        },
      ],
    };
  }
  return null;
}

export function exportToPng(svgNode, width, height) {
  const clone = svgNode.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("width", "100%");
  bg.setAttribute("height", "100%");
  bg.setAttribute("fill", "#0b1020");
  clone.insertBefore(bg, clone.firstChild);

  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(clone);
  const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#0b1020";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob((pngBlob) => {
        if (pngBlob) resolve(pngBlob);
        else reject(new Error("Export failed"));
      }, "image/png");
    };
    img.onerror = reject;
    img.src = url;
  });
}
