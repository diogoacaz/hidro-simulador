// Página Chatbot: atalhos à esquerda, o robô 3D no centro e o chat à direita.
//
// O assistente responde aqui mesmo, no navegador, a partir do que o app
// sabe fazer e dos dados do cadastro — sem serviço externo. As respostas
// vêm de RESPOSTAS, por palavras-chave; ligar um modelo de linguagem depois
// é trocar responder() por uma chamada a um servidor, sem mexer na tela.

import * as db from '../db.js';
import { $, esc, num } from '../ui.js';
import { temaEscuroAtivo, aoMudarTema, alternarTema } from '../tema.js';

const ATALHOS = [
  { id: 'cheia', titulo: 'Simular uma cheia', sub: 'Vertimento e manobra da comporta', icone: 'onda', pergunta: 'Como simulo uma cheia?' },
  { id: 'deplecionamento', titulo: 'Tempo de deplecionamento', sub: 'Quanto tempo até a cota alvo', icone: 'relogio', pergunta: 'Como calculo o tempo de deplecionamento?' },
  { id: 'reservatorios', titulo: 'Reservatórios', sub: 'Níveis e tabelas cadastrados', icone: 'barragem', pergunta: 'Quais reservatórios estão cadastrados?' },
  { id: 'cav', titulo: 'Importar tabela CAV', sub: 'Cota × área × volume', icone: 'tabela', pergunta: 'Como importo uma tabela CAV?' },
];

const ICONES = {
  onda: '<path d="M3 15c2.5 0 2.5-6 5-6s2.5 6 5 6 2.5-6 5-6 3 3 3 3" />',
  relogio: '<circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" />',
  barragem: '<path d="M4 19h16M6 19V8l12-3v14M10 11h4M10 15h4" />',
  tabela: '<rect x="4" y="5" width="16" height="14" rx="2" /><path d="M4 10h16M10 10v9" />',
};

// Remove acentos e caixa para casar palavras-chave.
const normalizar = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

let robo = null;
let pararTema = null;

export async function render(container) {
  container.innerHTML = `
    <section class="chatbot">
      <nav class="chatbot-atalhos" aria-label="Atalhos do assistente">
        ${ATALHOS.map((a) => `
          <button type="button" class="atalho" data-atalho="${a.id}">
            <span class="atalho-icone" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONES[a.icone]}</svg></span>
            <span class="atalho-texto"><strong>${esc(a.titulo)}</strong><small>${esc(a.sub)}</small></span>
          </button>`).join('')}
      </nav>

      <div class="chatbot-palco">
        <div class="palco-cabecalho">
          <span class="palco-status"><i></i> Assistente on-line</span>
        </div>
        <div class="palco-3d" id="palco-3d" role="img"
             aria-label="Robô assistente em 3D: armadura branca, traje verde e rosto sorridente aceso em lima."></div>
        <p class="palco-dica">Arraste para girar · clique duas vezes para acenar</p>
      </div>

      <section class="chatbot-chat" aria-label="Chat">
        <header class="chat-cabecalho">
          <div><h2>Chat</h2><p>Pergunte sobre o simulador</p></div>
        </header>
        <ol class="chat-mensagens" id="chat-mensagens" aria-live="polite"></ol>
        <form class="chat-entrada" id="chat-form" autocomplete="off">
          <input type="text" id="chat-texto" placeholder="Escreva sua pergunta…" aria-label="Sua mensagem" maxlength="500" />
          <button type="submit" class="primario chat-enviar" aria-label="Enviar">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" /></svg>
          </button>
        </form>
      </section>
    </section>`;

  const lista = $('#chat-mensagens', container);
  const form = $('#chat-form', container);
  const campo = $('#chat-texto', container);
  let ocupado = false;

  // --- Robô: carregado sob demanda, só nesta página ---
  const palco = $('#palco-3d', container);
  const corPalco = () => getComputedStyle(palco).getPropertyValue('--palco-fundo').trim() || (temaEscuroAtivo() ? '#14332d' : '#ffffff');
  try {
    if (!temWebGL()) throw new Error('sem WebGL');
    const { criarRobo } = await import('../robo3d.js');
    robo = criarRobo(palco, {
      corFundo: corPalco(),
      reduzirMovimento: matchMedia('(prefers-reduced-motion: reduce)').matches,
    });
    pararTema = aoMudarTema(() => robo && robo.atualizarTema(corPalco()));
  } catch (err) {
    console.warn('Robô 3D indisponível:', err);
    palco.classList.add('palco-sem-3d');
    palco.innerHTML = '<p>O robô 3D precisa de WebGL, que este navegador não oferece. O chat funciona normalmente.</p>';
  }

  // --- Mensagens ---
  const adicionar = (quem, html) => {
    const li = document.createElement('li');
    li.className = `msg msg-${quem}`;
    li.innerHTML = `<div class="msg-balao">${html}</div>`;
    lista.appendChild(li);
    lista.scrollTop = lista.scrollHeight;
    return li;
  };

  // Resposta do robô: indicador de digitação, depois o texto aparece aos
  // poucos enquanto ele "fala"; no fim vira o HTML com links e negrito.
  const responderComo = async (resposta) => {
    const li = adicionar('robo', '<span class="digitando"><i></i><i></i><i></i></span>');
    robo?.falar(true);
    await esperar(450 + Math.random() * 300);
    const balao = li.querySelector('.msg-balao');
    const plano = textoPlano(resposta.texto);
    const passo = Math.max(1, Math.ceil(plano.length / 90));
    for (let i = 0; i <= plano.length; i += passo) {
      balao.textContent = plano.slice(0, i);
      lista.scrollTop = lista.scrollHeight;
      await esperar(16);
    }
    balao.innerHTML = formatar(resposta.texto);
    lista.scrollTop = lista.scrollHeight;
    robo?.falar(false);
    if (resposta.acenar) robo?.acenar();
    if (resposta.acao) resposta.acao();
  };

  // `digitado`: o foco só volta ao campo quando a pergunta veio dele. Vindo
  // de um atalho, devolver o foco abria o teclado do celular a cada resposta.
  const enviar = async (texto, digitado = false) => {
    const limpo = texto.trim();
    if (!limpo || ocupado) return;
    ocupado = true;
    form.querySelector('button').disabled = true;
    adicionar('usuario', esc(limpo));
    try {
      await responderComo(await responder(limpo));
    } catch (err) {
      console.error(err);
      await responderComo({ texto: 'Tive um problema para responder agora. Tente de novo em instantes.' });
    } finally {
      ocupado = false;
      form.querySelector('button').disabled = false;
      if (digitado) campo.focus({ preventScroll: true });
    }
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const t = campo.value;
    campo.value = '';
    enviar(t, true);
  });

  container.querySelectorAll('[data-atalho]').forEach((b) => b.addEventListener('click', () => {
    const a = ATALHOS.find((x) => x.id === b.dataset.atalho);
    enviar(a.pergunta);
  }));

  // Boas-vindas: o robô acena ao chegar.
  setTimeout(() => robo?.acenar(), 700);
  await responderComo({
    texto: 'Olá! Sou o assistente do **Simulador Hidráulico**. Posso explicar como simular uma cheia, calcular o tempo de deplecionamento, consultar os reservatórios cadastrados ou importar uma tabela CAV. Use os atalhos ao lado ou escreva sua pergunta.',
  });
}

// O roteador chama isto ao sair da página: o laço de animação e a memória
// de vídeo do robô não podem ficar rodando nas outras telas.
export function desmontar() {
  if (robo) { robo.destruir(); robo = null; }
  if (pararTema) { pararTema(); pararTema = null; }
}

/* ------------------------------------------------------------------ *
 * Respostas
 * ------------------------------------------------------------------ */

const RESPOSTAS = [
  {
    chaves: ['oi', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'e ai', 'opa'],
    exato: true,
    responder: () => ({ texto: 'Olá! Em que posso ajudar? Experimente perguntar sobre **cheia**, **deplecionamento**, **reservatórios** ou **tabela CAV**.', acenar: true }),
  },
  {
    chaves: ['obrigad', 'valeu', 'agradec'],
    responder: () => ({ texto: 'Por nada! Se precisar de mais alguma coisa, é só chamar.', acenar: true }),
  },
  {
    chaves: ['cheia', 'vertimento', 'verter', 'comporta', 'amortec', 'vertedouro'],
    responder: () => ({
      texto: 'Na aba [Cheia](#/cheia) você informa a cheia de projeto (pico, subida e recessão) ou cola uma série medida de 15 em 15 min, o nível de partida e as bombas disponíveis. O simulador usa primeiro o bombeamento de Vigário, depois a reversão de Santa Cecília e só então a comporta, e entrega duas propostas: o **menor pico possível** e o **vertimento de último recurso**, que guarda a água até o nível máximo desejado e fecha a comporta para mantê-lo. Cada proposta vem com o cronograma de manobras e a tabela passo a passo, que você pode editar e simular de novo.',
    }),
  },
  {
    chaves: ['deplec', 'esvazi', 'tempo', 'quanto tempo', 'rebaix', 'simular'],
    responder: () => ({
      texto: 'Na aba [Simular](#/simular), o modo **Calcular tempo (deplecionamento)** já vem selecionado: informe o nível inicial, o nível alvo e as vazões afluente e defluente (constantes ou série de 15 em 15 min). O balanço hídrico corre de 15 em 15 minutos pela tabela cota × área × volume e a manchete diz o tempo e a hora em que o alvo é atingido. A mesma tela também calcula nível final, nível inicial ou a vazão necessária.',
    }),
  },
  {
    chaves: ['reservatorio', 'reservatorios', 'cadastr', 'nivel', 'niveis', 'limite'],
    responder: async () => {
      let lista = [];
      try { lista = await db.listarReservatorios(); } catch { /* sem conexão */ }
      if (!lista.length) return { texto: 'Não encontrei reservatórios cadastrados. Cadastre o primeiro na aba [Reservatórios](#/reservatorios).' };
      const linhas = lista.map((r) => {
        const faixa = Number.isFinite(r.nivelMinEmergencial) && Number.isFinite(r.nivelMaxEmergencial)
          ? `emergência ${num(r.nivelMinEmergencial)} a ${num(r.nivelMaxEmergencial)} m` : 'sem limites de emergência';
        const cav = r.cavResumo ? 'com tabela CAV' : 'sem tabela CAV';
        return `• **${r.nome}**${r.usinaNome ? ` (${r.usinaNome})` : ''}: ${faixa}, ${cav}`;
      });
      return { texto: `Há ${lista.length} reservatório${lista.length > 1 ? 's' : ''} cadastrado${lista.length > 1 ? 's' : ''}:\n${linhas.join('\n')}\n\nDetalhes e edição em [Reservatórios](#/reservatorios).` };
    },
  },
  {
    chaves: ['cav', 'cota area', 'cota-area', 'area volume', 'importar', 'tabela'],
    responder: () => ({
      texto: 'Abra o reservatório em [Reservatórios](#/reservatorios) e, na seção da tabela CAV, envie uma planilha (CSV ou Excel) ou cole os dados com **três colunas, nesta ordem: cota (m), área (km²) e volume (hm³)**. O app interpola de 1 em 1 cm e confere as unidades pela física — se o volume estiver em m³ ou a área em hectares, ele recusa e diz como corrigir.',
    }),
  },
  {
    chaves: ['registro', 'medicao', 'medicoes', 'historico'],
    responder: () => ({ texto: 'Os registros operacionais (cota e vazões medidas) ficam em [Registros](#/registros), e as simulações salvas, em [Histórico](#/historico).' }),
  },
  {
    chaves: ['tema', 'escuro', 'claro', 'modo noturno'],
    responder: () => ({ texto: 'Pronto, troquei o tema para você. O botão com sol/lua no canto do topo faz o mesmo a qualquer momento.', acao: () => alternarTema() }),
  },
  {
    chaves: ['offline', 'internet', 'sem rede', 'sem conexao'],
    responder: () => ({ texto: 'O app funciona sem internet: depois de aberto uma vez, as telas e os cálculos ficam guardados no navegador, e os cadastros também. O que você salvar sem rede é enviado quando a conexão voltar.' }),
  },
  {
    chaves: ['ajuda', 'o que voce faz', 'quem e voce', 'como funciona', 'pode fazer'],
    responder: () => ({
      texto: 'Sou o assistente do simulador. Sei explicar:\n• a simulação de **cheia** e a manobra da comporta;\n• o **tempo de deplecionamento** e os outros cálculos da aba Simular;\n• os **reservatórios** cadastrados e seus limites;\n• a importação da **tabela CAV**.\nTambém troco o **tema** claro/escuro se você pedir.',
    }),
  },
];

async function responder(texto) {
  const t = normalizar(texto);
  const palavras = t.replace(/[^\w\s-]/g, ' ').split(/\s+/).filter(Boolean);
  for (const r of RESPOSTAS) {
    const casa = r.chaves.some((c) => (r.exato
      ? palavras.join(' ') === c || palavras[0] === c
      : t.includes(c)));
    if (casa) return r.responder();
  }
  return {
    texto: 'Ainda não sei responder isso. Por enquanto entendo perguntas sobre **cheia**, **deplecionamento**, **reservatórios**, **tabela CAV**, **registros** e **tema**. Pode reformular?',
  };
}

/* ------------------------------------------------------------------ *
 * Utilidades
 * ------------------------------------------------------------------ */

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Marcação mínima das respostas: **negrito**, [texto](#/rota) e quebras.
function formatar(texto) {
  return esc(texto)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[(.+?)\]\((#\/[\w-]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\n/g, '<br>');
}

function textoPlano(texto) {
  return texto.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\[(.+?)\]\((#\/[\w-]+)\)/g, '$1');
}

function temWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2'))
      || !!(window.WebGLRenderingContext && c.getContext('webgl'));
  } catch {
    return false;
  }
}
