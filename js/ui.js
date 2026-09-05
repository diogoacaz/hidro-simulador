// Helpers de interface compartilhados pelas telas.

export const $ = (seletor, raiz = document) => raiz.querySelector(seletor);
export const $$ = (seletor, raiz = document) => [...raiz.querySelectorAll(seletor)];

// Escapa texto vindo do usuário antes de interpolar em innerHTML.
export function esc(valor) {
  if (valor == null) return '';
  return String(valor)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function num(valor, casas = 2) {
  if (!Number.isFinite(valor)) return '—';
  return valor.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

export function valorNumerico(input) {
  const v = Number(input.value);
  return input.value.trim() === '' ? null : (Number.isFinite(v) ? v : null);
}

export function dataHoraLocal(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

// Valor para <input type="datetime-local"> a partir de um Date.
export function paraInputDateTime(data) {
  const d = new Date(data.getTime() - data.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

let timerToast = null;

export function toast(mensagem, tipo = 'info') {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.className = `toast toast-${tipo} visivel`;
  el.textContent = mensagem;
  clearTimeout(timerToast);
  timerToast = setTimeout(() => el.classList.remove('visivel'), 4500);
}

export function confirmar(mensagem) {
  return window.confirm(mensagem);
}

export function carregando(container, mensagem = 'Carregando…') {
  container.innerHTML = `<div class="carregando">${esc(mensagem)}</div>`;
}

export function erroNaTela(container, erro) {
  container.innerHTML = `<div class="painel"><p class="erro">${esc(erro.message || erro)}</p></div>`;
}

// Executa uma ação assíncrona desabilitando o botão e mostrando erro em toast.
export async function comBotao(botao, acao, textoOcupado = 'Aguarde…') {
  const original = botao.textContent;
  botao.disabled = true;
  botao.textContent = textoOcupado;
  try {
    await acao();
  } catch (err) {
    console.error(err);
    toast(err.message || 'Erro inesperado.', 'erro');
  } finally {
    botao.disabled = false;
    botao.textContent = original;
  }
}

export function badgeSeveridade(severidade) {
  if (!severidade) return '<span class="badge badge-ok">Sem violação</span>';
  const mapa = {
    critico: ['badge-critico', 'Violação emergencial'],
    restricao: ['badge-restricao', 'Violação de restrição'],
    atencao: ['badge-atencao', 'Fora da faixa operacional'],
  };
  const [classe, texto] = mapa[severidade] || ['badge-ok', 'Sem violação'];
  return `<span class="badge ${classe}">${texto}</span>`;
}
