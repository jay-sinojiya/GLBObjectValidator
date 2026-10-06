import { describe, expect, it } from "vitest";
import { wallYawForObjectFrontFace } from "./frontFace";
import { scoreFrontFaceSamples, type FrontFaceSample } from "./detectFrontFace";
import {
  TEST_ROOM,
  buildFloorPlacement,
  buildWallPlacement,
  checkFloorSnap,
  checkWallSnap,
  computeWorldAabbFromRoot,
  rotateExtentsYaw,
} from "./placementMath";

function boxSamples(
  min: [number, number, number],
  max: [number, number, number],
  count: number,
  meshKey: string
): FrontFaceSample[] {
  const samples: FrontFaceSample[] = [];
  const steps = Math.ceil(Math.cbrt(count));
  for (let ix = 0; ix < steps; ix += 1) {
    for (let iy = 0; iy < steps; iy += 1) {
      for (let iz = 0; iz < steps; iz += 1) {
        if (samples.length >= count) return samples;
        const tx = steps === 1 ? 0.5 : ix / (steps - 1);
        const ty = steps === 1 ? 0.5 : iy / (steps - 1);
        const tz = steps === 1 ? 0.5 : iz / (steps - 1);
        samples.push({
          x: min[0] + (max[0] - min[0]) * tx,
          y: min[1] + (max[1] - min[1]) * ty,
          z: min[2] + (max[2] - min[2]) * tz,
          meshKey,
        });
      }
    }
  }
  return samples;
}

function cluster(
  center: [number, number, number],
  size: number,
  count: number,
  meshKey: string
): FrontFaceSample[] {
  const samples: FrontFaceSample[] = [];
  for (let i = 0; i < count; i += 1) {
    const a = (i * 17) % 10;
    const b = (i * 13) % 10;
    const c = (i * 7) % 10;
    samples.push({
      x: center[0] + (a / 9 - 0.5) * size,
      y: center[1] + (b / 9 - 0.5) * size,
      z: center[2] + (c / 9 - 0.5) * size,
      meshKey,
    });
  }
  return samples;
}

const CABINET = {
  minX: -0.6,
  maxX: 0.6,
  minY: 0,
  maxY: 0.9,
  minZ: -0.25,
  maxZ: 0.25,
};

describe("wallYawForObjectFrontFace", () => {
  it("matches the room planner yaw table", () => {
    expect(wallYawForObjectFrontFace("back", "+z")).toBe(0);
    expect(wallYawForObjectFrontFace("back", "-z")).toBe(180);
    expect(wallYawForObjectFrontFace("back", "+x")).toBe(-90);
    expect(wallYawForObjectFrontFace("back", "-x")).toBe(90);
    expect(wallYawForObjectFrontFace("front", "+z")).toBe(180);
    expect(wallYawForObjectFrontFace("left", "+x")).toBe(0);
    expect(wallYawForObjectFrontFace("right", "-x")).toBe(0);
  });
});

describe("placement", () => {
  it("sits the bottom on the floor without penetration", () => {
    const pose = buildFloorPlacement(TEST_ROOM, CABINET);
    const check = checkFloorSnap(pose.position, pose.rotationY, CABINET, TEST_ROOM);
    expect(check.pass).toBe(true);
    const aabb = computeWorldAabbFromRoot(pose.position, pose.rotationY, CABINET);
    expect(aabb.minY).toBeCloseTo(TEST_ROOM.floorY, 3);
  });

  it("places +Z front against the back wall, facing into the room", () => {
    const pose = buildWallPlacement("back", TEST_ROOM, CABINET, "+z");
    expect(pose.rotationY).toBe(0);
    const check = checkWallSnap("back", pose.position, pose.rotationY, CABINET, TEST_ROOM);
    expect(check.pass).toBe(true);
    const aabb = computeWorldAabbFromRoot(pose.position, pose.rotationY, CABINET);
    expect(aabb.minZ).toBeCloseTo(TEST_ROOM.bounds.minZ + 0.03, 3);
    expect(aabb.maxZ).toBeGreaterThan(aabb.minZ);
  });

  it("flips yaw when the visual front is -Z so the front still faces the room", () => {
    const pose = buildWallPlacement("back", TEST_ROOM, CABINET, "-z");
    expect(pose.rotationY).toBe(180);
    expect(checkWallSnap("back", pose.position, pose.rotationY, CABINET, TEST_ROOM).pass).toBe(true);
    const aabb = computeWorldAabbFromRoot(pose.position, pose.rotationY, CABINET);
    expect(aabb.minZ).toBeCloseTo(TEST_ROOM.bounds.minZ + 0.03, 3);
  });

  it("passes all four walls for +X front", () => {
    for (const wall of ["front", "back", "left", "right"] as const) {
      const pose = buildWallPlacement(wall, TEST_ROOM, CABINET, "+x");
      expect(checkWallSnap(wall, pose.position, pose.rotationY, CABINET, TEST_ROOM).pass).toBe(true);
    }
  });
});

describe("rotateExtentsYaw", () => {
  it("turns the +X extent onto +Z", () => {
    const turned = rotateExtentsYaw({ minX: -1.5, minY: 0, minZ: -0.3, maxX: 1.5, maxY: 1, maxZ: 0.3 }, -90);
    expect(turned.minX).toBeCloseTo(-0.3);
    expect(turned.maxX).toBeCloseTo(0.3);
    expect(turned.minZ).toBeCloseTo(-1.5);
    expect(turned.maxZ).toBeCloseTo(1.5);
  });
});

describe("scoreFrontFaceSamples", () => {
  it("picks +Z when details stick out on +Z", () => {
    const samples = [
      ...boxSamples([-1, 0, -0.4], [1, 1.2, 0.35], 180, "body"),
      ...cluster([0.2, 0.6, 0.55], 0.08, 24, "handle-a"),
      ...cluster([-0.3, 0.7, 0.58], 0.06, 18, "handle-b"),
    ];
    expect(scoreFrontFaceSamples(samples).frontFace).toBe("+z");
  });

  it("asks for confirmation when the mesh is symmetric", () => {
    const result = scoreFrontFaceSamples(boxSamples([-1, 0, -1], [1, 1, 1], 250, "cube"));
    expect(result.needsConfirm).toBe(true);
  });
});
