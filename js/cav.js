// Tabela CAV (Cota × Área × Volume) discretizada de 1 em 1 cm.
//
// Representação compacta: como a grade é regular, a cota de cada nó é implícita
// (cota[i] = cotaInicial + i * PASSO_COTA) e só guardamos os vetores de área e
// volume. Isso reduz o tamanho no Firestore e torna a busca cota→índice O(1).

export const PASSO_COTA = 0.01; // m (1 cm)
const MAX_PONTOS = 60000; // ~600 m de amplitude; protege contra documentos gigantes
const AVISO_PONTOS = 30000;

// Arredonda para o nó de 1 cm mais próximo, evitando ruído de ponto flutuante.
function arredondaCota(cota) {
  return Math.round(cota * 100) / 100;
}

/**
 * Constrói a tabela CAV regular a partir de pontos esparsos (ou já completos).
 * @param {{cota:number, area:number, volume:number}[]} pontos
 * @returns {{cotaInicial:number, passo:number, areas:number[], volumes:number[], pontos:number}}
 */
export function construirCav(pontos) {
  const limpos = pontos
    .filter((p) => Number.isFinite(p.cota) && Number.isFinite(p.area) && Number.isFinite(p.volume))
    .sort((a, b) => a.cota - b.cota);

  if (limpos.length < 2) {
    throw new Error('A tabela CAV precisa de ao menos 2 pontos válidos (cota, área, volume).');
  }

  // Remove cotas duplicadas mantendo a última ocorrência.
  const unicos = [];
  for (const p of limpos) {
    if (unicos.length && arredondaCota(unicos[unicos.length - 1].cota) === arredondaCota(p.cota)) {
      unicos[unicos.length - 1] = p;
    } else {
      unicos.push(p);
    }
  }

  for (let i = 1; i < unicos.length; i++) {
    if (unicos[i].volume < unicos[i - 1].volume) {
      throw new Error(
        `Volume não é crescente com a cota (cota ${unicos[i].cota} tem volume menor que ${unicos[i - 1].cota}). Verifique a planilha.`
      );
    }
  }

  const cotaInicial = arredondaCota(unicos[0].cota);
  const cotaFinal = arredondaCota(unicos[unicos.length - 1].cota);
  const n = Math.round((cotaFinal - cotaInicial) / PASSO_COTA) + 1;

  if (n > MAX_PONTOS) {
    throw new Error(
      `A amplitude de cotas (${(cotaFinal - cotaInicial).toFixed(2)} m) gera ${n} pontos de 1 cm, acima do limite de ${MAX_PONTOS}.`
    );
  }

  const areas = new Array(n);
  const volumes = new Array(n);
  let j = 0;

  for (let i = 0; i < n; i++) {
    const cota = cotaInicial + i * PASSO_COTA;
    while (j < unicos.length - 2 && unicos[j + 1].cota < cota) j++;
    const p0 = unicos[j];
    const p1 = unicos[j + 1];
    const span = p1.cota - p0.cota;
    const f = span === 0 ? 0 : (cota - p0.cota) / span;
    areas[i] = Number((p0.area + f * (p1.area - p0.area)).toFixed(6));
    volumes[i] = Number((p0.volume + f * (p1.volume - p0.volume)).toFixed(6));
  }

  return { cotaInicial, passo: PASSO_COTA, areas, volumes, pontos: n };
}

export function limitesCav(cav) {
  const ultimo = cav.volumes.length - 1;
  return {
    cotaMin: cav.cotaInicial,
    cotaMax: arredondaCota(cav.cotaInicial + ultimo * cav.passo),
    volumeMin: cav.volumes[0],
    volumeMax: cav.volumes[ultimo],
    pontos: cav.volumes.length,
  };
}

export function dentroDaCav(cav, cota) {
  const { cotaMin, cotaMax } = limitesCav(cav);
  return cota >= cotaMin - 1e-9 && cota <= cotaMax + 1e-9;
}

// Interpolação linear cota → volume (hm³). Fora da tabela, satura no extremo.
export function volumeDaCota(cav, cota) {
  const idx = (cota - cav.cotaInicial) / cav.passo;
  const ultimo = cav.volumes.length - 1;
  if (idx <= 0) return cav.volumes[0];
  if (idx >= ultimo) return cav.volumes[ultimo];
  const i = Math.floor(idx);
  const f = idx - i;
  return cav.volumes[i] + f * (cav.volumes[i + 1] - cav.volumes[i]);
}

// Interpolação linear cota → área (km²).
export function areaDaCota(cav, cota) {
  const idx = (cota - cav.cotaInicial) / cav.passo;
  const ultimo = cav.areas.length - 1;
  if (idx <= 0) return cav.areas[0];
  if (idx >= ultimo) return cav.areas[ultimo];
  const i = Math.floor(idx);
  const f = idx - i;
  return cav.areas[i] + f * (cav.areas[i + 1] - cav.areas[i]);
}

// Interpolação inversa volume → cota (m), por busca binária no vetor de volumes.
export function cotaDoVolume(cav, volume) {
  const vols = cav.volumes;
  const ultimo = vols.length - 1;
  if (volume <= vols[0]) return cav.cotaInicial;
  if (volume >= vols[ultimo]) return arredondaCota(cav.cotaInicial + ultimo * cav.passo);

  let lo = 0;
  let hi = ultimo;
  while (hi - lo > 1) {
    const meio = (lo + hi) >> 1;
    if (vols[meio] <= volume) lo = meio;
    else hi = meio;
  }
  const span = vols[hi] - vols[lo];
  const f = span === 0 ? 0 : (volume - vols[lo]) / span;
  return cav.cotaInicial + (lo + f) * cav.passo;
}

export function avisoTamanho(pontos) {
  return pontos > AVISO_PONTOS
    ? `Tabela grande (${pontos} pontos de 1 cm). O carregamento pode ficar lento.`
    : null;
}
