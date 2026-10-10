// Interactive 3D view of the cord (WebGL via three.js, loaded as a global).
//
// The cord is a cylinder wrapped in the surface texture from buildSurface():
// colour map, normal map for the fibres and stitch bumps, and a displacement
// map so the stitches stand out on the silhouette too. Both ends are bound
// with a wrapped thread collar. Drag to orbit, scroll or pinch to zoom.

const RADIUS = 1;

// Box blur (two passes, wrapping round the cord) for the displacement map.
function blur(src, W, H, r) {
  const tmp = new Float32Array(W * H);
  const out = new Float32Array(W * H);
  const n = 2 * r + 1;
  for (let y = 0; y < H; y++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[y * W + ((k + W) % W)];
    for (let x = 0; x < W; x++) {
      tmp[y * W + x] = acc / n;
      acc += src[y * W + ((x + r + 1) % W)] - src[y * W + ((x - r + W) % W)];
    }
  }
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      let acc = 0;
      let cnt = 0;
      for (let k = -r; k <= r; k++) {
        const yy = y + k;
        if (yy >= 0 && yy < H) { acc += tmp[yy * W + x]; cnt++; }
      }
      out[y * W + x] = acc / cnt;
    }
  }
  return out;
}

function canvasFrom(width, height, fill) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(width, height);
  fill(img.data);
  ctx.putImageData(img, 0, 0);
  return c;
}

function bindingTexture(THREE) {
  // Thread wound round the cord end: fine horizontal ridges.
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 64;
  const ctx = c.getContext('2d');
  for (let y = 0; y < 64; y++) {
    const t = 0.5 + 0.5 * Math.cos((y / 64) * Math.PI * 2 * 8);
    const v = Math.round(110 + 120 * t);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(0, y, 8, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function createCordView(canvas, { onModeChange } = {}) {
  const THREE = window.THREE;
  if (!THREE) return null;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    return null;
  }
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 2000);

  scene.add(new THREE.HemisphereLight(0xfff8f0, 0x2a2826, 0.3));
  const key = new THREE.DirectionalLight(0xffffff, 1.35);
  key.position.set(-3, 4, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xdfe8ff, 0.7);
  rim.position.set(4, 1, -4);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffffff, 0.2);
  fill.position.set(2, -3, 3);
  scene.add(fill);

  const group = new THREE.Group();
  scene.add(group);

  const cordMaterial = new THREE.MeshPhysicalMaterial({
    roughness: 0.55,
    metalness: 0,
    sheen: new THREE.Color(0.12, 0.12, 0.12),
    normalScale: new THREE.Vector2(1, 1),
    displacementScale: 0.045,
    displacementBias: -0.03,
  });
  const bindTex = bindingTexture(THREE);
  const bindMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xc9a86a,
    roughness: 0.4,
    metalness: 0.25,
    sheen: new THREE.Color(0.3, 0.28, 0.2),
    bumpMap: bindTex,
    bumpScale: 0.02,
  });
  bindTex.repeat.set(1, 3);
  const capMaterial = new THREE.MeshStandardMaterial({ color: 0x8a7148, roughness: 0.8 });

  let cord = null;
  let length = 10;
  const extras = [];

  // Orbit state.
  const view = { azimuth: 0, elevation: 0.12, distance: 20, target: new THREE.Vector3() };
  let fitDistance = 20;
  let spinning = false;
  let raf = 0;

  function place() {
    const ce = Math.cos(view.elevation);
    camera.position.set(
      view.target.x + view.distance * ce * Math.sin(view.azimuth),
      view.target.y + view.distance * Math.sin(view.elevation),
      view.target.z + view.distance * ce * Math.cos(view.azimuth),
    );
    camera.lookAt(view.target);
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 300;
    const h = canvas.clientHeight || 300;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function render() {
    resize();
    place();
    renderer.render(scene, camera);
  }

  function requestRender() {
    if (!raf) raf = requestAnimationFrame(frame);
  }

  let lastT = 0;
  function frame(t) {
    raf = 0;
    if (spinning) {
      if (lastT) view.azimuth += (t - lastT) * 0.0005;
      lastT = t;
      raf = requestAnimationFrame(frame);
    } else lastT = 0;
    render();
  }

  function fit() {
    const vfov = (camera.fov * Math.PI) / 180;
    const aspect = camera.aspect || 0.6;
    const tan = Math.tan(vfov / 2);
    const needW = (RADIUS * 2.6) / 2 / tan / aspect;
    fitDistance = Math.max((length + 1.4) / 2 / tan, needW) * 1.08;
    if (mode === 'coil') {
      // Look down on the coil from above and in front.
      const span = coilOuter * 2.15;
      view.distance = Math.max(span / 2 / tan, span / 2 / tan / aspect);
      fitDistance = Math.max(fitDistance, view.distance);
      view.target.set(0, 0, 0);
      view.elevation = 1.0;
    } else if (mode === 'straight') {
      view.distance = fitDistance;
      view.target.set(0, 0, 0);
      view.elevation = 0.12;
    } else {
      // Close-up: about 14 cord-widths, starting at the newest end (nearest the disk).
      const startLen = Math.min(length + 1.4, 28 * RADIUS);
      view.distance = Math.max(startLen / 2 / tan, needW) * 1.08;
      view.target.set(0, Math.max(0, (length + 1.4 - startLen) / 2), 0);
      view.elevation = 0.12;
    }
  }

  function setSurface(surface) {
    if (cord) {
      group.remove(cord);
      cord.geometry.dispose();
      for (const k of ['map', 'normalMap', 'displacementMap']) cordMaterial[k]?.dispose();
    }
    for (const m of extras) { group.remove(m); m.geometry.dispose(); }
    extras.length = 0;
    cord = null;
    if (!surface) { texSize = [0, 0]; requestRender(); return; }

    const { width: W, height: H } = surface;
    const map = new THREE.CanvasTexture(canvasFrom(W, H, (d) => d.set(surface.albedo)));
    map.encoding = THREE.sRGBEncoding;
    const normalMap = new THREE.CanvasTexture(canvasFrom(W, H, (d) => {
      const n = surface.normal;
      for (let k = 0, o = 0; k < W * H; k++, o += 4) {
        d[o] = (n[k * 3] * 0.5 + 0.5) * 255;
        d[o + 1] = (-n[k * 3 + 1] * 0.5 + 0.5) * 255; // texture y runs down, uv v runs up
        d[o + 2] = (n[k * 3 + 2] * 0.5 + 0.5) * 255;
        d[o + 3] = 255;
      }
    }));
    const dispMap = new THREE.CanvasTexture(canvasFrom(W, H, (d) => {
      const h = blur(surface.heightMap, W, H, Math.max(1, Math.round(W / 160)));
      for (let k = 0, o = 0; k < W * H; k++, o += 4) {
        const v = Math.min(255, h[k] * 255);
        d[o] = d[o + 1] = d[o + 2] = v;
        d[o + 3] = 255;
      }
    }));
    for (const t of [map, normalMap, dispMap]) {
      t.wrapS = THREE.RepeatWrapping;
      t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    }
    cordMaterial.map = map;
    cordMaterial.normalMap = normalMap;
    cordMaterial.displacementMap = dispMap;
    cordMaterial.needsUpdate = true;

    const oldLength = length;
    length = (H / W) * 2 * Math.PI * RADIUS;
    const firstTime = !texSize[0];
    texSize = [W, H];
    buildMesh();
    // Keep the viewer's camera when only colours change; reframe for a new length.
    if (firstTime || Math.abs(length - oldLength) > 1e-6) {
      resize();
      fit();
    }
    requestRender();
  }

  // ---- shape: the cord follows a path, straight up or coiled flat
  let mode = 'close';
  let texSize = [0, 0];
  let coilOuter = 0;

  function makePath() {
    if (mode !== 'coil') {
      return {
        at: (t) => new THREE.Vector3(0, length / 2 - t * length, 0),
        tangent: () => new THREE.Vector3(0, -1, 0),
      };
    }
    // Archimedean spiral lying flat, newest end at the centre.
    const gap = 2.5 * RADIUS;
    const a = 2.4 * RADIUS;
    const b = gap / (2 * Math.PI);
    const theta = (-a + Math.sqrt(a * a + 2 * b * length)) / b; // arc length ≈ aθ + bθ²/2
    const n = Math.max(64, Math.ceil((theta / (2 * Math.PI)) * 96));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const th = (theta * i) / n;
      const r = a + b * th;
      pts.push(new THREE.Vector3(r * Math.cos(th), 0, r * Math.sin(th)));
    }
    coilOuter = a + b * theta + RADIUS;
    const curve = new THREE.CatmullRomCurve3(pts);
    return { at: (t) => curve.getPointAt(Math.min(1, t)), tangent: (t) => curve.getTangentAt(Math.min(1, t)) };
  }

  function buildMesh() {
    if (cord) { group.remove(cord); cord.geometry.dispose(); }
    for (const m of extras) { group.remove(m); m.geometry.dispose(); }
    extras.length = 0;
    const [W, H] = texSize;
    if (!W) return;

    // Enough vertices for the stitches to bulge; fine detail is in the normal map.
    const radial = Math.min(192, W);
    const rows = Math.max(8, Math.min(mode === 'coil' ? 1400 : 900, Math.round(H / 3)));
    // Cylinder uv.u runs counter-clockwise seen from above, like the braid's angles.
    const geo = new THREE.CylinderGeometry(RADIUS, RADIUS, length, radial, rows, true);
    const path = makePath();
    const up = new THREE.Vector3(0, 1, 0);
    // Frame at each row: offset = x * A + z * B, keeping the cylinder's handedness
    // (A x axis = B, where axis points towards the newest end, i.e. -tangent).
    const frames = [];
    for (let j = 0; j <= rows; j++) {
      const t = j / rows;
      const T = path.tangent(t).normalize();
      const axis = T.clone().negate();
      let A;
      let B;
      if (mode === 'coil') { A = axis.clone().cross(up).normalize(); B = up.clone(); } else { A = new THREE.Vector3(1, 0, 0); B = new THREE.Vector3(0, 0, 1); }
      frames.push({ P: path.at(t), A, B });
    }
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const j = Math.round(((length / 2 - y) / length) * rows);
      const f = frames[Math.max(0, Math.min(rows, j))];
      pos.setXYZ(i, f.P.x + x * f.A.x + z * f.B.x, f.P.y + x * f.A.y + z * f.B.y, f.P.z + x * f.A.z + z * f.B.z);
      const nx = nor.getX(i);
      const nz = nor.getZ(i);
      nor.setXYZ(i, nx * f.A.x + nz * f.B.x, nx * f.A.y + nz * f.B.y, nx * f.A.z + nz * f.B.z);
    }
    pos.needsUpdate = true;
    nor.needsUpdate = true;
    geo.computeBoundingSphere();
    cord = new THREE.Mesh(geo, cordMaterial);
    group.add(cord);

    // Bound ends: a wrapped collar and a cap at each end.
    for (const end of [0, 1]) {
      const out = path.tangent(end).normalize();
      if (end === 0) out.negate();
      const base = path.at(end);
      const collarH = 0.9;
      const collarGeo = new THREE.CylinderGeometry(RADIUS * 1.09, RADIUS * 1.09, collarH, 96, 1, true);
      const collar = new THREE.Mesh(collarGeo, bindMaterial);
      collar.quaternion.setFromUnitVectors(up, out);
      collar.position.copy(base).addScaledVector(out, collarH / 2 - 0.15);
      const cap = new THREE.Mesh(new THREE.CircleGeometry(RADIUS * 1.09, 64), capMaterial);
      cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), out);
      cap.position.copy(base).addScaledVector(out, collarH - 0.15);
      group.add(collar, cap);
      extras.push(collar, cap);
    }
  }

  function setMode(m) {
    const reshape = (m === 'coil') !== (mode === 'coil');
    mode = m;
    if (reshape) buildMesh();
    fit();
    requestRender();
  }

  // ---- pointer controls: drag to orbit, wheel or pinch to zoom, double-tap to reset
  const pointers = new Map();
  let pinchStart = 0;
  let distStart = 0;
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
      distStart = view.distance;
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    if (pointers.size === 1) {
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      view.azimuth -= dx * 0.008;
      view.elevation = Math.max(-1.45, Math.min(1.45, view.elevation + dy * 0.008));
    }
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchStart) view.distance = clampDist(distStart * (pinchStart / d));
    }
    requestRender();
  });
  // Double tap (or double click) returns to the close-up; dblclick isn't sent
  // for taps on iOS, so time the taps ourselves.
  let lastTap = 0;
  let downAt = null;
  canvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  const up = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = 0;
    if (downAt && performance.now() - downAt.t < 300 && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 10) {
      const now = performance.now();
      if (now - lastTap < 350) { lastTap = 0; setMode('close'); onModeChange?.(mode); } else lastTap = now;
    }
    downAt = null;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    view.distance = clampDist(view.distance * Math.exp(e.deltaY * 0.0012));
    requestRender();
  }, { passive: false });

  function clampDist(d) {
    return Math.max(RADIUS * 3.2, Math.min(fitDistance * 1.3, d));
  }

  window.addEventListener('resize', requestRender);

  return {
    setSurface,
    setSpin(on) { spinning = on; requestRender(); },
    resetView() { fit(); requestRender(); },
    /** Move the point the camera looks at along the cord: 0 = bottom, 1 = top. */
    lookAlong(t) {
      if (mode === 'coil') setMode('close');
      view.target.set(0, (t - 0.5) * length, 0);
      requestRender();
    },
    /** Where the camera is looking along the cord: 0 = bottom, 1 = top. */
    along() { return length ? view.target.y / length + 0.5 : 0.5; },
    /** 'close' (straight, zoomed in), 'straight' (whole cord upright) or 'coil'. */
    setMode,
    get mode() { return mode; },
    snapshot() { render(); return canvas.toDataURL('image/png'); },
    render: requestRender,
  };
}
