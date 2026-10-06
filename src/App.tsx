import { useEffect, useRef, useState } from "react";
import { ROOM_OBJECT_FRONT_FACES, type RoomObjectFrontFace, type RoomWallId } from "./logic/frontFace";
import { ObjectLab, emptySnapshot, type GizmoMode, type LabSnapshot, type SnapId } from "./scene/lab";

const WALLS: { id: RoomWallId; label: string }[] = [
  { id: "front", label: "Snap Front Wall" },
  { id: "back", label: "Snap Back Wall" },
  { id: "left", label: "Snap Left Wall" },
  { id: "right", label: "Snap Right Wall" },
];

const GIZMOS: { id: GizmoMode; label: string }[] = [
  { id: "camera", label: "Camera" },
  { id: "move", label: "Move" },
  { id: "rotate", label: "Rotate" },
  { id: "scale", label: "Scale" },
];

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function formatM(value: number): string {
  return `${value.toFixed(3)} m`;
}

function mark(state: LabSnapshot["tested"][SnapId]): string {
  if (state === "pass") return "✓";
  if (state === "fail") return "✗";
  return "·";
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labRef = useRef<ObjectLab | null>(null);
  const [snap, setSnap] = useState<LabSnapshot>(emptySnapshot);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const lab = new ObjectLab(canvas, setSnap);
    labRef.current = lab;
    return () => {
      lab.dispose();
      labRef.current = null;
    };
  }, []);

  const ready = snap.status === "ready";

  const onFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    void labRef.current?.loadFile(file);
  };

  return (
    <div
      className={`app${dragOver ? " drag" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        onFiles(event.dataTransfer.files);
      }}
    >
      <header className="top">
        <div>
          <div className="eyebrow">Room planner prep</div>
          <h1>Object Validation Tool</h1>
        </div>
        <div className="file-meta">
          {snap.fileName ? (
            <>
              <strong>{snap.fileName}</strong>
              <span>{snap.fileSize != null ? formatBytes(snap.fileSize) : ""}</span>
            </>
          ) : (
            <span>No model loaded</span>
          )}
        </div>
      </header>

      <aside className="panel left">
        <label className="drop">
          <input
            type="file"
            accept=".glb,model/gltf-binary"
            onChange={(event) => {
              onFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <strong>Upload GLB</strong>
          <span>Drop a .glb anywhere, or browse</span>
        </label>

        {snap.status === "loading" && (
          <div className="progress">
            <div style={{ width: `${Math.round(snap.progress * 100)}%` }} />
            <span>Loading {Math.round(snap.progress * 100)}%</span>
          </div>
        )}
        {snap.error && <p className="error">{snap.error}</p>}

        <section>
          <h2>Measured geometry</h2>
          <p className="hint">Tight vertex bounds. Empty pivot space is ignored. Origin sits at the bottom center.</p>
          <dl>
            <dt>Vertices</dt>
            <dd>{snap.vertices || "—"}</dd>
            <dt>Width (X)</dt>
            <dd>{ready ? `${snap.dimensionsMm.width} mm · ${formatM(snap.dimensionsM.width)}` : "—"}</dd>
            <dt>Height (Y)</dt>
            <dd>{ready ? `${snap.dimensionsMm.height} mm · ${formatM(snap.dimensionsM.height)}` : "—"}</dd>
            <dt>Depth (Z)</dt>
            <dd>{ready ? `${snap.dimensionsMm.depth} mm · ${formatM(snap.dimensionsM.depth)}` : "—"}</dd>
            <dt>Center</dt>
            <dd>
              {ready
                ? `${snap.center.x.toFixed(3)}, ${snap.center.y.toFixed(3)}, ${snap.center.z.toFixed(3)}`
                : "—"}
            </dd>
            <dt>Origin</dt>
            <dd>{ready ? "0, 0, 0" : "—"}</dd>
            <dt>Origin shift</dt>
            <dd>
              {ready
                ? `${snap.translation.x.toFixed(3)}, ${snap.translation.y.toFixed(3)}, ${snap.translation.z.toFixed(3)}`
                : "—"}
            </dd>
          </dl>
        </section>

        <section className="axes">
          <h2>Local axes</h2>
          <pre>{`        +Y
         ↑
         |
         +------→ +X
        /
      +Z`}</pre>
          <p className="hint">Red +X, green +Y, blue +Z. Same Babylon basis as the room planner.</p>
        </section>
      </aside>

      <main className="viewport">
        <canvas ref={canvasRef} />
        <div className="gizmo-bar">
          {GIZMOS.map((mode) => (
            <button
              key={mode.id}
              type="button"
              className={snap.gizmo === mode.id ? "on" : ""}
              onClick={() => labRef.current?.setGizmo(mode.id)}
            >
              {mode.label}
            </button>
          ))}
        </div>
        {dragOver && <div className="drop-mask">Drop GLB to load</div>}
      </main>

      <aside className="panel right">
        <section>
          <h2>Object front axis</h2>
          {ready && snap.needsConfirm && snap.frontFaceSource === "auto" && (
            <p className="confirm">Please confirm the object's front direction.</p>
          )}
          <div className="axis-row">
            {ROOM_OBJECT_FRONT_FACES.map((face) => (
              <button
                key={face}
                type="button"
                disabled={!ready}
                className={snap.frontFace === face ? "on" : ""}
                onClick={() => labRef.current?.setFrontFace(face as RoomObjectFrontFace)}
              >
                {face.toUpperCase()}
              </button>
            ))}
          </div>
          <p className="hint">
            {ready
              ? `Source ${snap.frontFaceSource} · confidence ${(snap.confidence * 100).toFixed(0)}%. The lit button is the side that gets turned onto +Z. +Z itself does not rotate.`
              : "Upload a model to detect a front axis."}
          </p>
        </section>

        <section>
          <h2>Wall snap</h2>
          <div className="stack">
            {WALLS.map((wall) => (
              <button key={wall.id} type="button" disabled={!ready || snap.validating} onClick={() => labRef.current?.snapWall(wall.id)}>
                {wall.label}
              </button>
            ))}
            <button type="button" disabled={!ready || snap.validating} onClick={() => labRef.current?.snapFloor()}>
              Snap To Floor
            </button>
          </div>
        </section>

        <section className="validation">
          <h2>Object validation</h2>
          <ul>
            <li className={snap.status === "ready" ? "pass" : ""}>{snap.status === "ready" ? "✓" : "·"} GLB loaded</li>
            <li className={snap.vertices > 0 ? "pass" : ""}>{snap.vertices > 0 ? "✓" : "·"} Geometry valid</li>
            <li className={ready ? "pass" : ""}>{ready ? "✓" : "·"} Bounding box calculated</li>
            <li className={snap.floorSnapPass ? "pass" : snap.tested.floor === "fail" ? "fail" : ""}>
              {snap.floorSnapPass ? "✓" : snap.tested.floor === "fail" ? "✗" : "·"} Floor placement valid
            </li>
            <li className={snap.wallSnapPass ? "pass" : ""}>
              {snap.wallSnapPass ? "✓" : "·"} Wall placement valid
            </li>
            <li className={ready && (snap.frontFaceSource === "manual" || !snap.needsConfirm) ? "pass" : ""}>
              {ready && (snap.frontFaceSource === "manual" || !snap.needsConfirm) ? "✓" : "·"} Front axis configured
            </li>
          </ul>
          <p>
            Front axis: <strong>{ready ? snap.frontFace.toUpperCase() : "—"}</strong>
          </p>
          <p>
            Wall snap: <strong>{snap.wallSnapPass ? "PASS" : "—"}</strong>
            {" · "}
            Floor snap: <strong>{snap.floorSnapPass ? "PASS" : "—"}</strong>
          </p>
          <ul className="snaps">
            {(["front", "back", "left", "right", "floor"] as const).map((id) => (
              <li key={id} className={snap.tested[id]}>
                {mark(snap.tested[id])} {id === "floor" ? "Floor" : `${id[0]!.toUpperCase()}${id.slice(1)} wall`}
              </li>
            ))}
          </ul>
          <button type="button" className="primary" disabled={!ready || snap.validating} onClick={() => void labRef.current?.validate()}>
            {snap.validating ? "Testing snaps…" : "Validate Object"}
          </button>
        </section>

        <section className="export">
          <button type="button" disabled={!ready} onClick={() => labRef.current?.saveAxis()}>
            Save
          </button>
          <button
            type="button"
            className="primary"
            disabled={!ready || !snap.axisSaved || snap.downloading}
            onClick={() => void labRef.current?.downloadGlb()}
          >
            {snap.downloading ? "Downloading…" : "Download"}
          </button>
          <p className="hint">
            {snap.axisSaved && snap.savedFrontFace
              ? snap.savedFrontFace === "+z"
                ? "Saved +Z. That side is already forward, so the GLB is not rotated. Pick +X to turn the current +X side onto +Z."
                : `Saved ${snap.savedFrontFace.toUpperCase()}. Download turns that side onto +Z.`
              : "Pick +X to turn the current +X side onto +Z, then Save and Download."}
          </p>
        </section>
      </aside>
    </div>
  );
}
