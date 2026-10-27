import { Quaternion, Vector3 } from "@babylonjs/core";
import { describe, expect, it } from "vitest";
import { TURN_FACES, yawPitchForFace, type TurnFace } from "./turn";

function dominant(v: Vector3): TurnFace {
  const ax = Math.abs(v.x);
  const ay = Math.abs(v.y);
  const az = Math.abs(v.z);
  if (ay >= ax && ay >= az) return v.y >= 0 ? "+y" : "-y";
  if (ax >= az) return v.x >= 0 ? "+x" : "-x";
  return v.z >= 0 ? "+z" : "-z";
}

function frontOf(q: Quaternion): TurnFace {
  return dominant(new Vector3(0, 0, 1).applyRotationQuaternion(q.conjugate()));
}

describe("yawPitchForFace", () => {
  it("points each of the 6 faces at +Z", () => {
    for (const face of TURN_FACES) {
      const { yaw, pitch } = yawPitchForFace(face);
      const q = Quaternion.RotationYawPitchRoll((yaw * Math.PI) / 180, (pitch * Math.PI) / 180, 0);
      expect(frontOf(q)).toBe(face);
    }
  });

  it("reaches all 24 axis-aligned orientations with 90° X/Y/Z turns", () => {
    const seen = new Set<string>();
    const queue = [Quaternion.Identity()];
    seen.add(`${frontOf(queue[0])}`);
    const key = (q: Quaternion) => {
      const inv = q.conjugate();
      return `${dominant(new Vector3(0, 0, 1).applyRotationQuaternion(inv))} ${dominant(new Vector3(0, 1, 0).applyRotationQuaternion(inv))}`;
    };
    seen.clear();
    seen.add(key(queue[0]!));
    while (queue.length) {
      const current = queue.shift();
      if (!current) break;
      for (const axis of [Vector3.Right(), Vector3.Up(), Vector3.Forward()]) {
        for (const sign of [1, -1]) {
          const next = Quaternion.RotationAxis(axis, (sign * Math.PI) / 2).multiply(current);
          const id = key(next);
          if (!seen.has(id)) {
            seen.add(id);
            queue.push(next);
          }
        }
      }
    }
    expect(seen.size).toBe(24);
  });
});
