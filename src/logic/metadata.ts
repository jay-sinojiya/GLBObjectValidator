import type { RoomObjectFrontFace } from "./frontFace";
import type { ObjectLocalExtents, Vec3 } from "./placementMath";
import { roundVec3, sizeOfExtents } from "./placementMath";

export interface ValidatedObjectMetadata {
  version: 1;
  name: string;
  model: { file: "object.glb" };
  frontFace: RoomObjectFrontFace;
  frontFaceSource: "auto" | "manual";
  frontFaceConfidence: number;
  placement: {
    wallSnap: boolean;
    floorSnap: boolean;
  };
  dimensions: {
    unit: "mm";
    width: number;
    height: number;
    depth: number;
  };
  dimensionsMeters: {
    width: number;
    height: number;
    depth: number;
  };
  /** Tight visible-geometry box in root-local meters after origin normalization. */
  localExtents: ObjectLocalExtents;
  bounds: {
    min: Vec3;
    max: Vec3;
    center: Vec3;
  };
  /** Root origin after normalization: bottom-center of the visible mesh. */
  origin: Vec3;
  /** Translation applied in the tool so empty pivot space is ignored. Not a yaw bake. */
  normalization: {
    translationMeters: Vec3;
    rotationBaked: false;
    basis: "tight-vertex-aabb";
  };
  yawConvention: {
    note: "Matches room planner roomObjectPlacement.ts. Wall yaw = WALL_ROTATION_Y[wall] + FRONT_FACE_WALL_YAW[frontFace].";
    wallRotationY: { back: 0; front: 180; left: 90; right: -90 };
    frontFaceWallYaw: { "+z": 0; "-z": 180; "+x": -90; "-x": 90 };
  };
}

function roundM(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function mm(meters: number): number {
  return Math.round(meters * 1000);
}

export function buildObjectMetadata(input: {
  name: string;
  frontFace: RoomObjectFrontFace;
  frontFaceSource: "auto" | "manual";
  confidence: number;
  wallSnap: boolean;
  floorSnap: boolean;
  localExtents: ObjectLocalExtents;
  translationMeters: Vec3;
}): ValidatedObjectMetadata {
  const size = sizeOfExtents(input.localExtents);
  const min = {
    x: roundM(input.localExtents.minX),
    y: roundM(input.localExtents.minY),
    z: roundM(input.localExtents.minZ),
  };
  const max = {
    x: roundM(input.localExtents.maxX),
    y: roundM(input.localExtents.maxY),
    z: roundM(input.localExtents.maxZ),
  };
  return {
    version: 1,
    name: input.name,
    model: { file: "object.glb" },
    frontFace: input.frontFace,
    frontFaceSource: input.frontFaceSource,
    frontFaceConfidence: Math.round(input.confidence * 1000) / 1000,
    placement: {
      wallSnap: input.wallSnap,
      floorSnap: input.floorSnap,
    },
    dimensions: {
      unit: "mm",
      width: mm(size.width),
      height: mm(size.height),
      depth: mm(size.depth),
    },
    dimensionsMeters: {
      width: roundM(size.width),
      height: roundM(size.height),
      depth: roundM(size.depth),
    },
    localExtents: {
      minX: min.x,
      minY: min.y,
      minZ: min.z,
      maxX: max.x,
      maxY: max.y,
      maxZ: max.z,
    },
    bounds: {
      min,
      max,
      center: {
        x: roundM((min.x + max.x) * 0.5),
        y: roundM((min.y + max.y) * 0.5),
        z: roundM((min.z + max.z) * 0.5),
      },
    },
    origin: { x: 0, y: 0, z: 0 },
    normalization: {
      translationMeters: roundVec3(input.translationMeters),
      rotationBaked: false,
      basis: "tight-vertex-aabb",
    },
    yawConvention: {
      note: "Matches room planner roomObjectPlacement.ts. Wall yaw = WALL_ROTATION_Y[wall] + FRONT_FACE_WALL_YAW[frontFace].",
      wallRotationY: { back: 0, front: 180, left: 90, right: -90 },
      frontFaceWallYaw: { "+z": 0, "-z": 180, "+x": -90, "-x": 90 },
    },
  };
}
