import {
  wallYawForObjectFrontFace,
  type RoomObjectFrontFace,
  type RoomWallId,
} from "./frontFace";

/** Same inset the room planner uses in `roomPlacementBounds.ts`. */
export const ROOM_PLACEMENT_WALL_INSET = 0.03;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface ObjectLocalExtents {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface RoomPlacementBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface RoomContext {
  floorY: number;
  ceilingY: number;
  bounds: RoomPlacementBounds;
}

/**
 * Test room matches the planner's interior-bounds + inset.
 * Visual wall inner faces sit 3cm outside `bounds` (the planner's
 * `computeRoomPlacementBounds` inset). Wall snap adds another 3cm,
 * so geometry rests 6cm off the visible wall — same as the room planner.
 */
export const TEST_ROOM: RoomContext = {
  floorY: 0,
  ceilingY: 2.8,
  bounds: {
    minX: -2.97,
    maxX: 2.97,
    minZ: -2.47,
    maxZ: 2.47,
  },
};

/** Inner face of the visible wall meshes (meters). */
export const TEST_ROOM_INTERIOR = {
  minX: -3,
  maxX: 3,
  minZ: -2.5,
  maxZ: 2.5,
  floorY: 0,
  ceilingY: 2.8,
};

export interface WorldAabb {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function roundVec3(vector: Vec3, decimals = 4): Vec3 {
  const factor = 10 ** decimals;
  return {
    x: Math.round(vector.x * factor) / factor,
    y: Math.round(vector.y * factor) / factor,
    z: Math.round(vector.z * factor) / factor,
  };
}

export function computeWorldAabbFromRoot(
  position: Vec3,
  rotationYDeg: number,
  local: ObjectLocalExtents,
  scale = 1
): WorldAabb {
  const rotY = degToRad(rotationYDeg);
  const cos = Math.cos(rotY);
  const sin = Math.sin(rotY);
  const corners: [number, number, number][] = [
    [local.minX, local.minY, local.minZ],
    [local.maxX, local.minY, local.minZ],
    [local.minX, local.maxY, local.minZ],
    [local.maxX, local.maxY, local.minZ],
    [local.minX, local.minY, local.maxZ],
    [local.maxX, local.minY, local.maxZ],
    [local.minX, local.maxY, local.maxZ],
    [local.maxX, local.maxY, local.maxZ],
  ];

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (const [lx, ly, lz] of corners) {
    const scaledX = lx * scale;
    const scaledY = ly * scale;
    const scaledZ = lz * scale;
    const wx = position.x + scaledX * cos + scaledZ * sin;
    const wy = position.y + scaledY;
    const wz = position.z - scaledX * sin + scaledZ * cos;
    minX = Math.min(minX, wx);
    maxX = Math.max(maxX, wx);
    minY = Math.min(minY, wy);
    maxY = Math.max(maxY, wy);
    minZ = Math.min(minZ, wz);
    maxZ = Math.max(maxZ, wz);
  }

  return { minX, maxX, minY, maxY, minZ, maxZ };
}

function axisContainDelta(min: number, max: number, limitMin: number, limitMax: number): number {
  const size = max - min;
  const room = limitMax - limitMin;
  if (size >= room - 1e-4) {
    return (limitMin + limitMax) * 0.5 - (min + max) * 0.5;
  }
  if (min < limitMin) return limitMin - min;
  if (max > limitMax) return limitMax - max;
  return 0;
}

function verticalContainDelta(
  aabb: { minY: number; maxY: number },
  context: RoomContext,
  surface: RoomWallId | "floor"
): number {
  const { floorY, ceilingY } = context;
  const height = aabb.maxY - aabb.minY;
  const roomHeight = ceilingY - floorY;

  if (surface === "floor") {
    if (height >= roomHeight - 1e-4) return floorY - aabb.minY;
    let dy = floorY - aabb.minY;
    if (aabb.maxY + dy > ceilingY) dy -= aabb.maxY + dy - ceilingY;
    return dy;
  }

  return axisContainDelta(aabb.minY, aabb.maxY, floorY, ceilingY);
}

function snapWallDepthToInteriorFace(
  aabb: WorldAabb,
  wallId: RoomWallId,
  bounds: RoomPlacementBounds
): Vec3 {
  switch (wallId) {
    case "back":
      return { x: 0, y: 0, z: bounds.minZ + ROOM_PLACEMENT_WALL_INSET - aabb.minZ };
    case "front":
      return { x: 0, y: 0, z: bounds.maxZ - ROOM_PLACEMENT_WALL_INSET - aabb.maxZ };
    case "left":
      return { x: bounds.minX + ROOM_PLACEMENT_WALL_INSET - aabb.minX, y: 0, z: 0 };
    case "right":
      return { x: bounds.maxX - ROOM_PLACEMENT_WALL_INSET - aabb.maxX, y: 0, z: 0 };
  }
}

export function clampRootInsideInterior(
  position: Vec3,
  rotationYDeg: number,
  local: ObjectLocalExtents,
  context: RoomContext,
  surface: RoomWallId | "floor",
  scale = 1
): Vec3 {
  let pos = { ...position };
  const { bounds } = context;

  for (let pass = 0; pass < 8; pass += 1) {
    const aabb = computeWorldAabbFromRoot(pos, rotationYDeg, local, scale);
    const dx = axisContainDelta(aabb.minX, aabb.maxX, bounds.minX, bounds.maxX);
    const dz = axisContainDelta(aabb.minZ, aabb.maxZ, bounds.minZ, bounds.maxZ);
    const dy = verticalContainDelta(aabb, context, surface);

    if (Math.abs(dx) >= 1e-6 || Math.abs(dy) >= 1e-6 || Math.abs(dz) >= 1e-6) {
      pos = { x: pos.x + dx, y: pos.y + dy, z: pos.z + dz };
      continue;
    }

    if (surface !== "floor") {
      const snappedAabb = computeWorldAabbFromRoot(pos, rotationYDeg, local, scale);
      const wallSnap = snapWallDepthToInteriorFace(snappedAabb, surface, bounds);
      if (Math.abs(wallSnap.x) >= 1e-6 || Math.abs(wallSnap.y) >= 1e-6 || Math.abs(wallSnap.z) >= 1e-6) {
        pos = { x: pos.x + wallSnap.x, y: pos.y + wallSnap.y, z: pos.z + wallSnap.z };
        continue;
      }
    }

    break;
  }

  return roundVec3(pos);
}

export function rootPositionFromWallHit(hit: Vec3, rotationYDeg: number, local: ObjectLocalExtents): Vec3 {
  const localCenterX = (local.minX + local.maxX) * 0.5;
  const localCenterY = (local.minY + local.maxY) * 0.5;
  const localCenterZ = (local.minZ + local.maxZ) * 0.5;
  const rotY = degToRad(rotationYDeg);
  const cos = Math.cos(rotY);
  const sin = Math.sin(rotY);
  return {
    x: hit.x - (localCenterX * cos + localCenterZ * sin),
    y: hit.y - localCenterY,
    z: hit.z - (-localCenterX * sin + localCenterZ * cos),
  };
}

export function wallCenterHitPoint(wallId: RoomWallId, context: RoomContext): Vec3 {
  const { bounds, floorY, ceilingY } = context;
  const midX = (bounds.minX + bounds.maxX) * 0.5;
  const midY = (floorY + ceilingY) * 0.5;
  const midZ = (bounds.minZ + bounds.maxZ) * 0.5;
  switch (wallId) {
    case "back":
      return { x: midX, y: midY, z: bounds.minZ + ROOM_PLACEMENT_WALL_INSET };
    case "front":
      return { x: midX, y: midY, z: bounds.maxZ - ROOM_PLACEMENT_WALL_INSET };
    case "left":
      return { x: bounds.minX + ROOM_PLACEMENT_WALL_INSET, y: midY, z: midZ };
    case "right":
      return { x: bounds.maxX - ROOM_PLACEMENT_WALL_INSET, y: midY, z: midZ };
  }
}

export interface PlacementPose {
  surface: RoomWallId | "floor";
  position: Vec3;
  rotationY: number;
}

export function buildWallPlacement(
  wallId: RoomWallId,
  context: RoomContext,
  local: ObjectLocalExtents,
  frontFace: RoomObjectFrontFace,
  scale = 1
): PlacementPose {
  const hit = wallCenterHitPoint(wallId, context);
  const rotationY = wallYawForObjectFrontFace(wallId, frontFace);
  const position = clampRootInsideInterior(
    rootPositionFromWallHit(hit, rotationY, local),
    rotationY,
    local,
    context,
    wallId,
    scale
  );
  return { surface: wallId, position, rotationY };
}

export function buildFloorPlacement(
  context: RoomContext,
  local: ObjectLocalExtents,
  scale = 1,
  point?: { x: number; z: number }
): PlacementPose {
  const x = point?.x ?? (context.bounds.minX + context.bounds.maxX) * 0.5;
  const z = point?.z ?? (context.bounds.minZ + context.bounds.maxZ) * 0.5;
  const position = clampRootInsideInterior(
    { x, y: context.floorY - local.minY * scale, z },
    0,
    local,
    context,
    "floor",
    scale
  );
  return { surface: "floor", position, rotationY: 0 };
}

export function wallAttachmentGap(wallId: RoomWallId, aabb: WorldAabb, bounds: RoomPlacementBounds): number {
  switch (wallId) {
    case "back":
      return Math.abs(aabb.minZ - (bounds.minZ + ROOM_PLACEMENT_WALL_INSET));
    case "front":
      return Math.abs(aabb.maxZ - (bounds.maxZ - ROOM_PLACEMENT_WALL_INSET));
    case "left":
      return Math.abs(aabb.minX - (bounds.minX + ROOM_PLACEMENT_WALL_INSET));
    case "right":
      return Math.abs(aabb.maxX - (bounds.maxX - ROOM_PLACEMENT_WALL_INSET));
  }
}

export function wallPenetration(wallId: RoomWallId, aabb: WorldAabb, bounds: RoomPlacementBounds): number {
  switch (wallId) {
    case "back":
      return Math.max(0, bounds.minZ + ROOM_PLACEMENT_WALL_INSET - aabb.minZ);
    case "front":
      return Math.max(0, aabb.maxZ - (bounds.maxZ - ROOM_PLACEMENT_WALL_INSET));
    case "left":
      return Math.max(0, bounds.minX + ROOM_PLACEMENT_WALL_INSET - aabb.minX);
    case "right":
      return Math.max(0, aabb.maxX - (bounds.maxX - ROOM_PLACEMENT_WALL_INSET));
  }
}

export interface SnapCheck {
  pass: boolean;
  gapM: number;
  penetrationM: number;
}

const GAP_PASS_M = 0.02;
const PENETRATION_PASS_M = 0.005;

export function checkWallSnap(
  wallId: RoomWallId,
  position: Vec3,
  rotationY: number,
  local: ObjectLocalExtents,
  context: RoomContext,
  scale = 1
): SnapCheck {
  const aabb = computeWorldAabbFromRoot(position, rotationY, local, scale);
  const gapM = wallAttachmentGap(wallId, aabb, context.bounds);
  const penetrationM = wallPenetration(wallId, aabb, context.bounds);
  const insideVertically = aabb.minY >= context.floorY - 0.01 && aabb.maxY <= context.ceilingY + 0.01;
  return {
    pass: gapM <= GAP_PASS_M && penetrationM <= PENETRATION_PASS_M && insideVertically,
    gapM,
    penetrationM,
  };
}

export function checkFloorSnap(
  position: Vec3,
  rotationY: number,
  local: ObjectLocalExtents,
  context: RoomContext,
  scale = 1
): SnapCheck {
  const aabb = computeWorldAabbFromRoot(position, rotationY, local, scale);
  const gapM = Math.abs(aabb.minY - context.floorY);
  const penetrationM = Math.max(0, context.floorY - aabb.minY);
  return {
    pass: gapM <= 0.01 && penetrationM <= PENETRATION_PASS_M,
    gapM,
    penetrationM,
  };
}

export function extentsFromSamples(samples: { x: number; y: number; z: number }[]): ObjectLocalExtents | null {
  if (samples.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const sample of samples) {
    minX = Math.min(minX, sample.x);
    minY = Math.min(minY, sample.y);
    minZ = Math.min(minZ, sample.z);
    maxX = Math.max(maxX, sample.x);
    maxY = Math.max(maxY, sample.y);
    maxZ = Math.max(maxZ, sample.z);
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

export function sizeOfExtents(local: ObjectLocalExtents): { width: number; height: number; depth: number } {
  return {
    width: local.maxX - local.minX,
    height: local.maxY - local.minY,
    depth: local.maxZ - local.minZ,
  };
}

/** Translation that puts the tight vertex box bottom-center on the root origin. Does not rotate. */
export function alignmentOffset(local: ObjectLocalExtents): Vec3 {
  return {
    x: -((local.minX + local.maxX) * 0.5),
    y: -local.minY,
    z: -((local.minZ + local.maxZ) * 0.5),
  };
}

export function translateExtents(local: ObjectLocalExtents, offset: Vec3): ObjectLocalExtents {
  return {
    minX: local.minX + offset.x,
    maxX: local.maxX + offset.x,
    minY: local.minY + offset.y,
    maxY: local.maxY + offset.y,
    minZ: local.minZ + offset.z,
    maxZ: local.maxZ + offset.z,
  };
}
