/**
 * Parametric Fantasy Cartography Symbol Generator
 * Produces ultra-detailed Tolkien & Inkarnate style hand-drawn illustrations
 * onto high-resolution transparent canvases for custom map assets.
 */

export interface MountainParams {
  height: number;             // 50 .. 120
  baseWidth: number;          // 60 .. 140
  peakSharpness: number;      // 0.2 .. 0.9
  asymmetry: number;          // -0.4 .. +0.4 (flank slant)
  snowcapRatio: number;       // 0.0 .. 0.6
  shadowHatchDensity: number; // 4 .. 14 (number of shadow hatch tiers)
  cragCount: number;          // 1 .. 5 (side spurs)
  foothills: number;          // 0 .. 3
  seed: number;
}

export interface CastleParams {
  towerCount: 1 | 2 | 3 | 4;
  keepHeight: number;         // 60 .. 120
  wallWidth: number;          // 60 .. 130
  crenellations: boolean;     // Has battlements
  roofStyle: 'crenellated' | 'spire' | 'conical' | 'dome';
  roofColor: 'crimson' | 'royal_blue' | 'slate' | 'gold';
  flags: boolean;
  gateStyle: 'arch' | 'portcullis';
  seed: number;
}

export interface TreeParams {
  type: 'pine' | 'oak' | 'cypress' | 'dead';
  treeCount: number;          // 1 .. 6
  height: number;             // 40 .. 90
  spread: number;             // 30 .. 80
  foliageTone: 'evergreen' | 'moss' | 'autumn' | 'withered';
  seed: number;
}

// Pseudo-random generator from seed
function pseudoRandom(seed: number) {
  let s = (seed ^ 0x9e3779b9) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Procedurally draws a high-detail mountain onto a Canvas context
 */
export function drawParametricMountain(
  ctx: CanvasRenderingContext2D,
  params: MountainParams,
  cx: number,
  cy: number
): void {
  const rng = pseudoRandom(params.seed);
  const {
    height,
    baseWidth,
    asymmetry,
    snowcapRatio,
    shadowHatchDensity,
    cragCount,
    foothills,
  } = params;

  ctx.save();
  ctx.translate(cx, cy);

  const peakX = asymmetry * (baseWidth * 0.35);
  const peakY = -height;
  const leftX = -baseWidth * 0.5;
  const rightX = baseWidth * 0.5;
  const baseY = 0;

  // 1. Solid Silhouette Foundation (Ivory cream)
  ctx.beginPath();
  ctx.moveTo(peakX, peakY);
  ctx.lineTo(rightX, baseY);
  ctx.lineTo(leftX, baseY);
  ctx.closePath();
  ctx.fillStyle = '#faf6ed';
  ctx.fill();

  // 2. Generate organic jagged central ridgeline
  const ridgePoints: [number, number][] = [[peakX, peakY]];
  const segments = 10;
  let curX = peakX;
  let curY = peakY;
  for (let i = 1; i < segments; i++) {
    const t = i / segments;
    const targetY = peakY + t * height;
    const jitter = (rng() - 0.48) * (baseWidth * 0.12);
    curX += jitter * 0.8;
    curY = targetY;
    ridgePoints.push([curX, curY]);
  }
  ridgePoints.push([peakX + (rng() - 0.5) * 8, baseY]);

  // 3. Right Shadow Flank Fill
  ctx.beginPath();
  ctx.moveTo(peakX, peakY);
  for (const pt of ridgePoints) {
    ctx.lineTo(pt[0], pt[1]);
  }
  ctx.lineTo(rightX, baseY);
  ctx.closePath();
  ctx.fillStyle = '#9e9282';
  ctx.fill();

  // 4. Secondary dark shading wash along the ridge
  ctx.beginPath();
  ctx.moveTo(peakX, peakY);
  for (const pt of ridgePoints) {
    ctx.lineTo(pt[0], pt[1]);
  }
  ctx.lineTo(peakX + baseWidth * 0.22, baseY);
  ctx.closePath();
  ctx.fillStyle = 'rgba(74, 65, 54, 0.4)';
  ctx.fill();

  // 5. Snow Cap Highlight (if snowcapRatio > 0)
  if (snowcapRatio > 0.05) {
    const snowH = height * snowcapRatio;
    ctx.beginPath();
    ctx.moveTo(peakX, peakY);
    ctx.lineTo(leftX * 0.45 * snowcapRatio + peakX, peakY + snowH);
    // Jagged bottom edge
    const snowSteps = 6;
    for (let s = 1; s <= snowSteps; s++) {
      const st = s / snowSteps;
      const sx = (leftX * 0.45 * (1 - st) + rightX * 0.45 * st) * snowcapRatio + peakX;
      const sy = peakY + snowH + (rng() - 0.5) * 6;
      ctx.lineTo(sx, sy);
    }
    ctx.lineTo(rightX * 0.45 * snowcapRatio + peakX, peakY + snowH);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#26221c';
    ctx.lineWidth = 1.0;
    ctx.stroke();
  }

  // 6. Western Sunlit Flank Texture Crags
  ctx.strokeStyle = 'rgba(60, 52, 42, 0.65)';
  ctx.lineWidth = 1.1;
  ctx.lineCap = 'round';
  for (let c = 0; c < cragCount; c++) {
    const cyRatio = 0.25 + (c / Math.max(1, cragCount)) * 0.55;
    const startY = peakY + cyRatio * height;
    const startX = peakX - cyRatio * (baseWidth * 0.35);
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(startX + 6, startY + 8);
    ctx.lineTo(startX + 3, startY + 14);
    ctx.stroke();
  }

  // 7. Eastern Shadow Flank Fine Hatching
  ctx.strokeStyle = '#26221c';
  ctx.lineWidth = 0.9;
  for (let hTier = 1; hTier <= shadowHatchDensity; hTier++) {
    const t = hTier / (shadowHatchDensity + 1);
    const yStart = peakY + t * height;
    const ptNear = ridgePoints[Math.min(ridgePoints.length - 1, Math.floor(t * ridgePoints.length))];
    const xStart = ptNear ? ptNear[0] + 2 : peakX + 4;
    const lineLen = 8 + (1 - t) * 12 + rng() * 6;

    ctx.beginPath();
    ctx.moveTo(xStart, yStart);
    ctx.lineTo(xStart + lineLen, yStart + 5 + rng() * 3);
    ctx.stroke();
  }

  // 8. Outer Ink Outline
  ctx.strokeStyle = '#181512';
  ctx.lineWidth = 1.8;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(leftX, baseY);
  ctx.lineTo(peakX - baseWidth * 0.25, peakY * 0.55);
  ctx.lineTo(peakX - 8, peakY * 0.85);
  ctx.lineTo(peakX, peakY);
  ctx.lineTo(peakX + 10, peakY * 0.8);
  ctx.lineTo(peakX + baseWidth * 0.28, peakY * 0.45);
  ctx.lineTo(rightX, baseY);
  ctx.stroke();

  // 9. Central Ridge Bold Line
  ctx.lineWidth = 2.0;
  ctx.beginPath();
  ctx.moveTo(ridgePoints[0][0], ridgePoints[0][1]);
  for (let i = 1; i < ridgePoints.length; i++) {
    ctx.lineTo(ridgePoints[i][0], ridgePoints[i][1]);
  }
  ctx.stroke();

  // 10. Foothill Mounds (Base Clumps)
  if (foothills > 0) {
    ctx.lineWidth = 1.2;
    for (let f = 0; f < foothills; f++) {
      const fx = leftX + (f + 1) * (baseWidth / (foothills + 1)) * 0.7;
      const fr = 12 + rng() * 8;
      ctx.beginPath();
      ctx.ellipse(fx, baseY, fr, fr * 0.6, 0, Math.PI, 0);
      ctx.fillStyle = '#ebe1cb';
      ctx.fill();
      ctx.strokeStyle = '#181512';
      ctx.stroke();
    }
  }

  ctx.restore();
}

/**
 * Procedurally draws a high-detail castle onto a Canvas context
 */
export function drawParametricCastle(
  ctx: CanvasRenderingContext2D,
  params: CastleParams,
  cx: number,
  cy: number
): void {
  const {
    towerCount,
    keepHeight,
    wallWidth,
    crenellations,
    roofStyle,
    roofColor,
    flags,
    gateStyle,
  } = params;

  ctx.save();
  ctx.translate(cx, cy);

  const stoneLight = '#ebe2d5';
  const stoneShadow = '#b8aa97';
  const inkDark = '#1a1814';

  const roofFill =
    roofColor === 'crimson'
      ? '#882d24'
      : roofColor === 'royal_blue'
      ? '#264e70'
      : roofColor === 'gold'
      ? '#b8860b'
      : '#4a5568';

  const keepW = wallWidth * 0.55;
  const keepH = keepHeight;
  const wallH = keepHeight * 0.55;

  // 1. Curtain Wall (Background)
  ctx.fillStyle = stoneShadow;
  ctx.fillRect(-wallWidth * 0.5, -wallH, wallWidth, wallH);
  ctx.strokeStyle = inkDark;
  ctx.lineWidth = 1.4;
  ctx.strokeRect(-wallWidth * 0.5, -wallH, wallWidth, wallH);

  // 2. Main Center Keep
  ctx.fillStyle = stoneLight;
  ctx.fillRect(-keepW * 0.5, -keepH, keepW, keepH);
  ctx.strokeRect(-keepW * 0.5, -keepH, keepW, keepH);

  // Keep shadow side (right 40%)
  ctx.fillStyle = 'rgba(60, 50, 40, 0.25)';
  ctx.fillRect(keepW * 0.1, -keepH, keepW * 0.4, keepH);

  // 3. Battlements / Crenellations
  if (crenellations) {
    const cW = 4;
    const cH = 4;
    ctx.fillStyle = stoneLight;
    for (let x = -keepW * 0.5; x < keepW * 0.5; x += cW * 2) {
      ctx.fillRect(x, -keepH - cH, cW, cH);
      ctx.strokeRect(x, -keepH - cH, cW, cH);
    }
  }

  // 4. Roof on Main Keep (if spire / conical / dome)
  if (roofStyle !== 'crenellated') {
    ctx.fillStyle = roofFill;
    ctx.beginPath();
    if (roofStyle === 'spire') {
      ctx.moveTo(-keepW * 0.55, -keepH);
      ctx.lineTo(0, -keepH - 28);
      ctx.lineTo(keepW * 0.55, -keepH);
    } else if (roofStyle === 'conical') {
      ctx.moveTo(-keepW * 0.55, -keepH);
      ctx.lineTo(0, -keepH - 18);
      ctx.lineTo(keepW * 0.55, -keepH);
    } else if (roofStyle === 'dome') {
      ctx.ellipse(0, -keepH, keepW * 0.5, 14, 0, Math.PI, 0);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = inkDark;
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // Spire shadow
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.moveTo(0, -keepH - (roofStyle === 'spire' ? 28 : 18));
    ctx.lineTo(keepW * 0.55, -keepH);
    ctx.lineTo(0, -keepH);
    ctx.closePath();
    ctx.fill();
  }

  // 5. Flanking Towers (based on towerCount)
  const turretW = keepW * 0.32;
  const turretH = keepHeight * 0.85;

  const drawTurret = (tx: number) => {
    ctx.fillStyle = stoneLight;
    ctx.fillRect(tx - turretW * 0.5, -turretH, turretW, turretH);
    ctx.strokeStyle = inkDark;
    ctx.lineWidth = 1.3;
    ctx.strokeRect(tx - turretW * 0.5, -turretH, turretW, turretH);

    // Turret roof
    ctx.fillStyle = roofFill;
    ctx.beginPath();
    ctx.moveTo(tx - turretW * 0.6, -turretH);
    ctx.lineTo(tx, -turretH - 16);
    ctx.lineTo(tx + turretW * 0.6, -turretH);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    if (flags) {
      // Flagpole
      ctx.strokeStyle = inkDark;
      ctx.beginPath();
      ctx.moveTo(tx, -turretH - 16);
      ctx.lineTo(tx, -turretH - 24);
      ctx.stroke();

      // Flag
      ctx.fillStyle = roofFill;
      ctx.beginPath();
      ctx.moveTo(tx, -turretH - 24);
      ctx.lineTo(tx + 6, -turretH - 21);
      ctx.lineTo(tx, -turretH - 18);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  };

  if (towerCount >= 2) {
    drawTurret(-wallWidth * 0.45);
    drawTurret(wallWidth * 0.45);
  }
  if (towerCount >= 3) {
    drawTurret(0);
  }

  // 6. Gate Entrance
  const gateW = 10;
  const gateH = 14;
  ctx.fillStyle = '#221a14';
  ctx.beginPath();
  ctx.rect(-gateW * 0.5, -gateH, gateW, gateH);
  ctx.arc(0, -gateH, gateW * 0.5, Math.PI, 0);
  ctx.fill();
  ctx.strokeStyle = inkDark;
  ctx.stroke();

  if (gateStyle === 'portcullis') {
    ctx.strokeStyle = '#8a7765';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(0, -gateH * 1.5);
    ctx.lineTo(0, 0);
    ctx.moveTo(-3, -gateH * 1.3);
    ctx.lineTo(-3, 0);
    ctx.moveTo(3, -gateH * 1.3);
    ctx.lineTo(3, 0);
    ctx.moveTo(-gateW * 0.5, -gateH * 0.6);
    ctx.lineTo(gateW * 0.5, -gateH * 0.6);
    ctx.stroke();
  }

  // 7. Stone Masonry Details
  ctx.strokeStyle = 'rgba(74, 65, 54, 0.4)';
  ctx.lineWidth = 0.8;
  ctx.strokeRect(-keepW * 0.3, -keepH * 0.7, 4, 2);
  ctx.strokeRect(keepW * 0.15, -keepH * 0.6, 5, 2.5);
  ctx.strokeRect(-keepW * 0.2, -keepH * 0.35, 6, 2.5);

  ctx.restore();
}

/**
 * Procedurally draws high-detail trees/forest onto a Canvas context
 */
export function drawParametricTree(
  ctx: CanvasRenderingContext2D,
  params: TreeParams,
  cx: number,
  cy: number
): void {
  const rng = pseudoRandom(params.seed);
  const { type, treeCount, height, spread, foliageTone } = params;

  ctx.save();
  ctx.translate(cx, cy);

  const darkGreen =
    foliageTone === 'evergreen'
      ? '#1a3b2b'
      : foliageTone === 'moss'
      ? '#3b5224'
      : foliageTone === 'autumn'
      ? '#82451c'
      : '#4a4135';

  const lightGreen =
    foliageTone === 'evergreen'
      ? '#2f6148'
      : foliageTone === 'moss'
      ? '#577833'
      : foliageTone === 'autumn'
      ? '#b86628'
      : '#6e6252';

  const inkDark = '#1a1814';

  const drawSinglePine = (tx: number, ty: number, s: number) => {
    ctx.save();
    ctx.translate(tx, ty);
    ctx.scale(s, s);

    // Trunk
    ctx.strokeStyle = '#4a3726';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 4);
    ctx.stroke();

    // 4 Needle Tiers
    const tiers = 4;
    for (let i = 0; i < tiers; i++) {
      const tyPos = -height * 0.35 + i * (height * 0.18);
      const tw = (height * 0.18) * (0.6 + i * 0.3);
      const th = height * 0.25;

      ctx.beginPath();
      ctx.moveTo(0, tyPos);
      ctx.lineTo(-tw, tyPos + th);
      ctx.lineTo(tw, tyPos + th);
      ctx.closePath();
      ctx.fillStyle = i % 2 === 0 ? darkGreen : lightGreen;
      ctx.fill();
      ctx.strokeStyle = inkDark;
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }
    ctx.restore();
  };

  const drawSingleOak = (tx: number, ty: number, s: number) => {
    ctx.save();
    ctx.translate(tx, ty);
    ctx.scale(s, s);

    // Trunk
    ctx.fillStyle = '#4a3726';
    ctx.beginPath();
    ctx.moveTo(-3, 0);
    ctx.lineTo(-2, -height * 0.3);
    ctx.lineTo(2, -height * 0.3);
    ctx.lineTo(3, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = inkDark;
    ctx.lineWidth = 1.0;
    ctx.stroke();

    // Cloud-like Foliage
    const r = height * 0.28;
    const cyPos = -height * 0.55;

    ctx.fillStyle = lightGreen;
    ctx.beginPath();
    ctx.arc(0, cyPos, r, 0, Math.PI * 2);
    ctx.arc(-r * 0.6, cyPos + 4, r * 0.75, 0, Math.PI * 2);
    ctx.arc(r * 0.6, cyPos + 4, r * 0.75, 0, Math.PI * 2);
    ctx.arc(0, cyPos - 6, r * 0.7, 0, Math.PI * 2);
    ctx.fill();

    // Shadow underside
    ctx.fillStyle = darkGreen;
    ctx.beginPath();
    ctx.arc(2, cyPos + 6, r * 0.7, 0, Math.PI);
    ctx.fill();

    ctx.strokeStyle = inkDark;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.restore();
  };

  // Draw clustered trees sorted by Y
  const treeList: { x: number; y: number; s: number }[] = [];
  for (let i = 0; i < treeCount; i++) {
    const s = 0.8 + rng() * 0.35;
    const tx = (rng() - 0.5) * spread;
    const ty = (rng() - 0.5) * (spread * 0.4);
    treeList.push({ x: tx, y: ty, s });
  }

  treeList.sort((a, b) => a.y - b.y);

  for (const t of treeList) {
    if (type === 'pine') {
      drawSinglePine(t.x, t.y, t.s);
    } else {
      drawSingleOak(t.x, t.y, t.s);
    }
  }

  ctx.restore();
}

/**
 * Renders any parametric configuration to a high-resolution transparent Data URL
 */
export function generateSymbolDataUrl(
  type: 'mountain' | 'castle' | 'tree',
  params: MountainParams | CastleParams | TreeParams,
  width: number = 256,
  height: number = 256
): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const cx = width * 0.5;
  const cy = height * 0.82; // Anchor slightly above bottom edge

  if (type === 'mountain') {
    drawParametricMountain(ctx, params as MountainParams, cx, cy);
  } else if (type === 'castle') {
    drawParametricCastle(ctx, params as CastleParams, cx, cy);
  } else if (type === 'tree') {
    drawParametricTree(ctx, params as TreeParams, cx, cy);
  }

  return canvas.toDataURL('image/png');
}
