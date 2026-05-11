# SSPE — Semantic Spatial Programming Engine

> Code go in. World come out. You walk inside code.

Caveman make tool. Tool take Python. Tool turn Python into 3D cave.
Variables = stone boxes. Loops = spinning rings. Conditions = diamonds.
Functions = pillars. Recursion = ball inside ball.
You see code from outside like map. You zoom in, you see runtime fire.

---

## Big idea (in cave words)

You give code. Cave appear.

```
code  →  AST  →  semantic graph  →  3D world  →  you walk inside
```

- **You see shapes.** Each shape mean one thing in code. No memorise.
- **You see fire.** Run the program. Particles run along edges. Active nodes glow.
- **You see numbers.** Variable boxes show live value. Number change, box flash.
- **You move.** Drag with mouse. Zoom with wheel. Cave grow detail when close.
- **You poke.** Click stone box, info appear. Hover, plain-words explain.

Tool teach. Cave talk. Brain understand.

---

## What live in this repo

```
sspe/
├─ src/
│  ├─ parser/             # Pyodide worker — Python → AST → SemanticGraph
│  ├─ layout/             # 3D force-directed layout (Coulomb + Hooke)
│  ├─ execution/          # Walks the graph to build a step-by-step trace
│  ├─ store/              # Zustand store (graph, selection, playback, trace)
│  ├─ components/
│  │  ├─ scene/           # The 3D renderer (see "How cave run fast" below)
│  │  └─ ui/              # Code editor, control bar, legend, info panel, minimap
│  ├─ data/examples.ts    # Learning-path examples (Hello → Recursion)
│  └─ utils/editorBridge  # Two-way bridge between Monaco editor and the 3D world
└─ public/
```

---

## How cave run fast (the perf bones)

Caveman want big cave. Million nodes. Cave still smooth. So caveman build like this:

### 1. GPU instancing for nodes — `components/scene/InstancedNodes.tsx`

Old way: one React component + one mesh + one material per node. Million nodes = million draw calls. Browser cry.

New way: **one `InstancedMesh` per node shape**. Variable nodes share one mesh. Loops share one mesh. Functions share one mesh. Etc.
- Draw calls: `O(shapes)` instead of `O(nodes)`. Six-ish draw calls total.
- React components: **one** wrapper, not N.
- Per-instance colour/scale/rotation updated **inside `useFrame`** by mutating `instanceMatrix` / `instanceColor` buffers directly. **Zero React re-renders during animation.**
- Picking: `event.instanceId` from R3F → `nodeId` via a per-bucket lookup. Hover and click still work.

### 2. Batched edge rendering — `components/scene/EdgeBatch.tsx`

Old way: one `<Line>` (drei) per edge. Each one allocates samples, billboards, labels. 5k edges = pain.

New way:
- All edges of one type collapse into **one `LineSegments`** geometry. Six base draw calls (one per `EdgeType`), built once when graph changes.
- A second `LineSegments` overlay holds the brighter "active / hovered-adjacent / selected-adjacent / focused" subset. Rebuilt **only when that subset changes**, not every frame (signature diff guard).
- Edge labels (YES/NO, `calls`, `returns`, `uses x`) are part of `NodeOverlays`, only drawn around interesting nodes.

### 3. Particle pool — `components/scene/ParticlePool.tsx`

Old way: mount one React component per execution-flow particle, unmount when it lands. GC eat frame.

New way: **fixed pool of N (default 256) instances in a single `InstancedMesh`**. Spawn = grab next free slot. Animation = update matrix + color. Lifetime expires = mark slot free. **One allocation for the lifetime of the page.**

### 4. Semantic zoom (not just camera zoom) — `components/scene/SemanticZoomController.tsx` + `sceneRuntime.ts`

Camera distance to the graph centroid drives a discrete zoom level:

| Level | Distance      | What you see                                          |
|-------|---------------|--------------------------------------------------------|
| **0** OVERVIEW  | far  | only Functions + Recursion (the "modules")            |
| **1** FLOW      | mid  | + Loops, Conditions (control-flow skeleton)           |
| **2** DETAIL    | near | + Variables, Assignments, Expressions                 |
| **3** EXECUTION | close| everything, with labels + live trace + tooltips       |

A smooth `zoomLevelSmooth` is damped between levels, and `targetVisibilityForType` returns a per-type `0..1` fade. Instanced nodes multiply their scale and brightness by that fade. Big code looks like islands from far. Walk in, the islands open up.

### 5. Detail set + bounded React overlays — `components/scene/NodeOverlays.tsx`

Rich overlays (text labels, sparkles, point lights, hover tooltips, condition test text, iteration badges) only render for nodes in `sceneRuntime.detailNodeIds`:
- always-included: **selected ∪ hovered ∪ focused ∪ active**
- top-up from nearest-to-camera at zoom level ≥ 2
- capped at `MAX_DETAIL_NODES = 24`

So the React tree under the Canvas has **constant size, not O(nodes)**. The detail set is diffed inside `useFrame` and only triggers a React re-render when the membership actually changes.

### 6. Non-reactive scene runtime — `components/scene/sceneRuntime.ts`

A plain singleton object holds **per-frame transient state** (camera distance, zoom level, type visibilities, detail-set ids). Scene controllers read & mutate it inside `useFrame`. Nothing inside it is a hook subscription, so changes to it **never** trigger reconciliation. This is the key to keeping React out of the hot path.

### 7. MiniMap — `components/ui/MiniMap.tsx`

2D top-down projection drawn into a **regular DOM `<canvas>`**, completely outside the R3F render loop. ~30 Hz redraw. Shows full graph regardless of zoom, plus camera marker and current zoom level. Costs nothing on the main 3D budget.

### 8. AST cache — `parser/parsePipeline.ts`

Source code is hashed (FNV-1a). Identical source = skip Pyodide round-trip and re-apply the cached graph + execution trace instantly. LRU cap = 16 entries.

---

## Run cave

Caveman tool need **Node 20+**.

```bash
cd sspe
npm install
npm run dev          # http://localhost:5173
npm run build        # tsc -b && vite build
npm run lint
```

First load downloads Pyodide WASM (~10 MB). Watch the loading screen for progress chatter.

---

## Shape legend

| Shape                | Meaning                                       | Colour  |
|----------------------|-----------------------------------------------|---------|
| Rounded box          | Variable / assignment (live value flashes)    | cyan    |
| Spinning ring        | Loop (with `N×` iteration badge)              | violet  |
| Flat diamond         | Condition (YES/NO branches glow)              | amber   |
| Hex pillar           | Function (`calls` and `returns` edges)        | green   |
| Icosahedron + inner  | Recursion (self-call into a smaller chamber)  | crimson |
| Small sphere         | Expression / function call                    | slate   |

Edge types:
- **executes** — parent runs child (white)
- **controlsFlow** — branch (amber, with YES/NO label)
- **calls** — function invocation (green)
- **returns** — function return (red)
- **dependsOn** — variable use (cyan, dashed)
- **dataFlow** — value flow (white, dashed)

---

## How code become world

Python → Pyodide AST walk → `astToGraph` builds nodes + edges + per-node metadata
→ `forceLayout3D` runs Coulomb + Hooke + centering forces to place nodes in 3D
→ `executionSimulator.buildExecutionSteps` produces a deterministic timeline
→ scene renders, `ExecutionPlayer` ticks the timeline, particles fly.

Click any node → editor jumps to the source line. Click any source line → corresponding node highlights.

---

## Inspirations / why

Caveman tired of reading flat text walls. Caveman want code as **place**. Want to walk into a function the same way you walk into a cave. Want to see the loops actually loop, the if/else actually fork, the variable actually mutate.

The cave is meant as:
- a **visual debugger** (watch a fixpoint, a recursion, a loop, in 3D)
- a **teaching tool** (the shapes themselves explain the language)
- a **scalable graph engine** (the architecture above is built to grow to 10k–1M nodes)
- a small **research playpen** for "what if programs lived in semantic space?"

---

## Tech inside the cave

- **React 19** + **TypeScript**
- **Vite** bundler, **Tailwind** for the 2D UI chrome
- **Three.js** for raw 3D, **@react-three/fiber** for declarative React bindings, **@react-three/drei** for helpers, **@react-three/postprocessing** for the bloom pass
- **Pyodide** running in a Web Worker — parses Python `ast` + records variable mutations via `sys.settrace`
- **Zustand** for app state, plain singleton (`sceneRuntime`) for transient per-frame state
- **Monaco** for the code editor

---

## Roadmap (caveman dream big)

- WebGPU compute pass for the force-layout step (currently CPU, O(N²) per iteration — fine ≤ 1k nodes, will hurt past that)
- Octree / BVH for spatial partitioning of nodes once N > a few thousand (right now closest-N is linear)
- Incremental AST diffing (currently a code change re-parses the whole file)
- Auto-clustering of related nodes into collapsible "super-nodes" at zoom level 0
- Topology-aware navigation (jump along execution-frequent paths)
- Multi-language parsers (JS / TS / Rust / Go via tree-sitter)
- Real-time semantic diff between two versions of the same program
- Optional GNN for execution-path prediction and "warm" preloading

---

## License

MIT.

Caveman share fire.
