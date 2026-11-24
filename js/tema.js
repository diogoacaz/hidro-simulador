// Tema claro × escuro.
//
// Sem escolha do usuário o app segue o sistema. Ao clicar no botão a escolha
// fica gravada neste navegador e passa a valer sobre a do sistema. O atributo
// data-theme no <html> é aplicado já no <head> (index.html), antes do
// primeiro desenho, para não piscar o tema errado ao abrir.

const CHAVE = 'tema';
const raiz = document.documentElement;
// Referência forte: uma MediaQueryList sem dono pode ser coletada e parar
// de notificar.
const sistemaEscuro = matchMedia('(prefers-color-scheme: dark)');
const ouvintes = new Set();

export function temaEscuroAtivo() {
  const escolhido = raiz.dataset.theme;
  if (escolhido === 'dark') return true;
  if (escolhido === 'light') return false;
  return sistemaEscuro.matches;
}

/** Registra uma função chamada sempre que o tema efetivo muda. */
export function aoMudarTema(fn) {
  ouvintes.add(fn);
}

function avisar() {
  atualizarCorDaBarra();
  atualizarBotao();
  for (const fn of [...ouvintes]) fn();
}

// A cor da barra do navegador no celular acompanha o topo do app.
function atualizarCorDaBarra() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', temaEscuroAtivo() ? '#0a1a16' : '#14332d');
}

function atualizarBotao() {
  const botao = document.getElementById('btn-tema');
  if (!botao) return;
  const escuro = temaEscuroAtivo();
  const destino = escuro ? 'claro' : 'escuro';
  botao.setAttribute('aria-label', `Mudar para o tema ${destino}`);
  botao.title = `Tema ${destino}`;
  botao.dataset.escuro = escuro ? 'sim' : 'nao';
}

export function alternarTema() {
  const novo = temaEscuroAtivo() ? 'light' : 'dark';
  try { localStorage.setItem(CHAVE, novo); } catch { /* navegação privada */ }

  // Transição curta de cor só durante a troca; fora dela, nenhuma regra de
  // transição global atrapalha hover e foco.
  const reduzir = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduzir) {
    raiz.classList.add('trocando-tema');
    setTimeout(() => raiz.classList.remove('trocando-tema'), 350);
  }
  raiz.dataset.theme = novo;
  avisar();
}

export function iniciarTema() {
  const botao = document.getElementById('btn-tema');
  if (botao) botao.addEventListener('click', alternarTema);
  sistemaEscuro.addEventListener('change', () => {
    // Com escolha gravada o sistema não manda mais.
    if (!raiz.dataset.theme) avisar();
  });
  atualizarCorDaBarra();
  atualizarBotao();
}
