/**
 * Wall-yaw convention copied from the room planner
 * (`tiles-catalogue-3d` `roomObjectPlacement.ts`).
 *
 * Canonical wall yaw already points local +Z into the room.
 * `FRONT_FACE_WALL_YAW` is added on top so the stored visual front faces
 * the room and the opposite side sits on the wall.
 *
 *   back wall + "+z" => yaw 0
 *   back wall + "-z" => yaw 180
 */
export const ROOM_OBJECT_FRONT_FACES = ["+z", "-z", "+x", "-x"] as const;
export type RoomObjectFrontFace = (typeof ROOM_OBJECT_FRONT_FACES)[number];
export const DEFAULT_ROOM_OBJECT_FRONT_FACE: RoomObjectFrontFace = "+z";

/** Below this, the tool asks the admin to confirm the visual front. */
export const ROOM_OBJECT_FRONT_FACE_CONFIRM_BELOW = 0.58;

export type RoomWallId = "front" | "back" | "left" | "right";

export const WALL_ROTATION_Y: Record<RoomWallId, number> = {
  back: 0,
  front: 180,
  left: 90,
  right: -90,
};

export const FRONT_FACE_WALL_YAW: Record<RoomObjectFrontFace, number> = {
  "+z": 0,
  "-z": 180,
  "+x": -90,
  "-x": 90,
};

export function isRoomObjectFrontFace(value: unknown): value is RoomObjectFrontFace {
  return value === "+z" || value === "-z" || value === "+x" || value === "-x";
}

export function normalizeYawDeg(deg: number): number {
  const wrapped = ((deg % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

/** Yaw that points `face` into the room on `wallId`. */
export function wallYawForObjectFrontFace(wallId: RoomWallId, face: RoomObjectFrontFace): number {
  return normalizeYawDeg(WALL_ROTATION_Y[wallId] + FRONT_FACE_WALL_YAW[face]);
}

export function frontAxisVector(face: RoomObjectFrontFace): { x: number; y: number; z: number } {
  switch (face) {
    case "+x":
      return { x: 1, y: 0, z: 0 };
    case "-x":
      return { x: -1, y: 0, z: 0 };
    case "+z":
      return { x: 0, y: 0, z: 1 };
    case "-z":
      return { x: 0, y: 0, z: -1 };
  }
}
