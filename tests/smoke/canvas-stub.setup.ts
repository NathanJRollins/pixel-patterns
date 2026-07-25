/**
 * Vitest global setup for happy-dom-environment tests. Installs a stub
 * `HTMLCanvasElement.prototype.getContext` and `toDataURL` so the renderer
 * can be exercised without a real GPU canvas. Installed *before* any test
 * module imports runs, so module-load side effects (e.g. PresetsBar's
 * thumb baking) don't crash.
 */

let canvasCallCount = 0;
export function canvasCallTotal(): number {
  return canvasCallCount;
}

const ctxMethods = [
  "setTransform",
  "translate",
  "rotate",
  "scale",
  "save",
  "restore",
  "clearRect",
  "fillRect",
  "strokeRect",
  "beginPath",
  "moveTo",
  "lineTo",
  "closePath",
  "stroke",
  "fill",
  "rect",
  "clip",
  "drawImage",
  "putImageData",
];

function makeStubContext(): CanvasRenderingContext2D {
  const ctx: Record<string, unknown> = {
    imageSmoothingEnabled: true,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    canvas: {},
  };
  for (const m of ctxMethods) {
    ctx[m] = () => {};
  }
  ctx.createPattern = () => ({});
  ctx.getImageData = () =>
    ({ data: new Uint8ClampedArray(0), width: 0, height: 0 } as ImageData);
  return ctx as unknown as CanvasRenderingContext2D;
}

export function installCanvasStub(): void {
  // In environments that don't have DOM globals (e.g. node), this no-ops.
  if (typeof HTMLCanvasElement === "undefined") return;
  const proto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  proto.getContext = () => {
    canvasCallCount++;
    return makeStubContext();
  };
  proto.toDataURL = () => "data:image/png;base64,";
}

// Install at module load (before any test imports App → renderer).
installCanvasStub();