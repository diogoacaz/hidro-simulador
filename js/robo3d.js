// O robô 3D da página Chatbot, modelado em código com three.js.
//
// Não há arquivo de modelo: cada peça é uma forma geométrica (esferas,
// cápsulas, cilindros, extrusões), montada numa hierarquia de articulações
// — quadril → tronco → pescoço → cabeça; ombro → cotovelo → mão; quadril →
// joelho → pé. Assim cada parte se anima sozinha (piscar, acenar, falar,
// olhar para o cursor) e o conjunto inteiro pesa alguns KB.
//
// O desenho segue a referência do app: armadura branco-perolada, traje
// verde-petróleo, filetes lima que brilham (bloom), visor preto com o rosto
// sorridente aceso, raio no peito e fones laterais.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const LIMA = 0xc3ff24;

/* ------------------------------------------------------------------ *
 * Materiais
 * ------------------------------------------------------------------ */

function materiais() {
  return {
    armadura: new THREE.MeshPhysicalMaterial({
      color: 0xd9dfdc, metalness: 0.3, roughness: 0.3,
      clearcoat: 0.8, clearcoatRoughness: 0.18,
    }),
    traje: new THREE.MeshPhysicalMaterial({
      color: 0x103a2f, metalness: 0.2, roughness: 0.48, clearcoat: 0.35, envMapIntensity: 0.5,
    }),
    trajeEscuro: new THREE.MeshStandardMaterial({ color: 0x0c241d, metalness: 0.3, roughness: 0.5, envMapIntensity: 0.5 }),
    junta: new THREE.MeshStandardMaterial({ color: 0x8e9893, metalness: 0.9, roughness: 0.3 }),
    visor: new THREE.MeshPhysicalMaterial({
      color: 0x030605, metalness: 0.2, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.03,
    }),
    // O brilho passa do limiar do bloom: toneMapped desligado e cor acima de 1.
    brilho: new THREE.MeshBasicMaterial({ color: new THREE.Color(LIMA).multiplyScalar(1.9), toneMapped: false }),
    rosto: new THREE.MeshBasicMaterial({ color: new THREE.Color(LIMA).multiplyScalar(2.4), toneMapped: false }),
  };
}

/* ------------------------------------------------------------------ *
 * Peças
 * ------------------------------------------------------------------ */

const sombra = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };

function malha(geo, mat, { x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0 } = {}) {
  const m = sombra(new THREE.Mesh(geo, mat));
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.rotation.set(rx, ry, rz);
  return m;
}

const capsula = (r, comp) => new THREE.CapsuleGeometry(r, comp, 10, 24);
const esfera = (r, w = 40, h = 28) => new THREE.SphereGeometry(r, w, h);

// Filete de luz ao longo de uma curva.
function filete(pontos, raio, mat) {
  const curva = new THREE.CatmullRomCurve3(pontos.map((p) => new THREE.Vector3(...p)));
  return new THREE.Mesh(new THREE.TubeGeometry(curva, 32, raio, 8, false), mat);
}

function anel(raio, tubo, mat, opts) {
  return malha(new THREE.TorusGeometry(raio, tubo, 12, 48), mat, opts);
}

function raio(mat) {
  // O raio do peito, como o da marca.
  const s = new THREE.Shape();
  const pts = [[0.02, 0.16], [-0.09, -0.01], [-0.005, -0.01], [-0.04, -0.16], [0.09, 0.03], [0.005, 0.03], [0.05, 0.16]];
  s.moveTo(...pts[0]);
  for (const p of pts.slice(1)) s.lineTo(...p);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 2 });
  geo.center();
  return new THREE.Mesh(geo, mat);
}

/* ------------------------------------------------------------------ *
 * Montagem
 * ------------------------------------------------------------------ */

function montarRobo(M) {
  const robo = new THREE.Group();
  const j = {}; // articulações animadas

  // --- Quadril (raiz do corpo) ---
  j.quadril = new THREE.Group();
  j.quadril.position.y = 1.62;
  robo.add(j.quadril);
  j.quadril.add(malha(esfera(0.3), M.traje, { y: 0.0, sx: 1.08, sy: 0.62, sz: 0.8 }));
  // Cinto branco e placa frontal em V, arredondados
  j.quadril.add(malha(new THREE.TorusGeometry(0.27, 0.05, 12, 48), M.armadura, { y: 0.1, rx: Math.PI / 2, sx: 1.05, sy: 0.78 }));
  j.quadril.add(malha(esfera(0.14), M.armadura, { y: -0.06, z: 0.17, sx: 1.05, sy: 0.95, sz: 0.45, rx: -0.15 }));
  for (const s of [-1, 1]) j.quadril.add(malha(new THREE.CapsuleGeometry(0.01, 0.1, 6, 10), M.brilho, { x: s * 0.2, y: -0.02, z: 0.19, rz: s * 0.5 }));

  // --- Tronco ---
  j.tronco = new THREE.Group();
  j.tronco.position.y = 0.12;
  j.quadril.add(j.tronco);
  // Abdômen do traje, em gomos
  for (let k = 0; k < 3; k++) {
    j.tronco.add(malha(esfera(0.25), M.traje, { y: 0.1 + k * 0.13, sx: 1.12 - k * 0.02, sy: 0.32, sz: 0.78 }));
  }
  // Tronco escuro de base
  j.tronco.add(malha(capsula(0.27, 0.42), M.traje, { y: 0.5, sx: 1.35, sz: 0.82 }));

  // Peito (respira)
  j.peito = new THREE.Group();
  j.peito.position.y = 0.72;
  j.tronco.add(j.peito);
  j.peito.add(malha(esfera(0.42), M.armadura, { y: 0.03, z: 0.03, sx: 1.05, sy: 0.68, sz: 0.7 }));
  // Placa inferior do peito, em V, sobre o abdômen escuro
  j.peito.add(malha(esfera(0.2), M.armadura, { y: -0.2, z: 0.14, sx: 1.1, sy: 0.55, sz: 0.6 }));
  // Gola e placas laterais
  j.peito.add(malha(new THREE.CylinderGeometry(0.17, 0.22, 0.12, 32), M.traje, { y: 0.32 }));
  const insignia = raio(M.brilho);
  insignia.position.set(0, 0.07, 0.338);
  insignia.rotation.x = -0.22;
  insignia.scale.setScalar(1.15);
  j.peito.add(insignia);
  // Botões luminosos dos ombros do peito
  for (const s of [-1, 1]) {
    j.peito.add(anel(0.035, 0.009, M.brilho, { x: s * 0.27, y: 0.2, z: 0.24, rx: -0.5, ry: s * 0.35 }));
    // Filetes que descem do peito à cintura
    j.tronco.add(filete([
      [s * 0.3, 0.62, 0.2], [s * 0.22, 0.42, 0.25], [s * 0.2, 0.22, 0.24], [s * 0.22, 0.04, 0.2],
    ], 0.012, M.brilho));
  }

  // --- Pescoço e cabeça ---
  j.pescoco = new THREE.Group();
  j.pescoco.position.y = 0.38;
  j.peito.add(j.pescoco);
  j.pescoco.add(malha(new THREE.CylinderGeometry(0.085, 0.11, 0.2, 24), M.trajeEscuro, { y: 0.08 }));
  for (let k = 0; k < 3; k++) j.pescoco.add(malha(new THREE.TorusGeometry(0.095, 0.012, 8, 24), M.junta, { y: 0.02 + k * 0.06, rx: Math.PI / 2 }));

  j.cabeca = new THREE.Group();
  j.cabeca.position.y = 0.42;
  j.pescoco.add(j.cabeca);
  j.cabeca.add(malha(esfera(0.3, 48, 36), M.armadura, { sx: 1, sy: 1.12, sz: 1.04 }));
  // Visor: calota frontal preta. Na esfera do three.js a frente (+z) fica
  // em phi = π/2; a calota cobre 2,5 rad em volta dela.
  j.cabeca.add(malha(new THREE.SphereGeometry(0.306, 48, 36, Math.PI / 2 - 1.12, 2.24, 0.72, 1.6),
    M.visor, { sx: 1, sy: 1.12, sz: 1.04 }));
  // Rosto aceso
  j.rosto = new THREE.Group();
  j.rosto.position.set(0, -0.02, 0.312);
  j.cabeca.add(j.rosto);
  j.olhos = [];
  for (const s of [-1, 1]) {
    const olho = new THREE.Mesh(new THREE.TorusGeometry(0.048, 0.012, 10, 28, Math.PI), M.rosto);
    olho.position.set(s * 0.095, 0.05, 0.005);
    olho.rotation.y = s * 0.3;
    j.rosto.add(olho);
    j.olhos.push(olho);
  }
  j.boca = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 10, 32, Math.PI), M.rosto);
  j.boca.rotation.z = Math.PI;
  j.boca.position.set(0, -0.075, 0.0);
  j.rosto.add(j.boca);
  // Fones
  for (const s of [-1, 1]) {
    const fone = new THREE.Group();
    fone.position.set(s * 0.3, 0.01, 0);
    fone.rotation.z = s * Math.PI / 2;
    fone.add(malha(new THREE.CylinderGeometry(0.11, 0.12, 0.08, 36), M.armadura));
    fone.add(malha(new THREE.CylinderGeometry(0.075, 0.075, 0.09, 36), M.traje));
    fone.add(anel(0.06, 0.012, M.brilho, { y: -s * 0.046, rx: Math.PI / 2 }));
    j.cabeca.add(fone);
  }
  // Arco do capacete
  j.cabeca.add(malha(new THREE.TorusGeometry(0.3, 0.018, 10, 48, Math.PI), M.traje, { y: 0.02, sy: 1.12, rz: 0 }));

  // --- Braços ---
  for (const s of [-1, 1]) {
    const lado = s < 0 ? 'D' : 'E'; // direita do robô fica à esquerda da tela
    const ombro = new THREE.Group();
    ombro.position.set(s * 0.55, 0.22, 0);
    ombro.rotation.z = s * 0.42;
    j.peito.add(ombro);
    j[`ombro${lado}`] = ombro;
    // Ombreira
    ombro.add(malha(esfera(0.17), M.armadura, { y: 0.02, sx: 1.05, sy: 0.95, sz: 1.05 }));
    ombro.add(anel(0.06, 0.012, M.brilho, { x: s * 0.06, y: 0.1, z: 0.1, rx: -0.9, rz: s * 0.4 }));
    // Braço
    ombro.add(malha(capsula(0.1, 0.32), M.traje, { y: -0.28 }));
    ombro.add(malha(capsula(0.115, 0.2), M.armadura, { y: -0.25, z: 0.02, sx: 0.86, sz: 0.92 }));

    const cotovelo = new THREE.Group();
    cotovelo.position.y = -0.56;
    ombro.add(cotovelo);
    j[`cotovelo${lado}`] = cotovelo;
    cotovelo.add(malha(esfera(0.095), M.trajeEscuro));
    cotovelo.add(anel(0.05, 0.01, M.junta, { x: s * 0.08, rz: Math.PI / 2, ry: Math.PI / 2 }));
    cotovelo.add(malha(capsula(0.1, 0.34), M.traje, { y: -0.25 }));
    cotovelo.add(malha(capsula(0.105, 0.24), M.armadura, { y: -0.23, z: 0.015, sx: 0.88, sz: 0.94 }));
    cotovelo.add(malha(new THREE.CapsuleGeometry(0.014, 0.16, 6, 12), M.brilho, { y: -0.27, z: 0.1, x: s * 0.03 }));
    cotovelo.add(anel(0.085, 0.012, M.brilho, { y: -0.46, rx: Math.PI / 2 }));

    // Mão
    const mao = new THREE.Group();
    mao.position.y = -0.54;
    cotovelo.add(mao);
    j[`mao${lado}`] = mao;
    mao.add(malha(new THREE.BoxGeometry(0.15, 0.13, 0.06), M.traje, { y: -0.05 }));
    mao.add(malha(new THREE.BoxGeometry(0.13, 0.1, 0.045), M.armadura, { y: -0.05, z: 0.012 }));
    for (let d = 0; d < 4; d++) {
      const dedo = new THREE.Group();
      dedo.position.set(-0.054 + d * 0.036, -0.12, 0);
      dedo.rotation.x = 0.15;
      dedo.add(malha(new THREE.CapsuleGeometry(0.014, 0.08 - Math.abs(d - 1.5) * 0.012, 6, 10), M.armadura, { y: -0.05 }));
      mao.add(dedo);
    }
    const polegar = new THREE.Group();
    polegar.position.set(-s * 0.085, -0.06, 0.015);
    polegar.rotation.z = -s * 0.7;
    polegar.add(malha(new THREE.CapsuleGeometry(0.016, 0.06, 6, 10), M.armadura, { y: -0.04 }));
    mao.add(polegar);
  }

  // --- Pernas ---
  for (const s of [-1, 1]) {
    const lado = s < 0 ? 'D' : 'E';
    const coxa = new THREE.Group();
    coxa.position.set(s * 0.19, -0.06, 0);
    coxa.rotation.z = s * 0.03;
    j.quadril.add(coxa);
    j[`coxa${lado}`] = coxa;
    coxa.add(malha(capsula(0.13, 0.38), M.traje, { y: -0.3 }));
    coxa.add(malha(capsula(0.15, 0.3), M.armadura, { y: -0.3, x: s * 0.03, z: 0.035, sx: 0.84, sz: 0.88 }));
    coxa.add(malha(new THREE.CapsuleGeometry(0.012, 0.16, 6, 10), M.brilho, { y: -0.3, x: -s * 0.1, z: 0.11, rz: s * 0.15 }));

    const joelho = new THREE.Group();
    joelho.position.y = -0.66;
    coxa.add(joelho);
    j[`joelho${lado}`] = joelho;
    joelho.add(malha(esfera(0.11), M.trajeEscuro));
    joelho.add(malha(esfera(0.1), M.armadura, { z: 0.06, sx: 0.9, sy: 1.15, sz: 0.7 }));
    for (const lx of [-1, 1]) joelho.add(anel(0.045, 0.011, M.brilho, { x: lx * 0.11, rz: Math.PI / 2, ry: Math.PI / 2 }));
    joelho.add(malha(capsula(0.11, 0.4), M.traje, { y: -0.32 }));
    joelho.add(malha(capsula(0.12, 0.3), M.armadura, { y: -0.3, z: 0.03, sx: 0.88, sz: 0.9 }));
    joelho.add(malha(new THREE.CapsuleGeometry(0.013, 0.24, 6, 10), M.brilho, { y: -0.34, x: s * 0.06, z: 0.115 }));

    // Pé
    const pe = new THREE.Group();
    pe.position.y = -0.66;
    joelho.add(pe);
    pe.add(malha(capsula(0.1, 0.12), M.traje, { y: 0.02, z: 0.0 }));
    pe.add(malha(capsula(0.11, 0.22), M.armadura, { y: -0.1, z: 0.06, rx: Math.PI / 2, sx: 1.05, sz: 0.62 }));
    pe.add(malha(new THREE.BoxGeometry(0.12, 0.012, 0.012), M.brilho, { y: -0.06, z: 0.2 }));
  }

  return { robo, j };
}

// Sombra de contato macia sob os pés: um degradê radial num plano, mais
// barato e mais bonito que sombra projetada num chão infinito.
function sombraDeContato() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.42)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.16)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const mat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false });
  const plano = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.1), mat);
  plano.rotation.x = -Math.PI / 2;
  plano.position.y = 0.002;
  return plano;
}

/* ------------------------------------------------------------------ *
 * Cena
 * ------------------------------------------------------------------ */

/**
 * Cria o robô dentro de `alvo` (um elemento com tamanho definido pelo CSS).
 * @returns {{acenar, falar, destruir, atualizarTema}}
 */
export function criarRobo(alvo, { corFundo = '#ffffff', reduzirMovimento = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  // Sem tone mapping: com ele o fundo branco do palco virava cinza (ACES
  // nunca devolve branco puro). As luzes são dosadas para não estourar, e o
  // HDR do brilho continua existindo no composer para o bloom.
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  alvo.appendChild(renderer.domElement);

  const cena = new THREE.Scene();
  cena.background = new THREE.Color(corFundo);
  const pmrem = new THREE.PMREMGenerator(renderer);
  cena.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  cena.environmentIntensity = 0.55;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  const alvoCamera = new THREE.Vector3(0, 1.82, 0);

  // Luzes: chave quente de cima, contraluz fria, preenchimento do céu.
  cena.add(new THREE.HemisphereLight(0xffffff, 0x1a3a33, 0.45));
  const chave = new THREE.DirectionalLight(0xffffff, 1.35);
  chave.position.set(2.5, 5, 4);
  chave.castShadow = true;
  chave.shadow.mapSize.set(1024, 1024);
  chave.shadow.camera.left = -2; chave.shadow.camera.right = 2;
  chave.shadow.camera.top = 4; chave.shadow.camera.bottom = -0.5;
  chave.shadow.bias = -0.0005;
  cena.add(chave);
  const contra = new THREE.DirectionalLight(0xc9f0ff, 1.1);
  contra.position.set(-3, 3, -4);
  cena.add(contra);
  const lima = new THREE.PointLight(LIMA, 0.6, 4);
  lima.position.set(0, 2.3, 1.2);
  cena.add(lima);

  const M = materiais();
  const { robo, j } = montarRobo(M);
  const base = new THREE.Group();
  base.add(robo);
  base.add(sombraDeContato());
  // Plataforma: um anel lima no chão.
  const plataforma = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.005, 8, 128), M.brilho);
  plataforma.rotation.x = Math.PI / 2;
  plataforma.position.y = 0.004;
  base.add(plataforma);
  const disco = new THREE.Mesh(new THREE.CircleGeometry(0.78, 64),
    new THREE.MeshBasicMaterial({ color: LIMA, transparent: true, opacity: 0.06, depthWrite: false }));
  disco.rotation.x = -Math.PI / 2;
  disco.position.y = 0.003;
  base.add(disco);
  cena.add(base);

  // Pós-processamento: o bloom acende filetes, rosto e raio.
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(cena, camera));
  // Limiar acima de 1: só o que é emissivo (filetes, rosto, raio) passa;
  // abaixo disso o fundo branco também brilhava e o robô sumia na névoa.
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.42, 0.35, 1.3);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // --- Tamanho: a câmera recua até o robô caber inteiro na largura e na altura ---
  const ajustar = () => {
    const w = Math.max(1, alvo.clientWidth);
    const h = Math.max(1, alvo.clientHeight);
    renderer.setSize(w, h);
    composer.setSize(w, h);
    camera.aspect = w / h;
    const meiaV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    // Margem no alto para o selo de status não encostar na cabeça.
    const distAltura = 2.3 / meiaV;
    const distLargura = 1.45 / (meiaV * camera.aspect);
    const d = Math.max(distAltura, distLargura);
    camera.position.set(0, 1.95, d);
    camera.lookAt(alvoCamera);
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(ajustar);
  ro.observe(alvo);
  ajustar();

  // --- Interação: olhar o cursor, arrastar para girar, duplo clique acena ---
  const olhar = { x: 0, y: 0, ax: 0, ay: 0 };
  const giro = { alvo: 0, atual: 0, arrastando: false, x0: 0, base: 0 };
  const aoMover = (e) => {
    const r = alvo.getBoundingClientRect();
    olhar.x = THREE.MathUtils.clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1.5, 1.5);
    olhar.y = THREE.MathUtils.clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1.2, 1.2);
    if (giro.arrastando) giro.alvo = giro.base + ((e.clientX - giro.x0) / r.width) * Math.PI * 1.6;
  };
  const aoPressionar = (e) => { giro.arrastando = true; giro.x0 = e.clientX; giro.base = giro.alvo; alvo.setPointerCapture?.(e.pointerId); };
  const aoSoltar = () => { giro.arrastando = false; };
  window.addEventListener('pointermove', aoMover);
  alvo.addEventListener('pointerdown', aoPressionar);
  window.addEventListener('pointerup', aoSoltar);
  alvo.addEventListener('dblclick', () => acenar());

  // --- Estados de animação ---
  const estado = {
    aceno: -1,          // tempo desde o início do aceno (s); -1 = parado
    falando: false,
    boca: 0,
    piscar: 0,          // tempo restante do piscar
    proximoPiscar: 2.5,
    ligar: 0,           // 0 → 1 na entrada: o brilho acende
  };
  function acenar() { estado.aceno = 0; }
  function falar(sim) { estado.falando = !!sim; }

  const relogio = new THREE.Clock();
  let quadro = 0;
  let visivel = true;
  const io = new IntersectionObserver(([e]) => { visivel = e.isIntersecting; });
  io.observe(alvo);

  const cor = new THREE.Color(LIMA);
  const animar = () => {
    quadro = requestAnimationFrame(animar);
    if (!visivel || document.hidden) return;
    const dt = Math.min(relogio.getDelta(), 0.05);
    const t = relogio.elapsedTime;
    const mov = reduzirMovimento ? 0.25 : 1;

    // Entrada: brilho acende em ~1,2 s.
    estado.ligar = Math.min(1, estado.ligar + dt / 1.2);
    const pulso = 0.85 + 0.15 * Math.sin(t * 2.2);
    const intens = estado.ligar * pulso;
    M.brilho.color.copy(cor).multiplyScalar(0.25 + 1.65 * intens);
    M.rosto.color.copy(cor).multiplyScalar(0.3 + 2.1 * estado.ligar * (estado.falando ? 1.1 : 1));
    lima.intensity = 0.6 * intens;

    // Respiração e balanço de peso.
    j.peito.scale.set(1 + 0.008 * Math.sin(t * 1.6) * mov, 1 + 0.014 * Math.sin(t * 1.6) * mov, 1);
    j.quadril.position.y = 1.62 + 0.012 * Math.sin(t * 1.6) * mov;
    j.quadril.rotation.z = 0.025 * Math.sin(t * 0.7) * mov;
    j.tronco.rotation.z = -0.03 * Math.sin(t * 0.7) * mov;
    j.coxaD.rotation.z = -0.03 - 0.02 * Math.sin(t * 0.7) * mov;
    j.coxaE.rotation.z = 0.03 - 0.02 * Math.sin(t * 0.7) * mov;

    // Cabeça segue o cursor, suavizada.
    olhar.ax += (olhar.x - olhar.ax) * Math.min(1, dt * 4);
    olhar.ay += (olhar.y - olhar.ay) * Math.min(1, dt * 4);
    j.cabeca.rotation.y = olhar.ax * 0.4;
    j.cabeca.rotation.x = olhar.ay * 0.28 + (estado.falando ? 0.03 * Math.sin(t * 9) : 0);
    j.cabeca.rotation.z = -olhar.ax * 0.06 + 0.03 * Math.sin(t * 0.9) * mov;
    j.tronco.rotation.y = olhar.ax * 0.12;

    // Giro do corpo pelo arraste, com inércia; volta devagar à frente.
    if (!giro.arrastando) giro.alvo *= 1 - Math.min(1, dt * 0.35);
    giro.atual += (giro.alvo - giro.atual) * Math.min(1, dt * 6);
    base.rotation.y = giro.atual + 0.08 * Math.sin(t * 0.35) * mov;

    // Braços em repouso, com leve balanço.
    const balanco = 0.04 * Math.sin(t * 1.6 + 0.6) * mov;
    let ombroD = -0.42 - balanco;
    let ombroE = 0.42 + balanco;
    let cotD = 0.12;
    let cotE = -0.12;
    let maoD = 0;
    // Aceno: o braço direito sobe, o antebraço balança e desce.
    if (estado.aceno >= 0) {
      estado.aceno += dt;
      const a = estado.aceno;
      const DUR = 2.6;
      const sobe = THREE.MathUtils.smoothstep(a, 0, 0.45) * (1 - THREE.MathUtils.smoothstep(a, DUR - 0.5, DUR));
      ombroD = THREE.MathUtils.lerp(ombroD, -2.55, sobe);
      cotD = THREE.MathUtils.lerp(cotD, 0.35 + 0.42 * Math.sin(a * 11), sobe);
      maoD = 0.25 * sobe * Math.sin(a * 11 + 0.8);
      j.cabeca.rotation.z += 0.1 * sobe;
      if (a > DUR) estado.aceno = -1;
    }
    // Falando: gesto leve com a mão esquerda.
    if (estado.falando) {
      ombroE += 0.12 + 0.06 * Math.sin(t * 3);
      cotE = -0.5 - 0.15 * Math.sin(t * 3.3);
    }
    const suave = Math.min(1, dt * 10);
    j.ombroD.rotation.z += (ombroD - j.ombroD.rotation.z) * suave;
    j.ombroE.rotation.z += (ombroE - j.ombroE.rotation.z) * suave;
    j.cotoveloD.rotation.z += (cotD - j.cotoveloD.rotation.z) * suave;
    j.cotoveloE.rotation.z += (cotE - j.cotoveloE.rotation.z) * suave;
    j.ombroD.rotation.x = -0.05; j.ombroE.rotation.x = -0.05;
    j.cotoveloD.rotation.x = -0.15; j.cotoveloE.rotation.x = -0.15;
    j.maoD.rotation.z = maoD;

    // Piscar: os olhos achatam por ~0,14 s, a cada 2–5 s.
    estado.proximoPiscar -= dt;
    if (estado.proximoPiscar <= 0) { estado.piscar = 0.14; estado.proximoPiscar = 2 + Math.random() * 3; }
    let olhoY = 1;
    if (estado.piscar > 0) { estado.piscar -= dt; olhoY = 0.15; }
    for (const o of j.olhos) o.scale.y += (olhoY - o.scale.y) * Math.min(1, dt * 30);

    // Boca: abre e fecha enquanto fala.
    const bocaAlvo = estado.falando ? 0.55 + 0.45 * Math.abs(Math.sin(t * 13)) : 0;
    estado.boca += (bocaAlvo - estado.boca) * Math.min(1, dt * 18);
    j.boca.scale.set(1 - 0.15 * estado.boca, 1 + 0.9 * estado.boca, 1);

    composer.render();
  };
  animar();

  function atualizarTema(novaCor) {
    cena.background = new THREE.Color(novaCor);
  }

  function destruir() {
    cancelAnimationFrame(quadro);
    ro.disconnect();
    io.disconnect();
    window.removeEventListener('pointermove', aoMover);
    window.removeEventListener('pointerup', aoSoltar);
    cena.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    Object.values(M).forEach((m) => m.dispose());
    pmrem.dispose();
    composer.dispose?.();
    renderer.dispose();
    renderer.domElement.remove();
  }

  return { acenar, falar, destruir, atualizarTema };
}
