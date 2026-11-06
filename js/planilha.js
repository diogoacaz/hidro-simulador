// Leitura e escrita de planilhas: CSV, XLSX (SheetJS) e colagem de área de transferência.

// Converte "1.234,56" (pt-BR) ou "1234.56" em número.
export function paraNumero(valor) {
  if (typeof valor === 'number') return valor;
  if (valor == null) return NaN;
  let texto = String(valor).trim().replace(/\s/g, '');
  if (!texto) return NaN;
  const temVirgula = texto.includes(',');
  const temPonto = texto.includes('.');
  if (temVirgula && temPonto) {
    // O último separador é o decimal; o outro só pode ser de milhar, e milhar
    // vem em grupos de três. Sem essa conferência "2,27.0" virava 227 — a
    // vírgula era removida como se fosse milhar, multiplicando por cem.
    const virgulaDepois = texto.lastIndexOf(',') > texto.lastIndexOf('.');
    const milhar = virgulaDepois ? '.' : ',';
    if (!agrupaMilhar(texto, milhar)) return NaN;
    texto = virgulaDepois
      ? texto.replace(/\./g, '').replace(',', '.')
      : texto.replace(/,/g, '');
  } else if (temVirgula) {
    texto = texto.replace(',', '.');
  }
  return Number(texto);
}

// Confere se o separador aparece só em posição de milhar: 1.234, 1.234.567.
function agrupaMilhar(texto, separador) {
  const esc = separador === '.' ? '\\.' : ',';
  return new RegExp(`^[+-]?\\d{1,3}(?:${esc}\\d{3})+(?:[.,]\\d+)?$`).test(texto);
}

/**
 * Extrai uma série numérica de uma matriz de planilha.
 *
 * A coluna é escolhida UMA vez para o arquivo inteiro — a última que é
 * numérica na maioria das linhas. Antes a escolha era feita linha a linha
 * ("a última célula numérica desta linha"), o que deixava qualquer coluna à
 * direita sequestrar a leitura e podia até trocar de coluna no meio do
 * arquivo, sem nada na tela denunciando.
 *
 * @returns {{valores:number[], coluna:string|null, descartadas:number}}
 */
export function extrairSerie(matriz) {
  if (!matriz.length) return { valores: [], coluna: null, descartadas: 0 };

  const temCabecalho = !matriz[0].some((c) => Number.isFinite(paraNumero(c)));
  const cabecalho = temCabecalho ? matriz[0] : [];
  const linhas = temCabecalho ? matriz.slice(1) : matriz;
  if (!linhas.length) return { valores: [], coluna: null, descartadas: 0 };

  const largura = Math.max(...linhas.map((l) => l.length));
  const minimo = Math.max(1, Math.ceil(linhas.length * 0.8));
  let indice = -1;
  for (let c = largura - 1; c >= 0; c--) {
    const validas = linhas.reduce((n, l) => n + (Number.isFinite(paraNumero(l[c])) ? 1 : 0), 0);
    if (validas >= minimo) { indice = c; break; }
  }
  if (indice < 0) return { valores: [], coluna: null, descartadas: linhas.length };

  const brutos = linhas.map((l) => paraNumero(l[indice]));
  const valores = brutos.filter(Number.isFinite);
  return {
    valores,
    coluna: String(cabecalho[indice] ?? '').trim() || `coluna ${indice + 1}`,
    descartadas: brutos.length - valores.length,
  };
}

// Converte data/hora de planilha em string local "AAAA-MM-DDTHH:mm".
// Aceita serial do Excel, dd/mm/aaaa [hh:mm] e aaaa-mm-dd [hh:mm].
export function paraDataHora(valor) {
  if (valor == null || valor === '') return null;

  const texto = String(valor).trim();

  // Serial do Excel: dias desde 1899-12-30.
  const serial = Number(texto.replace(',', '.'));
  if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
    return formatarLocal(new Date(Date.UTC(1899, 11, 30) + serial * 86400000));
  }

  const brasileiro = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (brasileiro) {
    const [, d, m, a, h = '0', min = '0'] = brasileiro;
    return formatarLocal(new Date(+a, +m - 1, +d, +h, +min));
  }

  const iso = texto.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (iso) {
    const [, a, m, d, h = '0', min = '0'] = iso;
    return formatarLocal(new Date(+a, +m - 1, +d, +h, +min));
  }

  const data = new Date(texto);
  return Number.isNaN(data.getTime()) ? null : formatarLocal(data);
}

function formatarLocal(data) {
  const p = (n) => String(n).padStart(2, '0');
  return `${data.getFullYear()}-${p(data.getMonth() + 1)}-${p(data.getDate())}T${p(data.getHours())}:${p(data.getMinutes())}`;
}

// Divide texto colado (CSV, TSV ou colunas de planilha) em matriz de células.
// A tabulação e o ponto-e-vírgula têm prioridade sobre a vírgula: em pt-BR a
// vírgula costuma ser o separador decimal ("403,00"), e usá-la como separador
// de colunas quebraria cada número em duas células.
export function textoParaMatriz(texto) {
  const linhas = texto
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter((linha) => linha.length);
  if (!linhas.length) return [];

  const amostra = linhas.slice(0, 5);
  const texto5 = amostra.join('\n');

  if (texto5.includes('\t')) return dividir(linhas, /\t/);
  if (texto5.includes(';')) return dividir(linhas, /;/);
  // Coluna única com decimal em vírgula: dividir por vírgula partiria o
  // número ao meio e a parte decimal viraria o valor.
  if (virgulaEhDecimal(amostra)) return linhas.map((l) => [limpar(l)]);
  return dividir(linhas, /,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
}

const limpar = (c) => String(c ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().replace(/^"|"$/g, '');
const dividir = (linhas, sep) => linhas.map((l) => l.split(sep).map(limpar));

// Sem tabulação nem ponto-e-vírgula, a vírgula é ambígua: separa valores em
// "10,20,30" e é decimal em "12,5". A decisão é pelo conjunto — se toda linha
// que tem vírgula é um número válido lendo-a como decimal, então ela é
// decimal e o arquivo tem uma coluna só. Um cabeçalho como "data,vazao" ou
// uma linha "01/01,12,5" reprovam o teste e a vírgula volta a separar.
function virgulaEhDecimal(amostra) {
  const comVirgula = amostra.filter((l) => l.includes(','));
  return comVirgula.length > 0 && comVirgula.every((l) => Number.isFinite(paraNumero(limpar(l))));
}

/**
 * Lê uma lista de números de texto livre (colado ou vindo de arquivo).
 * Separa por espaço, quebra de linha e ponto-e-vírgula — nunca por vírgula,
 * que em pt-BR é decimal. Só se um item não for número sozinho é que a
 * vírgula dentro dele passa a separar valores ("10,20,30").
 */
export function lerListaNumeros(texto) {
  return String(texto ?? '')
    .split(/[\s;]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .flatMap((t) => (Number.isFinite(paraNumero(t)) ? [paraNumero(t)] : t.split(',').map(paraNumero)))
    .filter(Number.isFinite);
}

// Descarta a primeira linha se ela parecer um cabeçalho (nenhuma célula numérica).
export function removerCabecalho(matriz) {
  if (!matriz.length) return matriz;
  const primeira = matriz[0];
  const temNumero = primeira.some((c) => Number.isFinite(paraNumero(c)));
  return temNumero ? matriz : matriz.slice(1);
}

export async function lerArquivo(file) {
  const nome = file.name.toLowerCase();
  if (nome.endsWith('.xlsx') || nome.endsWith('.xls')) return lerXlsx(file);
  return textoParaMatriz(decodificar(await file.arrayBuffer()));
}

/**
 * Decide a codificação do arquivo em vez de assumir UTF-8.
 *
 * Exportação do Excel no Windows sai em UTF-16 ("Texto Unicode") ou em
 * ANSI/CP1252 com a mesma frequência que em UTF-8. Lendo tudo como UTF-8, o
 * UTF-16 falhava inteiro — cada caractere vinha seguido de um byte zero e
 * nenhuma coluna era reconhecida como numérica — e o ANSI perdia os acentos.
 */
function decodificar(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xFF && bytes[1] === 0xFE) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xFE && bytes[1] === 0xFF) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return new TextDecoder('utf-8').decode(bytes.subarray(3));

  // UTF-16 sem BOM: texto quase todo ASCII intercala um byte zero.
  const amostra = bytes.subarray(0, 400);
  const zeros = amostra.reduce((n, b) => n + (b === 0 ? 1 : 0), 0);
  if (amostra.length > 8 && zeros > amostra.length * 0.25) {
    return new TextDecoder(bytes[0] === 0 ? 'utf-16be' : 'utf-16le').decode(bytes);
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Bytes que não formam UTF-8 válido: quase sempre ANSI do Windows.
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

async function lerXlsx(file) {
  if (typeof XLSX === 'undefined') {
    throw new Error('Biblioteca de leitura de Excel não carregada. Verifique sua conexão ou converta o arquivo para CSV.');
  }
  const buffer = await file.arrayBuffer();
  const planilha = XLSX.read(buffer, { type: 'array' });
  const primeiraAba = planilha.Sheets[planilha.SheetNames[0]];
  const linhas = XLSX.utils.sheet_to_json(primeiraAba, { header: 1, raw: true, defval: '' });
  return linhas
    .map((linha) => linha.map((c) => (c === '' ? '' : String(c))))
    .filter((linha) => linha.some((c) => String(c).trim() !== ''));
}

// --- Exportação ---

export function baixarCsv(nomeArquivo, cabecalho, linhas) {
  const conteudo = [cabecalho, ...linhas]
    .map((linha) => linha.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';'))
    .join('\r\n');
  // BOM para o Excel reconhecer UTF-8 corretamente.
  baixarBlob(new Blob(['﻿' + conteudo], { type: 'text/csv;charset=utf-8;' }), nomeArquivo);
}

export function baixarBlob(blob, nomeArquivo) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nomeArquivo;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function baixarCanvas(canvas, nomeArquivo) {
  canvas.toBlob((blob) => baixarBlob(blob, nomeArquivo), 'image/png');
}
