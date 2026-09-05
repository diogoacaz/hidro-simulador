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
    // O último separador é o decimal.
    texto = texto.lastIndexOf(',') > texto.lastIndexOf('.')
      ? texto.replace(/\./g, '').replace(',', '.')
      : texto.replace(/,/g, '');
  } else if (temVirgula) {
    texto = texto.replace(',', '.');
  }
  return Number(texto);
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
export function textoParaMatriz(texto) {
  return texto
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter((linha) => linha.length)
    .map((linha) => linha.split(/\t|;|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.trim().replace(/^"|"$/g, '')));
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
  const texto = await file.text();
  return textoParaMatriz(texto);
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
