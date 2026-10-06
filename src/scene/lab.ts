import {
  ArcRotateCamera,
  Color3,
  Color4,
  DynamicTexture,
  Engine,
  GizmoManager,
  HemisphericLight,
  Matrix,
  MeshBuilder,
  PointerEventTypes,
  Quaternion,
  Scene,
  SceneLoader,
  StandardMaterial,
  TransformNode,
  Vector3,
  VertexBuffer,
  type AbstractMesh,
  type Observer,
} from "@babylonjs/core";
import { GridMaterial } from "@babylonjs/materials";
import { GLTF2Export } from "@babylonjs/serializers";
import "@babylonjs/loaders/glTF";
import JSZip from "jszip";
import { scoreFrontFaceSamples, type FrontFaceSample } from "../logic/detectFrontFace";
import {
  DEFAULT_ROOM_OBJECT_FRONT_FACE,
  type RoomObjectFrontFace,
  type RoomWallId,
} from "../logic/frontFace";
import { buildObjectMetadata } from "../logic/metadata";
import {
  TEST_ROOM,
  TEST_ROOM_INTERIOR,
  alignmentOffset,
  buildFloorPlacement,
  buildWallPlacement,
  checkFloorSnap,
  checkWallSnap,
  extentsFromSamples,
  sizeOfExtents,
  translateExtents,
  type ObjectLocalExtents,
  type Vec3,
} from "../logic/placementMath";

const MAX_VERTS_PER_MESH = 420;
const SMALL_MESH_VERTS = 280;
const HELPER = "__helper";

export type GizmoMode = "camera" | "move" | "rotate" | "scale";
export type SnapId = RoomWallId | "floor";
export type TestState = "untested" | "pass" | "fail";

export interface LabSnapshot {
  status: "empty" | "loading" | "ready" | "error";
  error: string | null;
  progress: number;
  fileName: string | null;
  fileSize: number | null;
  vertices: number;
  frontFace: RoomObjectFrontFace;
  frontFaceSource: "auto" | "manual";
  confidence: number;
  needsConfirm: boolean;
  scores: Record<RoomObjectFrontFace, number>;
  dimensionsM: { width: number; height: number; depth: number };
  dimensionsMm: { width: number; height: number; depth: number };
  boundsMin: Vec3;
  boundsMax: Vec3;
  center: Vec3;
  origin: Vec3;
  translation: Vec3;
  activeSnap: SnapId | null;
  tested: Record<SnapId, TestState>;
  gizmo: GizmoMode;
  scale: number;
  validating: boolean;
  validated: boolean;
  wallSnapPass: boolean;
  floorSnapPass: boolean;
}

const EMPTY_SCORES: Record<RoomObjectFrontFace, number> = {
  "+z": 0,
  "-z": 0,
  "+x": 0,
  "-x": 0,
};

function emptyTested(): Record<SnapId, TestState> {
  return { front: "untested", back: "untested", left: "untested", right: "untested", floor: "untested" };
}

export function emptySnapshot(): LabSnapshot {
  return {
    status: "empty",
    error: null,
    progress: 0,
    fileName: null,
    fileSize: null,
    vertices: 0,
    frontFace: DEFAULT_ROOM_OBJECT_FRONT_FACE,
    frontFaceSource: "auto",
    confidence: 0,
    needsConfirm: false,
    scores: { ...EMPTY_SCORES },
    dimensionsM: { width: 0, height: 0, depth: 0 },
    dimensionsMm: { width: 0, height: 0, depth: 0 },
    boundsMin: { x: 0, y: 0, z: 0 },
    boundsMax: { x: 0, y: 0, z: 0 },
    center: { x: 0, y: 0, z: 0 },
    origin: { x: 0, y: 0, z: 0 },
    translation: { x: 0, y: 0, z: 0 },
    activeSnap: null,
    tested: emptyTested(),
    gizmo: "camera",
    scale: 1,
    validating: false,
    validated: false,
    wallSnapPass: false,
    floorSnapPass: false,
  };
}

function isVisualMesh(mesh: AbstractMesh): boolean {
  return (
    !mesh.isDisposed() &&
    mesh.getTotalVertices() > 0 &&
    !mesh.name.endsWith("__pick") &&
    !mesh.name.includes(HELPER)
  );
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export class ObjectLab {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly camera: ArcRotateCamera;
  private readonly gizmos: GizmoManager;
  private readonly objectRoot: TransformNode;
  private content: TransformNode | null = null;
  private readonly frontRoot: TransformNode;
  private readonly localAxes: TransformNode;
  private readonly arrow: AbstractMesh;
  private readonly label: AbstractMesh;
  private file: File | null = null;
  private extents: ObjectLocalExtents | null = null;
  private translation: Vec3 = { x: 0, y: 0, z: 0 };
  private snapshot: LabSnapshot = emptySnapshot();
  private disposed = false;
  private beforeRender: Observer<Scene> | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly onChange: (snapshot: LabSnapshot) => void
  ) {
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.07, 0.08, 0.09, 1);

    this.camera = new ArcRotateCamera("cam", -Math.PI / 2, 1.05, 8.5, new Vector3(0, 0.9, 0), this.scene);
    this.camera.attachControl(canvas, true);
    this.camera.wheelPrecision = 40;
    this.camera.lowerRadiusLimit = 1.2;
    this.camera.upperRadiusLimit = 18;
    this.camera.minZ = 0.05;
    this.camera.panningSensibility = 80;

    const hemi = new HemisphericLight("hemi", new Vector3(0.2, 1, 0.3), this.scene);
    hemi.intensity = 0.95;
    hemi.groundColor = new Color3(0.25, 0.24, 0.22);

    this.buildRoom();
    this.buildWorldAxes();

    this.objectRoot = new TransformNode("object-root", this.scene);
    this.localAxes = this.buildLocalAxes();
    this.frontRoot = new TransformNode(`front${HELPER}`, this.scene);
    this.frontRoot.parent = this.objectRoot;
    const built = this.buildFrontIndicator();
    this.arrow = built.arrow;
    this.label = built.label;
    this.frontRoot.setEnabled(false);

    this.gizmos = new GizmoManager(this.scene);
    this.gizmos.usePointerToAttachGizmos = false;
    this.gizmos.clearGizmoOnEmptyPointerEvent = false;
    this.setGizmo("camera");

    this.scene.onPointerObservable.add((info) => {
      if (info.type !== PointerEventTypes.POINTERUP) return;
      if (!this.extents) return;
      const uniform = Math.max(this.objectRoot.scaling.x, this.objectRoot.scaling.y, this.objectRoot.scaling.z, 0.01);
      this.objectRoot.scaling.set(uniform, uniform, uniform);
      if (Math.abs(uniform - this.snapshot.scale) > 1e-4) {
        this.snapshot = { ...this.snapshot, scale: uniform, validated: false };
        this.emit();
      }
    });

    this.beforeRender = this.scene.onBeforeRenderObservable.add(() => {
      const scale = Math.max(Math.abs(this.objectRoot.scaling.x), 1e-4);
      const inv = 1 / scale;
      this.frontRoot.scaling.set(inv, inv, inv);
      this.localAxes.scaling.set(inv, inv, inv);
    });

    this.engine.runRenderLoop(() => {
      if (!this.disposed) this.scene.render();
    });
    window.addEventListener("resize", this.onResize);
    this.emit();
  }

  private onResize = (): void => {
    this.engine.resize();
  };

  private emit(): void {
    this.onChange(this.snapshot);
  }

  private patch(partial: Partial<LabSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    this.emit();
  }

  getSnapshot(): LabSnapshot {
    return this.snapshot;
  }

  private buildRoom(): void {
    const { minX, maxX, minZ, maxZ, floorY, ceilingY } = TEST_ROOM_INTERIOR;
    const thickness = 0.08;
    const height = ceilingY - floorY;
    const midY = floorY + height * 0.5;
    const width = maxX - minX;
    const depth = maxZ - minZ;

    const floor = MeshBuilder.CreateGround("floor", { width: width + 0.4, height: depth + 0.4 }, this.scene);
    floor.position.y = floorY;
    const grid = new GridMaterial("grid", this.scene);
    grid.majorUnitFrequency = 5;
    grid.minorUnitVisibility = 0.35;
    grid.gridRatio = 0.5;
    grid.mainColor = new Color3(0.16, 0.17, 0.18);
    grid.lineColor = new Color3(0.45, 0.5, 0.52);
    grid.opacity = 0.95;
    floor.material = grid;

    const wallMat = (name: string, color: Color3) => {
      const mat = new StandardMaterial(name, this.scene);
      mat.diffuseColor = color;
      mat.specularColor = Color3.Black();
      mat.backFaceCulling = false;
      return mat;
    };

    const back = MeshBuilder.CreateBox("wall-back", { width, height, depth: thickness }, this.scene);
    back.position.set(0, midY, minZ - thickness * 0.5);
    back.material = wallMat("mat-back", new Color3(0.33, 0.36, 0.4));

    const front = MeshBuilder.CreateBox("wall-front", { width, height, depth: thickness }, this.scene);
    front.position.set(0, midY, maxZ + thickness * 0.5);
    front.material = wallMat("mat-front", new Color3(0.4, 0.36, 0.32));

    const left = MeshBuilder.CreateBox("wall-left", { width: thickness, height, depth }, this.scene);
    left.position.set(minX - thickness * 0.5, midY, 0);
    left.material = wallMat("mat-left", new Color3(0.34, 0.35, 0.33));

    const right = MeshBuilder.CreateBox("wall-right", { width: thickness, height, depth }, this.scene);
    right.position.set(maxX + thickness * 0.5, midY, 0);
    right.material = wallMat("mat-right", new Color3(0.34, 0.35, 0.33));

    this.wallLabel("BACK WALL", new Vector3(0, 1.5, minZ + 0.02), Math.PI);
    this.wallLabel("FRONT WALL", new Vector3(0, 1.5, maxZ - 0.02), 0);
    this.wallLabel("LEFT WALL", new Vector3(minX + 0.02, 1.5, 0), Math.PI / 2);
    this.wallLabel("RIGHT WALL", new Vector3(maxX - 0.02, 1.5, 0), -Math.PI / 2);
  }

  private buildWorldAxes(): void {
    const origin = new Vector3(TEST_ROOM_INTERIOR.minX + 0.45, 0.02, TEST_ROOM_INTERIOR.minZ + 0.45);
    const length = 0.85;
    const axes: [string, Vector3, Color3][] = [
      ["world-x", new Vector3(length, 0, 0), new Color3(0.9, 0.28, 0.22)],
      ["world-y", new Vector3(0, length, 0), new Color3(0.28, 0.78, 0.38)],
      ["world-z", new Vector3(0, 0, length), new Color3(0.28, 0.48, 0.95)],
    ];
    for (const [name, dir, color] of axes) {
      const line = MeshBuilder.CreateLines(`${name}${HELPER}`, { points: [origin, origin.add(dir)] }, this.scene);
      line.color = color;
      line.isPickable = false;
    }
  }

  private buildLocalAxes(): TransformNode {
    const root = new TransformNode(`local-axes${HELPER}`, this.scene);
    root.parent = this.objectRoot;
    root.setEnabled(false);
    const length = 0.55;
    const specs: ["x" | "y" | "z", Color3][] = [
      ["x", new Color3(0.95, 0.25, 0.2)],
      ["y", new Color3(0.25, 0.85, 0.35)],
      ["z", new Color3(0.25, 0.45, 0.95)],
    ];
    for (const [axis, color] of specs) {
      const mesh = MeshBuilder.CreateCylinder(
        `local-${axis}${HELPER}`,
        { height: length, diameter: 0.025, tessellation: 8 },
        this.scene
      );
      mesh.parent = root;
      mesh.isPickable = false;
      const mat = new StandardMaterial(`local-${axis}-mat`, this.scene);
      mat.diffuseColor = color;
      mat.emissiveColor = color;
      mat.specularColor = Color3.Black();
      mesh.material = mat;
      if (axis === "x") mesh.rotation.z = -Math.PI / 2;
      if (axis === "z") mesh.rotation.x = Math.PI / 2;
      mesh.position[axis] = length * 0.5;
    }
    return root;
  }

  private wallLabel(text: string, position: Vector3, rotationY: number): void {
    const plane = MeshBuilder.CreatePlane(`label${HELPER}-${text}`, { width: 1.4, height: 0.28 }, this.scene);
    plane.position.copyFrom(position);
    plane.rotation.y = rotationY;
    plane.isPickable = false;
    const tex = new DynamicTexture(`tex-${text}`, { width: 512, height: 128 }, this.scene, false);
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, 512, 128);
    ctx.fillStyle = "rgba(12,14,16,0.55)";
    ctx.fillRect(0, 0, 512, 128);
    const paint = ctx as CanvasRenderingContext2D;
    paint.fillStyle = "#d7dde2";
    paint.font = "bold 64px sans-serif";
    paint.textAlign = "center";
    paint.textBaseline = "middle";
    paint.fillText(text, 256, 64);
    tex.update();
    const mat = new StandardMaterial(`mat-${text}`, this.scene);
    mat.diffuseTexture = tex;
    mat.emissiveColor = new Color3(0.7, 0.75, 0.78);
    mat.backFaceCulling = false;
    mat.disableLighting = true;
    plane.material = mat;
  }

  private buildFrontIndicator(): { arrow: AbstractMesh; label: AbstractMesh } {
    const shaft = MeshBuilder.CreateCylinder(
      `front-shaft${HELPER}`,
      { height: 0.72, diameter: 0.045, tessellation: 12 },
      this.scene
    );
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = 0.36;
    shaft.parent = this.frontRoot;
    const head = MeshBuilder.CreateCylinder(
      `front-head${HELPER}`,
      { height: 0.22, diameterTop: 0, diameterBottom: 0.16, tessellation: 12 },
      this.scene
    );
    head.rotation.x = Math.PI / 2;
    head.position.z = 0.83;
    head.parent = this.frontRoot;
    const mat = new StandardMaterial("front-arrow-mat", this.scene);
    mat.diffuseColor = new Color3(0.95, 0.62, 0.1);
    mat.emissiveColor = new Color3(0.85, 0.45, 0.05);
    mat.specularColor = Color3.Black();
    shaft.material = mat;
    head.material = mat;
    shaft.isPickable = false;
    head.isPickable = false;

    const plane = MeshBuilder.CreatePlane(`front-label${HELPER}`, { width: 0.7, height: 0.28 }, this.scene);
    plane.parent = this.frontRoot;
    plane.position.set(0, 0.28, 0.45);
    plane.billboardMode = 7;
    plane.isPickable = false;
    const tex = new DynamicTexture("front-label-tex", { width: 512, height: 200 }, this.scene, false);
    const ctx = tex.getContext();
    ctx.fillStyle = "#f0a202";
    ctx.fillRect(0, 0, 512, 200);
    const paint = ctx as CanvasRenderingContext2D;
    paint.fillStyle = "#1c1404";
    paint.font = "bold 120px sans-serif";
    paint.textAlign = "center";
    paint.textBaseline = "middle";
    paint.fillText("FRONT", 256, 108);
    tex.update();
    const labelMat = new StandardMaterial("front-label-mat", this.scene);
    labelMat.diffuseTexture = tex;
    labelMat.emissiveColor = new Color3(0.9, 0.55, 0.05);
    labelMat.backFaceCulling = false;
    labelMat.disableLighting = true;
    plane.material = labelMat;
    return { arrow: shaft, label: plane };
  }

  setGizmo(mode: GizmoMode): void {
    this.gizmos.positionGizmoEnabled = mode === "move";
    this.gizmos.rotationGizmoEnabled = mode === "rotate";
    this.gizmos.scaleGizmoEnabled = mode === "scale";
    if (mode === "camera") this.gizmos.attachToNode(null);
    else this.gizmos.attachToNode(this.objectRoot);
    this.patch({ gizmo: mode });
  }

  private clearObject(): void {
    this.gizmos.attachToNode(null);
    this.content?.dispose(false, true);
    this.content = null;
    this.extents = null;
    this.frontRoot.setEnabled(false);
    this.localAxes.setEnabled(false);
    this.objectRoot.position.set(0, 0, 0);
    this.objectRoot.rotation.set(0, 0, 0);
    this.objectRoot.rotationQuaternion = null;
    this.objectRoot.scaling.set(1, 1, 1);
  }

  async loadFile(file: File): Promise<void> {
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".glb")) {
      this.patch({ status: "error", error: "Only .glb files can be loaded.", progress: 0 });
      return;
    }
    this.file = file;
    this.clearObject();
    this.snapshot = {
      ...emptySnapshot(),
      status: "loading",
      progress: 0.02,
      fileName: file.name,
      fileSize: file.size,
      gizmo: this.snapshot.gizmo,
    };
    this.emit();

    const url = URL.createObjectURL(file);
    try {
      const container = await SceneLoader.LoadAssetContainerAsync("", url, this.scene, (event) => {
        if (event.lengthComputable && event.total > 0) {
          this.patch({ progress: Math.max(0.05, Math.min(0.92, event.loaded / event.total)) });
        } else {
          this.patch({ progress: Math.min(0.9, this.snapshot.progress + 0.08) });
        }
      }, ".glb");
      container.addAllToScene();
      const content = new TransformNode("object-content", this.scene);
      content.parent = this.objectRoot;
      for (const node of container.rootNodes) {
        node.parent = content;
      }
      this.content = content;

      const meshes = content.getChildMeshes(false);
      const vertices = meshes.reduce((sum, mesh) => sum + (isVisualMesh(mesh) ? mesh.getTotalVertices() : 0), 0);
      if (vertices < 3) {
        this.clearObject();
        this.patch({ status: "error", error: "GLB has no visible geometry.", fileName: file.name, fileSize: file.size });
        return;
      }

      const samples = this.collectSamples(content, meshes);
      const raw = extentsFromSamples(samples);
      if (!raw) {
        this.clearObject();
        this.patch({ status: "error", error: "Could not measure the visible bounding box.", fileName: file.name });
        return;
      }
      const offset = alignmentOffset(raw);
      this.translation = offset;
      this.applyRootLocalOffset(content, meshes, new Vector3(offset.x, offset.y, offset.z));
      const aligned = translateExtents(raw, offset);
      this.extents = aligned;

      const detection = scoreFrontFaceSamples(samples);
      const size = sizeOfExtents(aligned);
      this.objectRoot.rotationQuaternion = null;
      this.objectRoot.rotation.set(0, 0, 0);
      this.objectRoot.scaling.set(1, 1, 1);
      const floor = buildFloorPlacement(TEST_ROOM, aligned, 1);
      this.applyPose(floor.position, floor.rotationY);

      this.snapshot = {
        ...emptySnapshot(),
        status: "ready",
        progress: 1,
        fileName: file.name,
        fileSize: file.size,
        vertices,
        frontFace: detection.frontFace,
        frontFaceSource: "auto",
        confidence: detection.confidence,
        needsConfirm: detection.needsConfirm,
        scores: detection.scores,
        dimensionsM: size,
        dimensionsMm: {
          width: Math.round(size.width * 1000),
          height: Math.round(size.height * 1000),
          depth: Math.round(size.depth * 1000),
        },
        boundsMin: { x: aligned.minX, y: aligned.minY, z: aligned.minZ },
        boundsMax: { x: aligned.maxX, y: aligned.maxY, z: aligned.maxZ },
        center: {
          x: (aligned.minX + aligned.maxX) * 0.5,
          y: (aligned.minY + aligned.maxY) * 0.5,
          z: (aligned.minZ + aligned.maxZ) * 0.5,
        },
        origin: { x: 0, y: 0, z: 0 },
        translation: offset,
        gizmo: this.snapshot.gizmo,
        scale: 1,
      };
      this.localAxes.setEnabled(true);
      this.updateFrontIndicator();
      this.frameCamera();
      if (this.snapshot.gizmo !== "camera") this.gizmos.attachToNode(this.objectRoot);
      this.emit();
    } catch (error) {
      this.clearObject();
      const detail = error instanceof Error ? error.message : "";
      this.patch({
        status: "error",
        error: detail
          ? `Could not load this GLB. ${detail}`
          : "Could not load this GLB.",
        fileName: file.name,
        fileSize: file.size,
        progress: 0,
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  private collectSamples(root: TransformNode, meshes: AbstractMesh[]): FrontFaceSample[] {
    root.computeWorldMatrix(true);
    const inverseRoot = Matrix.Invert(root.getWorldMatrix());
    const samples: FrontFaceSample[] = [];
    for (const mesh of meshes) {
      if (!isVisualMesh(mesh)) continue;
      const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
      if (!positions || positions.length < 9) continue;
      mesh.computeWorldMatrix(true);
      const toLocal = mesh.getWorldMatrix().multiply(inverseRoot);
      const vertexCount = Math.floor(positions.length / 3);
      const step = vertexCount <= SMALL_MESH_VERTS ? 1 : Math.max(1, Math.ceil(vertexCount / MAX_VERTS_PER_MESH));
      const meshKey = String(mesh.uniqueId);
      for (let vertex = 0; vertex < vertexCount; vertex += step) {
        const offset = vertex * 3;
        const local = Vector3.TransformCoordinates(
          new Vector3(positions[offset] ?? 0, positions[offset + 1] ?? 0, positions[offset + 2] ?? 0),
          toLocal
        );
        samples.push({ x: local.x, y: local.y, z: local.z, meshKey });
      }
    }
    return samples;
  }

  private applyRootLocalOffset(root: TransformNode, meshes: AbstractMesh[], offset: Vector3): void {
    if (offset.lengthSquared() < 1e-12) return;
    for (const mesh of meshes) {
      if (!isVisualMesh(mesh)) continue;
      const parent = mesh.parent;
      if (!parent || parent === root) {
        mesh.position.addInPlace(offset);
      } else {
        root.computeWorldMatrix(true);
        parent.computeWorldMatrix(true);
        const worldDelta = Vector3.TransformNormal(offset, root.getWorldMatrix());
        const localDelta = Vector3.TransformNormal(worldDelta, Matrix.Invert(parent.getWorldMatrix()));
        mesh.position.addInPlace(localDelta);
      }
      mesh.refreshBoundingInfo({});
    }
    root.computeWorldMatrix(true);
  }

  private applyPose(position: Vec3, rotationY: number): void {
    this.objectRoot.rotationQuaternion = null;
    this.objectRoot.rotation.set(0, (rotationY * Math.PI) / 180, 0);
    this.objectRoot.position.set(position.x, position.y, position.z);
    this.objectRoot.computeWorldMatrix(true);
  }

  private currentScale(): number {
    return this.objectRoot.scaling.x || 1;
  }

  private updateFrontIndicator(): void {
    if (!this.extents) {
      this.frontRoot.setEnabled(false);
      return;
    }
    const face = this.snapshot.frontFace;
    const dir =
      face === "+x"
        ? new Vector3(1, 0, 0)
        : face === "-x"
          ? new Vector3(-1, 0, 0)
          : face === "+z"
            ? new Vector3(0, 0, 1)
            : new Vector3(0, 0, -1);
    const half =
      face === "+x" || face === "-x"
        ? (this.extents.maxX - this.extents.minX) * 0.5
        : (this.extents.maxZ - this.extents.minZ) * 0.5;
    const midY = (this.extents.minY + this.extents.maxY) * 0.5;
    this.frontRoot.position.set(dir.x * (half + 0.15), midY, dir.z * (half + 0.15));
    this.frontRoot.rotationQuaternion = Quaternion.FromLookDirectionLH(dir, Vector3.Up());
    this.frontRoot.setEnabled(true);
    this.arrow.isVisible = true;
    this.label.isVisible = true;
  }

  private frameCamera(): void {
    if (!this.extents) return;
    const size = Math.max(
      this.extents.maxX - this.extents.minX,
      this.extents.maxY - this.extents.minY,
      this.extents.maxZ - this.extents.minZ,
      0.4
    );
    this.camera.setTarget(new Vector3(0, Math.min(size * 0.5, 1.2), 0));
    this.camera.radius = Math.min(14, Math.max(3.2, size * 4.5));
    this.camera.alpha = -Math.PI / 2.4;
    this.camera.beta = 1.1;
  }

  setFrontFace(face: RoomObjectFrontFace): void {
    if (!this.extents || this.snapshot.status !== "ready") return;
    const was = this.snapshot.activeSnap;
    this.patch({
      frontFace: face,
      frontFaceSource: "manual",
      needsConfirm: false,
      validated: false,
      tested: emptyTested(),
      wallSnapPass: false,
      floorSnapPass: false,
    });
    this.updateFrontIndicator();
    if (was && was !== "floor") this.snapWall(was);
    else if (was === "floor") this.snapFloor();
  }

  snapWall(wallId: RoomWallId): void {
    if (!this.extents || this.snapshot.status !== "ready") return;
    const scale = this.currentScale();
    const pose = buildWallPlacement(wallId, TEST_ROOM, this.extents, this.snapshot.frontFace, scale);
    this.applyPose(pose.position, pose.rotationY);
    const check = checkWallSnap(wallId, pose.position, pose.rotationY, this.extents, TEST_ROOM, scale);
    this.patch({
      activeSnap: wallId,
      scale,
      tested: { ...this.snapshot.tested, [wallId]: check.pass ? "pass" : "fail" },
      validated: false,
    });
  }

  snapFloor(): void {
    if (!this.extents || this.snapshot.status !== "ready") return;
    const scale = this.currentScale();
    const pose = buildFloorPlacement(TEST_ROOM, this.extents, scale);
    this.applyPose(pose.position, pose.rotationY);
    const check = checkFloorSnap(pose.position, pose.rotationY, this.extents, TEST_ROOM, scale);
    this.patch({
      activeSnap: "floor",
      scale,
      tested: { ...this.snapshot.tested, floor: check.pass ? "pass" : "fail" },
      validated: false,
    });
  }

  async validate(): Promise<void> {
    if (!this.extents || this.snapshot.status !== "ready" || this.snapshot.validating) return;
    this.patch({ validating: true, validated: false });
    const scale = this.currentScale();
    const tested = emptyTested();
    let wallSnapPass = true;
    for (const wall of ["front", "back", "left", "right"] as const) {
      const pose = buildWallPlacement(wall, TEST_ROOM, this.extents, this.snapshot.frontFace, scale);
      this.applyPose(pose.position, pose.rotationY);
      const check = checkWallSnap(wall, pose.position, pose.rotationY, this.extents, TEST_ROOM, scale);
      tested[wall] = check.pass ? "pass" : "fail";
      if (!check.pass) wallSnapPass = false;
      this.patch({ activeSnap: wall, tested: { ...tested }, scale });
      await this.wait(380);
      if (this.disposed) return;
    }
    const floor = buildFloorPlacement(TEST_ROOM, this.extents, scale);
    this.applyPose(floor.position, floor.rotationY);
    const floorCheck = checkFloorSnap(floor.position, floor.rotationY, this.extents, TEST_ROOM, scale);
    tested.floor = floorCheck.pass ? "pass" : "fail";
    const frontReady = this.snapshot.frontFaceSource === "manual" || !this.snapshot.needsConfirm;
    const validated = wallSnapPass && floorCheck.pass && frontReady && this.snapshot.vertices > 0;
    this.patch({
      validating: false,
      activeSnap: "floor",
      tested,
      wallSnapPass,
      floorSnapPass: floorCheck.pass,
      validated,
      scale,
    });
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  private metadataName(): string {
    const raw = this.snapshot.fileName ?? "object";
    return raw.replace(/\.glb$/i, "");
  }

  private buildMetadata() {
    if (!this.extents) throw new Error("No model loaded.");
    return buildObjectMetadata({
      name: this.metadataName(),
      frontFace: this.snapshot.frontFace,
      frontFaceSource: this.snapshot.frontFaceSource,
      confidence: this.snapshot.confidence,
      wallSnap: this.snapshot.wallSnapPass,
      floorSnap: this.snapshot.floorSnapPass,
      localExtents: this.extents,
      translationMeters: this.translation,
    });
  }

  async saveConfiguration(): Promise<void> {
    if (!this.snapshot.validated) return;
    const json = JSON.stringify(this.buildMetadata(), null, 2);
    downloadBlob(new Blob([json], { type: "application/json" }), "object.json");
  }

  async exportPackage(): Promise<void> {
    if (!this.snapshot.validated || !this.file || !this.content) return;
    const savedPos = this.objectRoot.position.clone();
    const savedRot = this.objectRoot.rotation.clone();
    const savedScale = this.objectRoot.scaling.clone();
    this.objectRoot.rotationQuaternion = null;
    this.objectRoot.position.set(0, 0, 0);
    this.objectRoot.rotation.set(0, 0, 0);
    this.objectRoot.scaling.set(1, 1, 1);
    this.frontRoot.setEnabled(false);
    this.gizmos.attachToNode(null);
    this.objectRoot.computeWorldMatrix(true);

    try {
      const result = await GLTF2Export.GLBAsync(this.scene, "object", {
        shouldExportNode: (node) => {
          if (node.name.includes(HELPER)) return false;
          if (node === this.content) return true;
          let current: TransformNode | null = node.parent as TransformNode | null;
          while (current) {
            if (current === this.content) return true;
            current = current.parent as TransformNode | null;
          }
          return false;
        },
      });
      const exported = result.glTFFiles["object.glb"];
      const glbBlob =
        exported instanceof Blob
          ? exported
          : new Blob([exported], { type: "model/gltf-binary" });
      const zip = new JSZip();
      zip.file("object.glb", glbBlob);
      zip.file("object.json", JSON.stringify(this.buildMetadata(), null, 2));
      const packed = await zip.generateAsync({ type: "blob" });
      downloadBlob(packed, `${this.metadataName()}-validated.zip`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Export failed.";
      this.patch({ error: message });
    } finally {
      this.objectRoot.position.copyFrom(savedPos);
      this.objectRoot.rotation.copyFrom(savedRot);
      this.objectRoot.scaling.copyFrom(savedScale);
      this.frontRoot.setEnabled(true);
      if (this.snapshot.gizmo !== "camera") this.gizmos.attachToNode(this.objectRoot);
    }
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener("resize", this.onResize);
    if (this.beforeRender) this.scene.onBeforeRenderObservable.remove(this.beforeRender);
    this.gizmos.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }
}
