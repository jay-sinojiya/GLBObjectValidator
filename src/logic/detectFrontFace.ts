import {
  DEFAULT_ROOM_OBJECT_FRONT_FACE,
  ROOM_OBJECT_FRONT_FACE_CONFIRM_BELOW,
  ROOM_OBJECT_FRONT_FACES,
  type RoomObjectFrontFace,
} from "./frontFace";

export interface FrontFaceSample {
  x: number;
  y: number;
  z: number;
  meshKey: string;
}

export interface FrontFaceDetection {
  frontFace: RoomObjectFrontFace;
  confidence: number;
  needsConfirm: boolean;
  scores: Record<RoomObjectFrontFace, number>;
}

const EMPTY_SCORES: Record<RoomObjectFrontFace, number> = {
  "+z": 0,
  "-z": 0,
  "+x": 0,
  "-x": 0,
};

function axisCoord(sample: FrontFaceSample, face: RoomObjectFrontFace): number {
  switch (face) {
    case "+x":
      return sample.x;
    case "-x":
      return -sample.x;
    case "+z":
      return sample.z;
    case "-z":
      return -sample.z;
  }
}

function crossCoord(sample: FrontFaceSample, face: RoomObjectFrontFace): [number, number] {
  if (face === "+z" || face === "-z") return [sample.x, sample.y];
  return [sample.z, sample.y];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[index] ?? 0;
}

interface FaceMetrics {
  score: number;
  flatPanel: boolean;
  coverage: number;
}

function scoreFace(samples: FrontFaceSample[], face: RoomObjectFrontFace): FaceMetrics {
  let tMin = Number.POSITIVE_INFINITY;
  let tMax = Number.NEGATIVE_INFINITY;
  let c0Min = Number.POSITIVE_INFINITY;
  let c0Max = Number.NEGATIVE_INFINITY;
  let c1Min = Number.POSITIVE_INFINITY;
  let c1Max = Number.NEGATIVE_INFINITY;

  const coords: number[] = new Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i];
    if (!sample) continue;
    const t = axisCoord(sample, face);
    coords[i] = t;
    if (t < tMin) tMin = t;
    if (t > tMax) tMax = t;
    const [c0, c1] = crossCoord(sample, face);
    if (c0 < c0Min) c0Min = c0;
    if (c0 > c0Max) c0Max = c0;
    if (c1 < c1Min) c1Min = c1;
    if (c1 > c1Max) c1Max = c1;
  }

  const span = tMax - tMin;
  const cross0 = Math.max(c0Max - c0Min, 1e-6);
  const cross1 = Math.max(c1Max - c1Min, 1e-6);
  if (!Number.isFinite(span) || span < 1e-5) {
    return { score: 0, flatPanel: false, coverage: 0 };
  }

  const normalized: number[] = new Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    normalized[i] = ((coords[i] ?? tMin) - tMin) / span;
  }

  const sorted = normalized.slice().sort((a, b) => a - b);
  const p70 = percentile(sorted, 0.7);
  const p98 = percentile(sorted, 0.98);
  const protrusion = Math.max(0, p98 - p70);

  const outer: number[] = [];
  const grid = 8;
  const cells = new Set<number>();
  let depthSum = 0;
  let depthSq = 0;

  for (let i = 0; i < samples.length; i += 1) {
    const u = normalized[i] ?? 0;
    if (u < 0.82) continue;
    const sample = samples[i];
    if (!sample) continue;
    outer.push(u);
    depthSum += u;
    depthSq += u * u;
    const [c0, c1] = crossCoord(sample, face);
    const gx = Math.min(grid - 1, Math.max(0, Math.floor(((c0 - c0Min) / cross0) * grid)));
    const gy = Math.min(grid - 1, Math.max(0, Math.floor(((c1 - c1Min) / cross1) * grid)));
    cells.add(gx + gy * grid);
  }

  const coverage = cells.size / (grid * grid);
  const outerCount = outer.length;
  const mean = outerCount > 0 ? depthSum / outerCount : 0;
  const variance = outerCount > 0 ? Math.max(0, depthSq / outerCount - mean * mean) : 0;
  const stdev = Math.sqrt(variance);
  const flatPanel = outerCount >= 12 && coverage >= 0.34 && stdev < 0.045;

  const byMesh = new Map<string, { count: number; min: number; max: number; sum: number }>();
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i];
    if (!sample) continue;
    const u = normalized[i] ?? 0;
    let bucket = byMesh.get(sample.meshKey);
    if (!bucket) {
      bucket = { count: 0, min: u, max: u, sum: 0 };
      byMesh.set(sample.meshKey, bucket);
    }
    bucket.count += 1;
    bucket.sum += u;
    if (u < bucket.min) bucket.min = u;
    if (u > bucket.max) bucket.max = u;
  }

  let smallOnFace = 0;
  let smallMeshes = 0;
  for (const bucket of byMesh.values()) {
    if (bucket.count > 48) continue;
    if (bucket.max - bucket.min > 0.22) continue;
    smallMeshes += 1;
    const centroid = bucket.sum / bucket.count;
    if (centroid >= 0.72) smallOnFace += 1;
  }
  const detail = smallMeshes > 0 ? smallOnFace / smallMeshes : 0;

  let tipSpread = 0;
  if (outerCount >= 6) {
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let syy = 0;
    let n = 0;
    for (let i = 0; i < samples.length; i += 1) {
      if ((normalized[i] ?? 0) < 0.9) continue;
      const sample = samples[i];
      if (!sample) continue;
      const [c0, c1] = crossCoord(sample, face);
      const nx = (c0 - c0Min) / cross0;
      const ny = (c1 - c1Min) / cross1;
      sx += nx;
      sy += ny;
      sxx += nx * nx;
      syy += ny * ny;
      n += 1;
    }
    if (n > 0) {
      const mx = sx / n;
      const my = sy / n;
      tipSpread = Math.max(0, sxx / n - mx * mx) + Math.max(0, syy / n - my * my);
    }
  }

  const score =
    protrusion * 1.35 + detail * 1.7 + tipSpread * 0.65 + (flatPanel ? -3.2 : coverage * 0.2);

  return { score, flatPanel, coverage };
}

/** Same scorer as the room planner. A flat rear panel is penalized; protruding details vote for the front. */
export function scoreFrontFaceSamples(samples: FrontFaceSample[]): FrontFaceDetection {
  if (samples.length < 8) {
    return {
      frontFace: DEFAULT_ROOM_OBJECT_FRONT_FACE,
      confidence: 0,
      needsConfirm: true,
      scores: { ...EMPTY_SCORES },
    };
  }

  const metrics = {} as Record<RoomObjectFrontFace, FaceMetrics>;
  const scores = { ...EMPTY_SCORES };
  for (const face of ROOM_OBJECT_FRONT_FACES) {
    const metric = scoreFace(samples, face);
    metrics[face] = metric;
    scores[face] = metric.score;
  }

  const ranked = [...ROOM_OBJECT_FRONT_FACES].sort((a, b) => scores[b] - scores[a]);
  const best = ranked[0] ?? DEFAULT_ROOM_OBJECT_FRONT_FACE;
  const second = ranked[1] ?? best;
  const bestScore = scores[best];
  const secondScore = scores[second];
  const gap = bestScore - secondScore;
  let confidence = gap / (Math.abs(bestScore) + 0.85);
  if (confidence < 0) confidence = 0;
  if (confidence > 1) confidence = 1;

  const opposite: RoomObjectFrontFace =
    best === "+z" ? "-z" : best === "-z" ? "+z" : best === "+x" ? "-x" : "+x";
  const bestMetric = metrics[best];
  const oppositeMetric = metrics[opposite];
  if (bestMetric && oppositeMetric && oppositeMetric.flatPanel && !bestMetric.flatPanel) {
    confidence *= 0.62;
  }

  return {
    frontFace: best,
    confidence,
    needsConfirm: confidence < ROOM_OBJECT_FRONT_FACE_CONFIRM_BELOW,
    scores,
  };
}
