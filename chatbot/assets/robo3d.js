// A robô 3D (GLB do Tripo H3.1) em Three.js: a cabeça segue o cursor (giro só acima do pescoço, no shader),
// o peito respira, os LEDs e os olhos brilham (máscara de cor + bloom). Usada pela fase 1 e pela página final.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export function criarRobo(container, { modelo, aoCarregar, aoProgresso, enquadre = { y: 0.04, dist: 2.55, alvoX: 0 }, grade = false, claro = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);
  // o canvas ocupa o container em pixels CSS (sem isso, em telas Retina ele sai com o dobro do tamanho)
  Object.assign(renderer.domElement.style, { display: 'block', width: '100%', height: '100%' });

  const cena = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  cena.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  cena.environmentIntensity = 0.45;

  const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 20);
  camera.position.set(enquadre.alvoX, enquadre.y, enquadre.dist);
  camera.lookAt(enquadre.alvoX, enquadre.y - 0.02, 0);

  // fundo: o azul-marinho da referência, com um brilho no centro e duas faixas de luz (ciano e verde) desfocadas
  const fc = document.createElement('canvas'); fc.width = 1600; fc.height = 900;
  const g = fc.getContext('2d');
  let gr = g.createRadialGradient(800, 400, 40, 800, 450, 980);
  gr.addColorStop(0, '#0e2547'); gr.addColorStop(0.45, '#071631'); gr.addColorStop(1, '#020611');
  g.fillStyle = gr; g.fillRect(0, 0, 1600, 900);
  g.filter = 'blur(60px)'; g.globalCompositeOperation = 'lighter';
  for (const [x, y, c] of [[230, 160, '#0c6d8f'], [1380, 720, '#1d7a3a'], [1450, 120, '#0b4f7a'], [160, 760, '#0f5a3a']]) {
    gr = g.createRadialGradient(x, y, 0, x, y, 260); gr.addColorStop(0, c); gr.addColorStop(1, '#0000');
    g.fillStyle = gr; g.fillRect(x - 300, y - 300, 600, 600);
  }
  if (grade) {  // o piso quadriculado em perspectiva, bem apagado (BOT-008)
    g.filter = 'none'; g.globalCompositeOperation = 'source-over'; g.lineWidth = 1.2;
    const hz = 560, cx = 800;
    for (let i = -14; i <= 14; i++) {
      const gg = g.createLinearGradient(0, hz, 0, 900); gg.addColorStop(0, '#2bd5ff00'); gg.addColorStop(1, '#2bd5ff30');
      g.strokeStyle = gg; g.beginPath(); g.moveTo(cx + i * 30, hz); g.lineTo(cx + i * 190, 900); g.stroke();
    }
    for (let k = 0; k < 9; k++) {
      const y = hz + Math.pow(k / 8, 2.2) * (900 - hz);
      g.strokeStyle = `rgba(43,213,255,${0.04 + 0.14 * k / 8})`; g.beginPath(); g.moveTo(0, y); g.lineTo(1600, y); g.stroke();
    }
  }
  const ft = new THREE.CanvasTexture(fc); ft.colorSpace = THREE.SRGBColorSpace;
  cena.background = ft; cena.backgroundIntensity = 1;

  // fundo do tema claro: azul-gelo com um clarão branco no centro, manchas azul e verde nos cantos e curvas
  // brancas largas e desfocadas. Pintado aqui (e não em CSS atrás de um canvas transparente) porque o bloom
  // não preserva a transparência.
  const fcc = document.createElement('canvas'); fcc.width = 1600; fcc.height = 900;
  const c = fcc.getContext('2d');
  let gc = c.createLinearGradient(0, 0, 1600, 900); gc.addColorStop(0, '#eaf3fb'); gc.addColorStop(1, '#d5e6f4');
  c.fillStyle = gc; c.fillRect(0, 0, 1600, 900);
  c.filter = 'blur(40px)';
  for (const [x, y, r, cor] of [[800, 380, 640, 'rgba(255,255,255,.9)'], [110, 150, 420, 'rgba(160,208,240,.55)'], [1530, 820, 420, 'rgba(178,232,214,.5)']]) {
    gc = c.createRadialGradient(x, y, 0, x, y, r); gc.addColorStop(0, cor); gc.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = gc; c.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  c.filter = 'blur(9px)'; c.lineWidth = 34;
  for (const [x, y, r, a] of [[260, 540, 540, 0.7], [1420, 250, 470, 0.6], [1120, 1060, 640, 0.5]]) {
    c.strokeStyle = `rgba(255,255,255,${a})`; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke();
  }
  const ftClaro = new THREE.CanvasTexture(fcc); ftClaro.colorSpace = THREE.SRGBColorSpace;

  // o anel ciano atrás da cabeça (aberto embaixo, como na BOT-008)
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.0032, 8, 240, Math.PI * 2 * (280 / 360)),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0x29d9ff).multiplyScalar(2.2), toneMapped: false, transparent: true, opacity: 0.95 }));
  halo.rotation.z = -50 * Math.PI / 180;
  halo.position.set(0, 0.24, -0.32);
  cena.add(halo);

  // luz: chave quente-neutra de frente, contraluz ciano e verde nos lados (como na imagem)
  const hemi = new THREE.HemisphereLight(0xdfefff, 0x0a1830, 0.55); cena.add(hemi);
  const chave = new THREE.DirectionalLight(0xffffff, 1.2); chave.position.set(0.6, 1.0, 2.2); cena.add(chave);
  const ciano = new THREE.PointLight(0x2fd8ff, 2.2, 4); ciano.position.set(-1.1, 0.4, -0.4); cena.add(ciano);
  const verde = new THREE.PointLight(0x7dff4a, 1.4, 4); verde.position.set(1.1, 0.2, -0.4); cena.add(verde);

  const composer = new EffectComposer(renderer);
  composer.renderTarget1.texture.colorSpace = composer.renderTarget2.texture.colorSpace = THREE.LinearSRGBColorSpace;
  composer.addPass(new RenderPass(cena, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.32, 0.35, 0.92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // uniforms compartilhados com o shader
  const U = {
    uHead: { value: new THREE.Matrix3() },
    uPivot: { value: new THREE.Vector3(-0.08, -0.12, 0.0) },   // no espaço do GLB (a frente dele é +X)
    uY0: { value: -0.155 }, uY1: { value: -0.06 },
    uBreath: { value: 0 },
    uGlow: { value: 1.2 },
  };

  const grupo = new THREE.Group();
  cena.add(grupo);

  // o modelo vem comprimido (Draco + texturas WebP): o decodificador Draco vem da mesma versão do Three.js,
  // servido pelo próprio app (vendor/three), sem depender de CDN
  const draco = new DRACOLoader().setDecoderPath(new URL('../../vendor/three/addons/libs/draco/gltf/', import.meta.url).href);
  new GLTFLoader().setDRACOLoader(draco).load(modelo, (gltf) => {
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material;
      m.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, U);
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', `#include <common>
            uniform mat3 uHead; uniform vec3 uPivot; uniform float uY0, uY1, uBreath; varying float vHeadW;`)
          .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
            float hw = smoothstep(uY0, uY1, position.y);
            objectNormal = normalize(mix(objectNormal, uHead * objectNormal, hw));`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            vHeadW = hw;
            vec3 hp = uHead * (position - uPivot) + uPivot;
            transformed = mix(position, hp, hw);
            // respiração: o peito (abaixo do pescoço) sobe e abre um pouco
            float cw = 1.0 - smoothstep(uY0 - 0.06, uY0, position.y);
            transformed.y += cw * uBreath * 0.006;
            transformed.z *= 1.0 + cw * uBreath * 0.006;
            transformed.y += uBreath * 0.004;`);
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', `#include <common>
            uniform float uGlow; varying float vHeadW;`)
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
            vec3 cBase = diffuseColor.rgb;
            float mx = max(cBase.r, max(cBase.g, cBase.b)), mn = min(cBase.r, min(cBase.g, cBase.b));
            float sat = (mx - mn) / (mx + 1e-4);
            float glow = smoothstep(0.55, 0.8, sat) * smoothstep(0.18, 0.45, mx);
            totalEmissiveRadiance += cBase * glow * uGlow * 1.3;`);
      };
      m.needsUpdate = true;
    });
    // o GLB olha para +X: gira para a câmera (+Z), centraliza e normaliza a altura em 1
    gltf.scene.rotation.y = -Math.PI / 2;
    gltf.scene.updateMatrixWorld(true);
    const caixa = new THREE.Box3().setFromObject(gltf.scene);
    const tam = caixa.getSize(new THREE.Vector3()), centro = caixa.getCenter(new THREE.Vector3());
    gltf.scene.position.sub(centro);
    const esc = 1 / tam.y;
    grupo.scale.setScalar(esc);
    grupo.add(gltf.scene);
    aoCarregar?.();
  }, (ev) => ev.total && aoProgresso?.(ev.loaded / ev.total), (e) => console.error(e));

  // estado: olhar (cursor), fala, foco
  const alvo = { yaw: 0, pitch: 0 }, atual = { yaw: 0, pitch: 0, roll: 0 };
  let falando = 0, falaAlvo = 0, pulso = 0, fixo = null;
  const api = {
    olhar(nx, ny) { alvo.yaw = THREE.MathUtils.clamp(nx, -1, 1) * 0.34; alvo.pitch = THREE.MathUtils.clamp(ny, -1, 1) * 0.22; },
    falar(ligado) { falaAlvo = ligado ? 1 : 0; },
    fixar(nx, ny, ms = 1600) { fixo = { yaw: nx * 0.34, pitch: ny * 0.22, ate: performance.now() + ms }; },
    pulsar() { pulso = 1; },
    // tema claro: fundo azul-gelo, sem o anel e com a luz ambiente mais aberta; escuro: como na BOT-008
    tema(ehClaro) {
      cena.background = ehClaro ? ftClaro : ft;
      bloom.threshold = ehClaro ? 1.05 : 0.92;  // no claro o fundo chega perto de 1: só os LEDs (acima de 1) brilham
      halo.visible = !ehClaro;
      hemi.color.set(ehClaro ? 0xf2f8ff : 0xdfefff); hemi.groundColor.set(ehClaro ? 0x9fb8cc : 0x0a1830);
      hemi.intensity = ehClaro ? 0.7 : 0.55;
      cena.environmentIntensity = ehClaro ? 0.5 : 0.45;
      // o ajuste de tons vale para a cena inteira, fundo incluído: o ACES acinzenta o azul-gelo, o Neutral o mantém
      renderer.toneMapping = ehClaro ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = ehClaro ? 1.0 : 0.9;
    },
    U, bloom, renderer, halo, camera,
  };

  function tamanho() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h, false); composer.setSize(w, h); bloom.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(tamanho).observe(container); tamanho();

  const rel = new THREE.Clock(), m4 = new THREE.Matrix4(), eu = new THREE.Euler();
  const FIX = new THREE.Matrix4().makeRotationY(-Math.PI / 2), FIXI = FIX.clone().invert();
  renderer.setAnimationLoop(() => {
    const t = rel.getElapsedTime(), dt = Math.min(rel.getDelta() || 0.016, 0.05);
    falando += (falaAlvo - falando) * 0.08;
    pulso *= 0.94;
    // olhar suave + micro-movimentos ociosos; falando, a cabeça acena de leve
    const k = 0.06;
    const a = fixo && performance.now() < fixo.ate ? fixo : alvo;
    atual.yaw += (a.yaw + Math.sin(t * 0.37) * 0.03 - atual.yaw) * k;
    atual.pitch += (a.pitch + Math.sin(t * 0.53) * 0.015 + falando * Math.sin(t * 7.5) * 0.025 - atual.pitch) * k;
    atual.roll += (-atual.yaw * 0.12 + Math.sin(t * 0.29) * 0.012 - atual.roll) * k;
    // ny cresce para baixo (como clientY): pitch positivo inclina a cabeça para baixo, acompanhando o cursor
    eu.set(atual.pitch, atual.yaw, atual.roll, 'YXZ');
    // a rotação vai para o espaço do GLB (girado -90° em Y): fix⁻¹ · R · fix
    m4.makeRotationFromEuler(eu); m4.premultiply(FIXI).multiply(FIX);
    U.uHead.value.setFromMatrix4(m4);
    U.uBreath.value = Math.sin(t * 1.6);
    U.uGlow.value = 1.0 + Math.sin(t * 2.0) * 0.18 + falando * (0.35 + Math.sin(t * 12) * 0.35) + pulso * 1.2;
    grupo.rotation.y = atual.yaw * 0.18;
    grupo.position.y = Math.sin(t * 0.8) * 0.004;
    ciano.intensity = 2.2 + falando * 1.5 + pulso * 2;
    halo.material.opacity = 0.75 + Math.sin(t * 2.0) * 0.12 + falando * 0.15 + pulso * 0.2;
    halo.scale.setScalar(1 + pulso * 0.04 + falando * Math.sin(t * 6) * 0.006);
    composer.render(dt);
  });
  api.tema(claro);
  return api;
}
