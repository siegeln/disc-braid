// Interactive 3D view of the cord (WebGL via three.js, loaded as a global).
//
// The cord is a cylinder wrapped in the surface texture from buildSurface():
// colour map, normal map for the fibres and stitch bumps, and a displacement
// map so the stitches stand out on the silhouette too. Both ends are bound
// with a wrapped thread collar. Drag to orbit, scroll or pinch to zoom.

const RADIUS = 1;

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

export function createCordView(canvas) {
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
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 2000);

  scene.add(new THREE.HemisphereLight(0xfff8f0, 0x3a3836, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(-3, 4, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xdfe8ff, 0.9);
  rim.position.set(4, 1, -4);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffffff, 0.35);
  fill.position.set(2, -3, 3);
  scene.add(fill);

  const group = new THREE.Group();
  scene.add(group);

  const cordMaterial = new THREE.MeshPhysicalMaterial({
    roughness: 0.48,
    metalness: 0,
    sheen: new THREE.Color(0.35, 0.35, 0.35),
    normalScale: new THREE.Vector2(1, 1),
    displacementScale: 0.07,
    displacementBias: -0.035,
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
    // Frame the whole cord, standing upright.
    const vfov = (camera.fov * Math.PI) / 180;
    const aspect = camera.aspect || 0.6;
    const needH = (length + 1.4) / 2 / Math.tan(vfov / 2);
    const needW = (RADIUS * 2.6) / 2 / Math.tan(vfov / 2) / aspect;
    fitDistance = Math.max(needH, needW) * 1.08;
    view.distance = fitDistance;
    view.target.set(0, 0, 0);
    view.elevation = 0.12;
  }

  function setSurface(surface) {
    if (cord) {
      group.remove(cord);
      cord.geometry.dispose();
      for (const k of ['map', 'normalMap', 'displacementMap']) cordMaterial[k]?.dispose();
    }
    for (const m of extras) { group.remove(m); m.geometry.dispose(); }
    extras.length = 0;
    if (!surface) { requestRender(); return; }

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
      const h = surface.heightMap;
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

    length = (H / W) * 2 * Math.PI * RADIUS;
    const radial = Math.min(384, W);
    const rows = Math.max(8, Math.min(1800, Math.round(H / 2)));
    // Cylinder uv.u runs the opposite way round to the braid's angles, so mirror it.
    map.repeat.x = normalMap.repeat.x = dispMap.repeat.x = -1;
    const geo = new THREE.CylinderGeometry(RADIUS, RADIUS, length, radial, rows, true);
    cord = new THREE.Mesh(geo, cordMaterial);
    group.add(cord);

    // Bound ends: a wrapped collar and a cap at each end.
    for (const sgn of [1, -1]) {
      const collarH = 0.9;
      const collarGeo = new THREE.CylinderGeometry(RADIUS * 1.09, RADIUS * 1.09, collarH, 96, 1, true);
      const tex = bindTex.clone();
      tex.needsUpdate = true;
      tex.repeat.set(1, 3);
      const mat = bindMaterial.clone();
      mat.bumpMap = tex;
      const collar = new THREE.Mesh(collarGeo, mat);
      collar.position.y = sgn * (length / 2 + collarH / 2 - 0.15);
      const capGeo = new THREE.CircleGeometry(RADIUS * 1.09, 64);
      const cap = new THREE.Mesh(capGeo, capMaterial);
      cap.rotation.x = sgn > 0 ? -Math.PI / 2 : Math.PI / 2;
      cap.position.y = sgn * (length / 2 + collarH - 0.15);
      group.add(collar, cap);
      extras.push(collar, cap);
    }
    resize();
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
  const up = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinchStart = 0; };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    view.distance = clampDist(view.distance * Math.exp(e.deltaY * 0.0012));
    requestRender();
  }, { passive: false });
  canvas.addEventListener('dblclick', () => { fit(); requestRender(); });

  function clampDist(d) {
    return Math.max(RADIUS * 3.2, Math.min(fitDistance * 1.6, d));
  }

  window.addEventListener('resize', requestRender);

  return {
    setSurface,
    setSpin(on) { spinning = on; requestRender(); },
    resetView() { fit(); requestRender(); },
    /** Move the point the camera looks at along the cord: 0 = bottom, 1 = top. */
    lookAlong(t) { view.target.y = (t - 0.5) * length; requestRender(); },
    snapshot() { render(); return canvas.toDataURL('image/png'); },
    render: requestRender,
  };
}
