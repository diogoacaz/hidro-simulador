// Página Chatbot: a Assistente de Operação (chatbot/index.html), exportada do
// Neo Stitch, aberta como está dentro do app.
//
// Ela vem num iframe para ficar idêntica ao protótipo: o CSS e o 3D dela não
// se misturam com os do app, e o app não mexe no visual dela. Ao sair da
// página o iframe é removido, o que libera o contexto WebGL e para a animação.
// O tema acompanha o botão claro/escuro do app: a página lê a escolha ao abrir
// e recebe um aviso a cada troca.

import { temaEscuroAtivo, aoMudarTema } from '../tema.js';

let quadro = null;
let pararTema = null;

export async function render(container) {
  container.innerHTML = `
    <iframe class="chatbot-quadro" src="chatbot/index.html"
            title="Assistente de Operação: chatbot com a robô 3D"
            allow="fullscreen"></iframe>`;
  quadro = container.querySelector('iframe');
  pararTema = aoMudarTema(() => {
    quadro?.contentWindow?.postMessage({ tipo: 'tema', escuro: temaEscuroAtivo() }, location.origin);
  });
}

export function desmontar() {
  pararTema?.();
  pararTema = null;
  quadro?.remove();
  quadro = null;
}
