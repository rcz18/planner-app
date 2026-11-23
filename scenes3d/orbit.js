/* 3D offer orbit (Three.js): a glowing ring around the speaker with thick glossy coins that fly out and orbit him.
   Made for roto shots: two layers of the same scene.
     opts.half = 'back'  → only what is BEHIND him (goes under your roto in Premiere)
     opts.half = 'front' → only what is IN FRONT of him (goes over your roto)
     opts.half = 'all'   → everything (plain overlay)
   Units are cqw (1 = 1% of the frame width). Times are seconds from the layer's start. */

const DEF_ITEMS = [
  { label: 'Course', color: '#F47F22', icon: 'course' },
  { label: 'E-book', color: '#FFE429', icon: 'ebook', dark: true },
  { label: 'Software', color: '#08B015', icon: 'software' },
  { label: 'Templates', color: '#F47F22', icon: 'templates' },
  { label: 'Coaching', color: '#FFE429', icon: 'coaching', dark: true },
  { label: 'Toolkit', color: '#08B015', icon: 'toolkit' },
];
/* icon outlines on a 24 × 24 grid (same drawings as the CSS version) */
const ICONS = {
  course: [['rect', 3, 4.5, 18, 12, 2], ['fill', 'M10 8.2v5l4.3-2.5z'], ['path', 'M8 20h8']],
  ebook: [['path', 'M4 5.5C6.5 4 9.5 4 12 5.5v14C9.5 18 6.5 18 4 19.5z'], ['path', 'M20 5.5C17.5 4 14.5 4 12 5.5v14c2.5-1.5 5.5-1.5 8 0z']],
  software: [['rect', 3, 4, 18, 16, 2], ['path', 'M3 8h18M9 12l-2 2 2 2M15 12l2 2-2 2']],
  templates: [['rect', 3.5, 3.5, 7, 7, 1.2], ['rect', 13.5, 3.5, 7, 7, 1.2], ['rect', 3.5, 13.5, 7, 7, 1.2], ['rect', 13.5, 13.5, 7, 7, 1.2]],
  coaching: [['circle', 12, 8, 3.6], ['path', 'M4.5 20c1.2-3.8 4-5.6 7.5-5.6s6.3 1.8 7.5 5.6']],
  toolkit: [['path', 'M12 2.5 21 7v10l-9 4.5L3 17V7z'], ['path', 'M3 7l9 4.5L21 7M12 11.5v10']],
};

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
const outBack = x => { x = clamp(x); const c = 1.9; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
const outCubic = x => 1 - Math.pow(1 - clamp(x), 3);

export default async function orbit({ THREE, renderer, opts = {}, RoomEnvironment }) {
  const o = {
    half: 'all', cx: 50, cy: 35,            // ring center on screen (cqw from the left / top)
    R: 31, outer: 37, inner: 24,            // radii (cqw)
    persp: 80,                              // like CSS perspective (cqw)
    tiltFrom: 80, tiltTo: 68, yawFrom: -6, yawTo: 5, craneDur: 5.05,
    spin: 9,                                // seconds per turn
    flyAt: 0.82, flyStep: 0.07, flyDur: 0.75,
    coin: 6.2, thick: 1.8, label: 2.1,
    items: DEF_ITEMS, ...opts };
  const N = o.items.length;
  renderer.localClippingEnabled = true;
  try { await document.fonts.load('italic 900 64px "Roboto Condensed"'); } catch (e) {}

  /* ---------- scene, camera, light ---------- */
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environment = envTex;
  const cam = new THREE.PerspectiveCamera(2 * Math.atan(28.125 / o.persp) * 180 / Math.PI, 16 / 9, 1, 1000);
  cam.position.set(0, 0, o.persp); cam.lookAt(0, 0, 0);
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(-30, 50, 60); scene.add(key);
  const rim = new THREE.PointLight(0xff8a2a, 900, 0, 1.6); rim.position.set(0, -6, 14); scene.add(rim);
  scene.add(new THREE.AmbientLight(0xffffff, 0.25));

  /* clipping: world z = 0 is the plane through the ring center facing the camera (his body) */
  const clip = o.half === 'back' ? [new THREE.Plane(new THREE.Vector3(0, 0, -1), 0)] : o.half === 'front' ? [new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)] : [];
  const disposables = [envTex, pmrem];
  const keep = x => { disposables.push(x); return x; };
  const mat = (M, p) => keep(new M({ ...p, clippingPlanes: clip }));          // rings: cut exactly at his body plane
  const matW = (M, p) => keep(new M(p));                                       // coins: whole, they go to one layer or the other

  /* ---------- textures drawn on canvas ---------- */
  function glowTex(stops) { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    stops.forEach(([p, col]) => gr.addColorStop(p, col)); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); const t = keep(new THREE.CanvasTexture(c)); t.colorSpace = THREE.SRGBColorSpace; return t; }
  function rgba(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; }
  function mix(hex, k) { const n = parseInt(hex.slice(1), 16); const f = v => Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k)); return `rgb(${f(n >> 16 & 255)},${f(n >> 8 & 255)},${f(n & 255)})`; }
  function faceTex(it) { const S = 512, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
    const gr = g.createRadialGradient(S * .36, S * .3, S * .02, S / 2, S / 2, S / 2);
    gr.addColorStop(0, mix(it.color, .45)); gr.addColorStop(.55, it.color); gr.addColorStop(.86, mix(it.color, -.35)); gr.addColorStop(1, mix(it.color, -.55));
    g.fillStyle = gr; g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, 7); g.fill();
    g.lineWidth = S * .022; g.strokeStyle = mix(it.color, .55); g.beginPath(); g.arc(S / 2, S / 2, S * .4, 0, 7); g.stroke();
    g.save(); g.translate(S * .25, S * .25); g.scale(S * .5 / 24, S * .5 / 24);
    const col = it.dark ? '#18191B' : '#ffffff';
    g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowOffsetY = S * .012; g.shadowBlur = S * .01;
    g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1.9; g.lineCap = 'round'; g.lineJoin = 'round';
    (ICONS[it.icon] || ICONS.course).forEach(p => { const P = new Path2D();
      if (p[0] === 'rect') P.roundRect(p[1], p[2], p[3], p[4], p[5]); else if (p[0] === 'circle') P.arc(p[1], p[2], p[3], 0, 7); else P.addPath(new Path2D(p[1]));
      if (p[0] === 'fill') g.fill(P); else g.stroke(P); });
    g.restore(); const t = keep(new THREE.CanvasTexture(c)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
  function labelTex(it) { const W = 1024, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    const txt = it.label.toUpperCase(); g.font = 'italic 900 150px "Roboto Condensed", "Arial Narrow", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let k = 14; k >= 1; k--) { g.fillStyle = mix(it.color, -0.25 - k * 0.04); g.fillText(txt, W / 2 + k * 1.1, H / 2 + k * 1.6); }   // extruded sides
    g.shadowColor = rgba(it.color, .7); g.shadowBlur = 28;
    const gr = g.createLinearGradient(0, H * .2, 0, H * .8); gr.addColorStop(0, '#ffffff'); gr.addColorStop(.48, '#ffffff'); gr.addColorStop(1, mix(it.color, .55));
    g.fillStyle = gr; g.fillText(txt, W / 2, H / 2);
    const t = keep(new THREE.CanvasTexture(c)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }

  /* ---------- the ring group (tilted like a camera crane) ---------- */
  const world = new THREE.Group(); scene.add(world);
  const ring = new THREE.Group(); world.add(ring);           // lies in its own XY plane; tilt turns it into a floor ring
  const add = (geo, m) => { keep(geo); const me = new THREE.Mesh(geo, m); ring.add(me); return me; };
  const ORANGE = 0xF47F22;
  const band = add(new THREE.TorusGeometry(o.R, 0.24, 32, 320), mat(THREE.MeshPhysicalMaterial, { color: ORANGE, emissive: 0xff6a00, emissiveIntensity: 0.55, metalness: 0.55, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08 }));
  band.scale.z = 2.6;                                        // a band with real height, not a thin line
  const halo = add(new THREE.TorusGeometry(o.R, 0.95, 16, 240), mat(THREE.MeshBasicMaterial, { color: ORANGE, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.z = 1;
  const inner = add(new THREE.TorusGeometry(o.inner, 0.11, 10, 240), mat(THREE.MeshBasicMaterial, { color: 0xBED78C, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  /* outer dashed ring: rounded dashes */
  const DASH = 110, dGeo = keep(new THREE.CapsuleGeometry(0.16, 0.85, 4, 8)); dGeo.rotateZ(Math.PI / 2);
  const dashes = new THREE.InstancedMesh(dGeo, mat(THREE.MeshStandardMaterial, { color: 0xFFE429, emissive: 0xFFC400, emissiveIntensity: 1.1, metalness: 0.2, roughness: 0.4 }), DASH);
  { const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), Z = new THREE.Vector3(0, 0, 1), one = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < DASH; i++) { const a = i / DASH * Math.PI * 2; q.setFromAxisAngle(Z, a + Math.PI / 2); m4.compose(new THREE.Vector3(Math.cos(a) * o.outer, Math.sin(a) * o.outer, 0), q, one); dashes.setMatrixAt(i, m4); } }
  ring.add(dashes);
  /* light sparks running along the band */
  const SP = 26, spTex = glowTex([[0, 'rgba(255,240,200,1)'], [.25, 'rgba(255,170,60,.85)'], [1, 'rgba(255,120,20,0)']]);
  const sparks = []; for (let i = 0; i < SP; i++) { const s = new THREE.Sprite(mat(THREE.SpriteMaterial, { map: spTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); s.scale.setScalar(1.6 + (i % 3) * .5); ring.add(s); sparks.push(s); }
  /* shockwave: two flat rings that burst out when the coins leave */
  const shocks = [0xFFE429, ORANGE].map(c => { const me = add(new THREE.TorusGeometry(1, 0.06, 8, 160), mat(THREE.MeshBasicMaterial, { color: c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); me.visible = false; return me; });

  /* ---------- the coins ---------- */
  const r = o.coin / 2, h = o.thick, b = Math.min(0.55, h * 0.3);
  const prof = []; prof.push(new THREE.Vector2(0.001, h / 2));
  for (let k = 0; k <= 8; k++) { const a = Math.PI / 2 - k / 8 * Math.PI / 2; prof.push(new THREE.Vector2(r - b + Math.cos(a) * b, h / 2 - b + Math.sin(a) * b)); }
  for (let k = 0; k <= 8; k++) { const a = -k / 8 * Math.PI / 2; prof.push(new THREE.Vector2(r - b + Math.cos(a) * b, -h / 2 + b + Math.sin(a) * b)); }
  prof.push(new THREE.Vector2(0.001, -h / 2));
  const coinGeo = keep(new THREE.LatheGeometry(prof, 96)); coinGeo.rotateX(Math.PI / 2);   // face toward the camera (+z)
  const faceGeo = keep(new THREE.CircleGeometry(r - b * 0.9, 96));
  const coins = o.items.map((it, i) => {
    const g = new THREE.Group();                 // position on the ring (ring plane)
    const bb = new THREE.Group(); g.add(bb);     // turns to face the camera
    const body = new THREE.Mesh(coinGeo, matW(THREE.MeshPhysicalMaterial, { color: new THREE.Color(it.color).multiplyScalar(0.8), metalness: 0.75, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.06, emissive: it.color, emissiveIntensity: 0.12 }));
    const face = new THREE.Mesh(faceGeo, matW(THREE.MeshPhysicalMaterial, { map: faceTex(it), metalness: 0.25, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.05, emissive: 0xffffff, emissiveMap: null, emissiveIntensity: 0 }));
    face.position.z = h / 2 + 0.01;
    const back = face.clone(); back.rotation.y = Math.PI; back.position.z = -h / 2 - 0.01;
    const coin = new THREE.Group(); coin.add(body, face, back); coin.position.y = r * 0.55; bb.add(coin);
    const lab = new THREE.Mesh(keep(new THREE.PlaneGeometry(o.label * 4.6, o.label * 1.15)), matW(THREE.MeshBasicMaterial, { map: labelTex(it), transparent: true, depthWrite: false, depthTest: false, toneMapped: false }));
    
    lab.position.set(0, -r * 0.62 - o.label * 0.5, 0.6); lab.renderOrder = 10; bb.add(lab);
    const glow = new THREE.Sprite(matW(THREE.SpriteMaterial, { map: glowTex([[0, rgba(it.color, .65)], [.45, rgba(it.color, .22)], [1, rgba(it.color, 0)]]), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    glow.scale.setScalar(o.coin * 2.3); glow.position.set(0, r * 0.4, -h); bb.add(glow);
    const pad = new THREE.Mesh(keep(new THREE.CircleGeometry(6, 48)), matW(THREE.MeshBasicMaterial, { map: glowTex([[0, rgba(it.color, .75)], [.5, rgba(it.color, .2)], [1, rgba(it.color, 0)]]), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    g.add(pad);                                   // a pool of light on the ring floor
    ring.add(g); return { it, i, g, bb, coin, lab, glow, pad };
  });

  /* ---------- camera framing: the ring center sits at (cx, cy) on screen ---------- */
  let W = 1920, H = 1080;
  function frame() { cam.aspect = W / H; cam.setViewOffset(W, H, (0.5 - o.cx / 100) * W, (0.5 - o.cy / 56.25) * H, W, H); cam.updateProjectionMatrix(); }
  frame();

  const v3 = new THREE.Vector3(), qInv = new THREE.Quaternion();
  function render(t) {
    const cr = smooth(t / o.craneDur);
    const tilt = (o.tiltFrom + (o.tiltTo - o.tiltFrom) * cr) * Math.PI / 180, yaw = (o.yawFrom + (o.yawTo - o.yawFrom) * cr) * Math.PI / 180;
    world.rotation.set(0, 0, 0); ring.rotation.set(-tilt, yaw, 0, 'YXZ');
    const spin = (t / o.spin) * Math.PI * 2;
    /* the tracks grow in */
    const tr = outCubic((t - o.flyAt) / 0.6), trS = 0.2 + 0.8 * tr;
    [band, halo, inner, dashes].forEach(m => { m.scale.x = m.scale.y = trS; m.visible = tr > 0.001; });
    halo.material.opacity = 0.16 * tr; inner.material.opacity = 0.55 * tr; dashes.rotation.z = -spin * 0.35;
    /* shockwave */
    shocks.forEach((s, k) => { const p = (t - o.flyAt - k * 0.15) / 0.9; s.visible = p > 0 && p < 1; if (!s.visible) return; const e = outCubic(p); s.scale.set(2 + e * (o.outer + 10), 2 + e * (o.outer + 10), 1); s.material.opacity = (1 - p) * 0.95; });
    /* sparks run along the band */
    sparks.forEach((s, k) => { const a = k / SP * Math.PI * 2 + spin * 1.6; s.position.set(Math.cos(a) * o.R * trS, Math.sin(a) * o.R * trS, 0); s.material.opacity = tr * (0.55 + 0.45 * Math.sin(t * 6 + k)); });
    /* coins fly out, then orbit; each one faces the camera */
    ring.updateMatrixWorld(true); qInv.copy(ring.getWorldQuaternion(new THREE.Quaternion())).invert();
    coins.forEach(c => { const p = (t - o.flyAt - c.i * o.flyStep) / o.flyDur; const R = o.R * outBack(p), vis = p > 0;
      const a = c.i / N * Math.PI * 2 + spin; c.g.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
      c.bb.quaternion.copy(qInv); c.coin.rotation.y = Math.sin(t * Math.PI * 2 / 6.4 + c.i * 1.1) * 0.38;
      const sc = 0.35 + 0.65 * outCubic(p * 1.4); c.bb.scale.setScalar(sc); c.pad.scale.setScalar(sc);
      /* which layer it belongs to: in front of him or behind him */
      c.g.getWorldPosition(v3); const front = v3.z >= 0;
      const show = vis && (o.half === 'all' || (o.half === 'front') === front);
      c.g.visible = show; c.lab.material.opacity = clamp(p * 5); c.glow.material.opacity = clamp(p * 3) * 0.9; c.pad.material.opacity = clamp(p * 3) * 0.8;
      /* front coins are lit, back ones a bit darker, like the CSS --lit */
      const lit = 0.7 + 0.3 * Math.sin(a);
      c.coin.children[0].material.emissiveIntensity = 0.08 + 0.12 * lit; });
    renderer.render(scene, cam);
  }
  return {
    render,
    resize(w, hh) { W = w; H = hh; frame(); },
    dispose() { disposables.forEach(x => { try { x.dispose(); } catch (e) {} }); scene.traverse(m => { if (m.material) { try { m.material.dispose(); } catch (e) {} } }); },
  };
}
