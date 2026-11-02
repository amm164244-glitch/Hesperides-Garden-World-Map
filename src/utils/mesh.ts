import { Delaunay } from 'd3-delaunay';
import { Mulberry32 } from './prng';

export interface MeshData {
  width: number;
  height: number;
  points: Float64Array; // [x0, y0, x1, y1, ...]
  cellCount: number;
  polygons: [number, number][][];
  neighbors: number[][];
  centroids: { x: number; y: number }[];
}

/**
 * Generates a Voronoi mesh from deterministic jittered points with Lloyd's relaxation
 * to create natural, organic, evenly-distributed cells.
 */
export function generateMesh(
  width: number,
  height: number,
  cellCount: number,
  seed: number
): MeshData {
  const rng = new Mulberry32(seed);

  // We use jittered grid distribution for fast, uniform Poisson-like seeding
  const points = new Float64Array(cellCount * 2);
  const aspect = width / height;
  const cols = Math.round(Math.sqrt(cellCount * aspect));
  const rows = Math.round(cellCount / cols);
  const cellW = width / cols;
  const cellH = height / rows;

  let idx = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (idx >= cellCount) break;
      // Jitter within cell with padding
      const jx = (c + 0.15 + rng.next() * 0.7) * cellW;
      const jy = (r + 0.15 + rng.next() * 0.7) * cellH;
      points[idx * 2] = Math.max(2, Math.min(width - 2, jx));
      points[idx * 2 + 1] = Math.max(2, Math.min(height - 2, jy));
      idx++;
    }
  }

  // Fill any remaining points if rows*cols was less than cellCount
  while (idx < cellCount) {
    points[idx * 2] = 2 + rng.next() * (width - 4);
    points[idx * 2 + 1] = 2 + rng.next() * (height - 4);
    idx++;
  }

  // Build Delaunay and Voronoi diagram
  let delaunay = new Delaunay(points);
  let voronoi = delaunay.voronoi([0, 0, width, height]);

  // One pass of Lloyd relaxation for smooth hexagonal-like cell shapes
  const relaxedPoints = new Float64Array(cellCount * 2);
  for (let i = 0; i < cellCount; i++) {
    const poly = voronoi.cellPolygon(i);
    if (poly && poly.length >= 3) {
      let area = 0;
      let cx = 0;
      let cy = 0;
      for (let j = 0; j < poly.length - 1; j++) {
        const x0 = poly[j][0];
        const y0 = poly[j][1];
        const x1 = poly[j + 1][0];
        const y1 = poly[j + 1][1];
        const a = x0 * y1 - x1 * y0;
        area += a;
        cx += (x0 + x1) * a;
        cy += (y0 + y1) * a;
      }
      area *= 0.5;
      if (Math.abs(area) > 1e-4) {
        cx /= 6 * area;
        cy /= 6 * area;
        relaxedPoints[i * 2] = Math.max(2, Math.min(width - 2, cx));
        relaxedPoints[i * 2 + 1] = Math.max(2, Math.min(height - 2, cy));
      } else {
        relaxedPoints[i * 2] = points[i * 2];
        relaxedPoints[i * 2 + 1] = points[i * 2 + 1];
      }
    } else {
      relaxedPoints[i * 2] = points[i * 2];
      relaxedPoints[i * 2 + 1] = points[i * 2 + 1];
    }
  }

  // Final Voronoi from relaxed points
  delaunay = new Delaunay(relaxedPoints);
  voronoi = delaunay.voronoi([0, 0, width, height]);

  const polygons: [number, number][][] = new Array(cellCount);
  const neighbors: number[][] = new Array(cellCount);
  const centroids: { x: number; y: number }[] = new Array(cellCount);

  for (let i = 0; i < cellCount; i++) {
    const poly = voronoi.cellPolygon(i);
    // If polygon is edge or malformed, provide fallback bounding points
    if (poly && poly.length > 0) {
      polygons[i] = poly.map((pt) => [pt[0], pt[1]]);
    } else {
      const px = relaxedPoints[i * 2];
      const py = relaxedPoints[i * 2 + 1];
      polygons[i] = [
        [px - 2, py - 2],
        [px + 2, py - 2],
        [px + 2, py + 2],
        [px - 2, py + 2],
      ];
    }

    centroids[i] = {
      x: relaxedPoints[i * 2],
      y: relaxedPoints[i * 2 + 1],
    };

    // Neighbors from Delaunay triangulation
    const nList: number[] = [];
    for (const n of delaunay.neighbors(i)) {
      nList.push(n);
    }
    neighbors[i] = nList;
  }

  return {
    width,
    height,
    points: relaxedPoints,
    cellCount,
    polygons,
    neighbors,
    centroids,
  };
}
