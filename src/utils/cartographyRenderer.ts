/**
 * Fantasy Cartography Vector Renderer
 * Implements authentic historical portolan/atlas ornaments:
 * - Hand-crafted Antique Brass & Crimson Compass Rose with Fleur-de-lis
 * - Nautical Rhumb Lines (Loxodromes) and Navigation Grid
 * - Antique Neatline Double Border with Filigree Corner Ornaments and Scale Checkers
 * - Classical Alternating Checkerboard Mile Scale Bar
 */

export interface CompassRoseState {
  x: number; // world coordinates
  y: number;
  radius: number;
  visible: boolean;
}

export interface CartographyDisplayOptions {
  showCompass: boolean;
  showRhumbLines: boolean;
  showBorder: boolean;
  showRipples: boolean;
}

/**
 * Draws the ornate Antique Brass & Crimson Compass Rose
 */
export function drawCompassRose(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number = 70,
  zoom: number = 1.0
): void {
  ctx.save();
  ctx.translate(cx, cy);

  const scale = 1.0; // rendered in world coordinate space

  // 1. Concentric Degree Rings
  ctx.lineWidth = 1.5 / zoom;
  ctx.strokeStyle = 'rgba(212, 175, 55, 0.75)'; // Antique Gold
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.95, 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineWidth = 0.8 / zoom;
  ctx.strokeStyle = 'rgba(180, 140, 50, 0.55)';
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.88, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.38, 0, Math.PI * 2);
  ctx.stroke();

  // Degree ticks around the outer ring (every 5° and 15°)
  const tickCount = 72; // every 5 degrees
  for (let i = 0; i < tickCount; i++) {
    const angle = (i * Math.PI * 2) / tickCount;
    const isMajor = i % 3 === 0; // every 15 deg
    const isCardinal = i % 18 === 0; // every 90 deg

    const rInner = isCardinal ? radius * 0.82 : isMajor ? radius * 0.86 : radius * 0.90;
    const rOuter = radius * 0.95;

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    ctx.strokeStyle = isMajor ? 'rgba(235, 195, 85, 0.85)' : 'rgba(180, 140, 50, 0.45)';
    ctx.lineWidth = (isMajor ? 1.2 : 0.6) / zoom;
    ctx.beginPath();
    ctx.moveTo(cos * rInner, sin * rInner);
    ctx.lineTo(cos * rOuter, sin * rOuter);
    ctx.stroke();
  }

  // 2. Star Points (16 points total: 4 cardinal, 4 ordinal, 8 intermediate)
  // Draw 8 small intermediate bronze points first (behind)
  const drawStarPoint = (
    angle: number,
    pointLength: number,
    baseWidth: number,
    leftColor: string,
    rightColor: string,
    strokeColor: string
  ) => {
    ctx.save();
    ctx.rotate(angle);

    // Left facet
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-baseWidth, 0);
    ctx.lineTo(0, -pointLength);
    ctx.closePath();
    ctx.fillStyle = leftColor;
    ctx.fill();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 0.6 / zoom;
    ctx.stroke();

    // Right facet
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(baseWidth, 0);
    ctx.lineTo(0, -pointLength);
    ctx.closePath();
    ctx.fillStyle = rightColor;
    ctx.fill();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 0.6 / zoom;
    ctx.stroke();

    ctx.restore();
  };

  // 8 Intermediate Points (Short, dark bronze)
  const interLen = radius * 0.60;
  const interBase = radius * 0.12;
  for (let i = 0; i < 8; i++) {
    const angle = ((i * 2 + 1) * Math.PI) / 8;
    drawStarPoint(
      angle,
      interLen,
      interBase,
      '#7a5a2a', // shaded bronze
      '#543a18',
      'rgba(40, 25, 10, 0.7)'
    );
  }

  // 4 Ordinal Points (NE, SE, SW, NW - Medium, Crimson and Gold)
  const ordLen = radius * 0.78;
  const ordBase = radius * 0.16;
  for (let i = 0; i < 4; i++) {
    const angle = ((i * 2 + 1) * Math.PI) / 4;
    drawStarPoint(
      angle,
      ordLen,
      ordBase,
      '#c28b34', // Antique Gold
      '#8f5c1a', // Dark Gold
      'rgba(40, 25, 10, 0.85)'
    );
  }

  // 4 Cardinal Points (N, S, E, W) - Large, Crimson & Gold facets
  // North point is elongated and accented with Fleur-de-lis
  const cardLen = radius * 1.05;
  const cardBase = radius * 0.20;

  // East, South, West
  // East (90 deg)
  drawStarPoint(Math.PI / 2, cardLen, cardBase, '#b83220', '#6e1a0f', '#360b05'); // Crimson
  // South (180 deg)
  drawStarPoint(Math.PI, cardLen, cardBase, '#dfb448', '#997321', '#3d2b05');     // Gold
  // West (270 deg)
  drawStarPoint((Math.PI * 3) / 2, cardLen, cardBase, '#b83220', '#6e1a0f', '#360b05'); // Crimson

  // North (0 deg) - Elongated 1.25x with ornate crown
  drawStarPoint(0, cardLen * 1.25, cardBase, '#f3cb5b', '#aa8024', '#3d2b05');

  // North Fleur-de-lis / Arrowhead Finial
  ctx.save();
  ctx.translate(0, -cardLen * 1.25);
  ctx.fillStyle = '#f3cb5b';
  ctx.strokeStyle = '#3a2608';
  ctx.lineWidth = 0.8 / zoom;
  ctx.beginPath();
  // Petite fleur-de-lis tip
  ctx.moveTo(0, -10);
  ctx.bezierCurveTo(-5, -6, -7, -2, -3, 2);
  ctx.lineTo(-1, 0);
  ctx.lineTo(0, 3);
  ctx.lineTo(1, 0);
  ctx.lineTo(3, 2);
  ctx.bezierCurveTo(7, -2, 5, -6, 0, -10);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // 3. Central Brass Boss & Gem
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.22, 0, Math.PI * 2);
  const bossGrad = ctx.createRadialGradient(-3, -3, 1, 0, 0, radius * 0.22);
  bossGrad.addColorStop(0, '#ffe89c');
  bossGrad.addColorStop(0.4, '#d4af37');
  bossGrad.addColorStop(0.85, '#805d1d');
  bossGrad.addColorStop(1, '#3b2505');
  ctx.fillStyle = bossGrad;
  ctx.fill();
  ctx.strokeStyle = '#2d1b06';
  ctx.lineWidth = 1.2 / zoom;
  ctx.stroke();

  // Central Crimson Jewel Center
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.10, 0, Math.PI * 2);
  const jewelGrad = ctx.createRadialGradient(-1.5, -1.5, 0.5, 0, 0, radius * 0.10);
  jewelGrad.addColorStop(0, '#ff7563');
  jewelGrad.addColorStop(0.5, '#ab1e0e');
  jewelGrad.addColorStop(1, '#470701');
  ctx.fillStyle = jewelGrad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 235, 180, 0.7)';
  ctx.lineWidth = 0.6 / zoom;
  ctx.stroke();

  // 4. Cardinal Direction Typography (N, E, S, W) in Cinzel font
  const fontSize = Math.max(14, Math.round(radius * 0.24));
  ctx.font = `bold ${fontSize}px "Cinzel", "Times New Roman", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const labelDist = radius * 1.15;
  const labels: { text: string; x: number; y: number; col: string }[] = [
    { text: 'N', x: 0, y: -cardLen * 1.25 - fontSize * 0.75, col: '#f8d977' },
    { text: 'E', x: labelDist + fontSize * 0.4, y: 0, col: '#f3cc65' },
    { text: 'S', x: 0, y: labelDist + fontSize * 0.4, col: '#f3cc65' },
    { text: 'W', x: -labelDist - fontSize * 0.4, y: 0, col: '#f3cc65' },
  ];

  for (const lb of labels) {
    // Subtle dark glow / halo
    ctx.shadowColor = 'rgba(10, 15, 20, 0.9)';
    ctx.shadowBlur = 4 / zoom;
    ctx.shadowOffsetX = 1 / zoom;
    ctx.shadowOffsetY = 1 / zoom;

    ctx.fillStyle = '#221508'; // dark stroke
    ctx.strokeText(lb.text, lb.x, lb.y);
    ctx.fillStyle = lb.col;
    ctx.fillText(lb.text, lb.x, lb.y);
  }

  ctx.restore();
}

/**
 * Draws Nautical Rhumb Lines (Loxodromes) radiating across the waters
 */
export function drawRhumbLines(
  ctx: CanvasRenderingContext2D,
  mapWidth: number,
  mapHeight: number,
  primaryCenter: { x: number; y: number },
  secondaryNodes: { x: number; y: number }[] = [],
  zoom: number = 1.0
): void {
  ctx.save();

  const nodes = [primaryCenter, ...secondaryNodes];

  for (let n = 0; n < nodes.length; n++) {
    const { x: cx, y: cy } = nodes[n];
    const isPrimary = n === 0;

    // Concentric nautical navigation rings
    const ringRadii = isPrimary ? [150, 320, 520, 850] : [140, 280, 480];
    for (const r of ringRadii) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = isPrimary
        ? 'rgba(145, 225, 230, 0.28)'
        : 'rgba(130, 210, 215, 0.18)';
      ctx.lineWidth = (isPrimary ? 1.0 : 0.7) / zoom;
      ctx.setLineDash([6 / zoom, 6 / zoom]);
      ctx.stroke();
    }

    // 32-Point Radial Navigation Rays
    const numRays = isPrimary ? 32 : 16;
    const rayLength = Math.hypot(mapWidth, mapHeight) * 1.2;

    for (let i = 0; i < numRays; i++) {
      const angle = (i * Math.PI * 2) / numRays;
      const isCardinal = i % (numRays / 4) === 0;
      const isOrdinal = i % (numRays / 8) === 0 && !isCardinal;

      let alpha = 0.12;
      let width = 0.6;
      let dash: number[] = [];

      if (isCardinal) {
        alpha = isPrimary ? 0.35 : 0.24;
        width = 1.1;
        dash = [];
      } else if (isOrdinal) {
        alpha = isPrimary ? 0.24 : 0.16;
        width = 0.8;
        dash = [10 / zoom, 5 / zoom];
      } else {
        alpha = isPrimary ? 0.15 : 0.08;
        width = 0.5;
        dash = [4 / zoom, 6 / zoom];
      }

      ctx.strokeStyle = `rgba(160, 235, 238, ${alpha})`;
      ctx.lineWidth = width / zoom;
      ctx.setLineDash(dash);

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * rayLength, cy + Math.sin(angle) * rayLength);
      ctx.stroke();
    }
  }

  ctx.restore();
}

/**
 * Draws the Antique Double Border with Filigree Corner Ornaments and Scale Checkers
 */
export function drawDecorativeBorder(
  ctx: CanvasRenderingContext2D,
  mapWidth: number,
  mapHeight: number,
  zoom: number = 1.0
): void {
  ctx.save();

  const margin = 18; // distance from map boundary
  const innerGap = 8; // gap between outer and inner border

  const x0 = margin;
  const y0 = margin;
  const w0 = mapWidth - margin * 2;
  const h0 = mapHeight - margin * 2;

  const x1 = margin + innerGap;
  const y1 = margin + innerGap;
  const w1 = w0 - innerGap * 2;
  const h1 = h0 - innerGap * 2;

  // 1. Alternating Antique Checker Margin Band between outer & inner lines
  const checkerSize = 16; // width/height of checker marks
  ctx.save();
  ctx.fillStyle = 'rgba(215, 175, 75, 0.45)'; // Pale antique gold
  ctx.strokeStyle = 'rgba(45, 30, 15, 0.85)';
  ctx.lineWidth = 0.7 / zoom;

  // Top and Bottom Checkers
  const hCount = Math.floor(w0 / checkerSize);
  for (let i = 0; i < hCount; i++) {
    if (i % 2 === 0) {
      // Top band
      ctx.fillRect(x0 + i * checkerSize, y0, checkerSize, innerGap);
      // Bottom band
      ctx.fillRect(x0 + i * checkerSize, y0 + h0 - innerGap, checkerSize, innerGap);
    }
  }

  // Left and Right Checkers
  const vCount = Math.floor(h0 / checkerSize);
  for (let i = 0; i < vCount; i++) {
    if (i % 2 === 0) {
      // Left band
      ctx.fillRect(x0, y0 + i * checkerSize, innerGap, checkerSize);
      // Right band
      ctx.fillRect(x0 + w0 - innerGap, y0 + i * checkerSize, innerGap, checkerSize);
    }
  }
  ctx.restore();

  // 2. Outer and Inner Heavy Border Lines
  ctx.strokeStyle = '#c49b3d'; // Rich Antique Brass Gold
  ctx.lineWidth = 2.2 / zoom;
  ctx.strokeRect(x0, y0, w0, h0);

  ctx.strokeStyle = '#8f6820'; // Shadowed Bronze
  ctx.lineWidth = 1.2 / zoom;
  ctx.strokeRect(x1, y1, w1, h1);

  // Very Outer Dark Frame
  ctx.strokeStyle = '#2b1b0b'; // Deep Sepia Ink
  ctx.lineWidth = 1.0 / zoom;
  ctx.strokeRect(x0 - 2, y0 - 2, w0 + 4, h0 + 4);

  // 3. Ornate Corner Brackets / Filigree Ornaments
  const drawCornerFiligree = (cornerX: number, cornerY: number, flipX: boolean, flipY: boolean) => {
    ctx.save();
    ctx.translate(cornerX, cornerY);
    ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);

    const cornerSize = 42;

    // Corner L-Bracket line
    ctx.strokeStyle = '#e6bf54'; // Bright Brass
    ctx.lineWidth = 1.8 / zoom;
    ctx.beginPath();
    ctx.moveTo(0, cornerSize);
    ctx.lineTo(0, 0);
    ctx.lineTo(cornerSize, 0);
    ctx.stroke();

    // Secondary decorative parallel scroll
    ctx.strokeStyle = '#9c7526';
    ctx.lineWidth = 1.0 / zoom;
    ctx.beginPath();
    ctx.moveTo(5, cornerSize - 8);
    ctx.lineTo(5, 5);
    ctx.lineTo(cornerSize - 8, 5);
    ctx.stroke();

    // Spiral Flourish Curve
    ctx.beginPath();
    ctx.moveTo(3, cornerSize - 6);
    ctx.bezierCurveTo(12, 12, 12, 12, cornerSize - 6, 3);
    ctx.strokeStyle = 'rgba(215, 175, 75, 0.75)';
    ctx.stroke();

    // Corner Brass Boss / Rivet
    ctx.beginPath();
    ctx.arc(8, 8, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#f5d469';
    ctx.fill();
    ctx.strokeStyle = '#362208';
    ctx.lineWidth = 0.8 / zoom;
    ctx.stroke();

    // Outer corner jewel diamond
    ctx.beginPath();
    ctx.moveTo(-4, -4);
    ctx.lineTo(0, -7);
    ctx.lineTo(4, -4);
    ctx.lineTo(0, -1);
    ctx.closePath();
    ctx.fillStyle = '#b83220'; // Crimson jewel
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  };

  // 4 Corners: Top-Left, Top-Right, Bottom-Left, Bottom-Right
  drawCornerFiligree(x0, y0, false, false);
  drawCornerFiligree(x0 + w0, y0, true, false);
  drawCornerFiligree(x0, y0 + h0, false, true);
  drawCornerFiligree(x0 + w0, y0 + h0, true, true);

  ctx.restore();
}

/**
 * Draws the authentic Checkerboard Nautical Scale Bar
 */
export function drawAntiqueScaleBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  mapWidth: number,
  worldWidthKm: number,
  zoom: number = 1.0
): void {
  ctx.save();
  ctx.translate(x, y);

  const isWorldScale = worldWidthKm >= 39000;
  const totalSegments = 12; // Maintain identical 12 segments
  const barHeight = 8;

  let segmentPx: number;
  let unitLabel: string;
  let getVal: (i: number) => number;

  if (isWorldScale) {
    // Preserve exact original nautical miles display for World map
    // 1 km = 0.621371 miles
    const worldWidthMiles = worldWidthKm * 0.621371;
    const pixelsPerMile = mapWidth / worldWidthMiles;
    const segmentMiles = 20;
    segmentPx = segmentMiles * pixelsPerMile;
    unitLabel = 'Miles';
    getVal = (i: number) => i * segmentMiles;
  } else {
    // Regional & Town maps: adjust candidate values and units (m for <1km, km for >=1km)
    const pixelsPerKm = mapWidth / worldWidthKm;
    const candidateStepsKm = [
      0.005, 0.01, 0.02, 0.025, 0.05, 0.1, 0.2, 0.25, 0.5,
      1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000,
    ];

    let chosenStepKm = candidateStepsKm[0];
    let found = false;
    for (const step of candidateStepsKm) {
      const px = step * pixelsPerKm;
      if (px >= 10 && px <= 35) {
        chosenStepKm = step;
        found = true;
        break;
      }
    }
    if (!found) {
      let minDiff = Infinity;
      for (const step of candidateStepsKm) {
        const diff = Math.abs(step * pixelsPerKm - 20);
        if (diff < minDiff) {
          minDiff = diff;
          chosenStepKm = step;
        }
      }
    }

    segmentPx = chosenStepKm * pixelsPerKm;
    if (chosenStepKm < 1) {
      unitLabel = 'm';
      const stepMeters = Math.round(chosenStepKm * 1000);
      getVal = (i: number) => i * stepMeters;
    } else {
      unitLabel = 'km';
      getVal = (i: number) => i * chosenStepKm;
    }
  }

  // Background Parchment Plaque
  const plaqueW = totalSegments * segmentPx + 48;
  const plaqueH = 34;
  ctx.fillStyle = 'rgba(28, 22, 16, 0.88)';
  ctx.strokeStyle = '#9c772c';
  ctx.lineWidth = 1.2 / zoom;
  ctx.beginPath();
  ctx.roundRect(-8, -18, plaqueW, plaqueH, 4);
  ctx.fill();
  ctx.stroke();

  // Alternating Crimson & Cream Checker Blocks
  for (let i = 0; i < totalSegments; i++) {
    const sx = i * segmentPx;
    const isCream = i % 2 === 0;

    ctx.fillStyle = isCream ? '#f4eedb' : '#962b1a'; // Cream vs Crimson
    ctx.fillRect(sx, 0, segmentPx, barHeight);

    ctx.strokeStyle = '#2d1c08';
    ctx.lineWidth = 0.8 / zoom;
    ctx.strokeRect(sx, 0, segmentPx, barHeight);

    // Number label every segment
    const val = getVal(i);
    ctx.font = `bold ${Math.max(9, Math.round(9 / zoom))}px "Cinzel", "Times New Roman", serif`;
    ctx.fillStyle = '#e8d4a2';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(String(val), sx, -2);
  }

  // Final label
  ctx.fillText(String(getVal(totalSegments)), totalSegments * segmentPx, -2);

  // Unit label
  ctx.font = `italic bold ${Math.max(10, Math.round(10 / zoom))}px "Cinzel", serif`;
  ctx.fillStyle = '#f3cc65';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(unitLabel, totalSegments * segmentPx + 8, barHeight / 2);

  ctx.restore();
}
