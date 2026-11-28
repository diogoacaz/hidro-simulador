# Assistente de Operação · usinas hidrelétricas (Light Energia)

Protótipo de interface de um chatbot para os operadores das usinas hidrelétricas: dúvidas sobre como operar as usinas,
procedimentos de operação, alarmes e segurança. A tela tem uma assistente robô em 3D no centro, 4 cards de tema à
esquerda e o chat à direita.

Exportado do Neo Stitch (projeto `chatbot-dashboard`, versão `BOT-008/v1.2`).

## Arquivos

```
index.html               a página: layout, cards, chat e roteiro de respostas
assets/robo3d.js         a robô 3D em Three.js (cabeça segue o cursor, respiração, brilho, fundo, anel)
assets/avatar.jpg        a robô de frente (avatar do chat)
assets/models/robo.glb   o modelo 3D da robô (Tripo H3.1, comprimido: ~2 MB)
```

## Como rodar

A página usa módulos JavaScript e carrega o modelo 3D por `fetch`, então **precisa de um servidor HTTP**; abrir o
arquivo com dois cliques (`file://`) não funciona. Na raiz do Simulador Hidráulico:

```bash
python3 -m http.server 8000
```

e abra http://localhost:8000/#/chatbot (ou http://localhost:8000/chatbot/ para a página sozinha).

## Dependências (no Simulador Hidráulico)

Nada vem da internet: tudo é servido pelo próprio app e funciona na rede interna e, depois da primeira visita, sem conexão.

- **Three.js 0.170.0** em `../vendor/three/` (pelo `importmap` do `index.html`): `three` e os addons GLTFLoader,
  DRACOLoader, RoomEnvironment, EffectComposer, RenderPass, UnrealBloomPass e OutputPass.
- **Decodificador Draco** do Three.js 0.170.0 em `../vendor/three/addons/libs/draco/gltf/` (o modelo vem em Draco).
- **Fonte Inter** em `../fontes/`.

No app, a página abre na rota `#/chatbot` (`js/views/chatbot.js`), dentro de um iframe que ocupa a área abaixo da barra
superior. Em telas estreitas ou em pé (celular, tablet na vertical), os blocos empilham: a robô no alto, os cards em
grade 2 × 2 e o chat embaixo.

## O modelo 3D comprimido

O GLB original tinha 66 MB (1 milhão de vértices, texturas 4K). Ele foi otimizado com o
[glTF-Transform](https://gltf-transform.dev) 4.5.1:

```bash
npx @gltf-transform/cli@4 optimize original.glb robo.glb --compress draco --texture-compress webp \
  --texture-size 2048 --simplify-ratio 0.2 --simplify-error 0.0005 --instance false --join false --palette false --flatten false
```

Ficou com 218 mil vértices, geometria em Draco e texturas WebP de 2048 px: **2 MB**, visualmente igual na tela. As
coordenadas da malha não mudaram, então a calibração do pescoço no shader continua valendo.

## Como funciona

- **Layout:** uma tela 16:9 centralizada (`.tela`), com medidas em `cqw` (1% da largura dela), então tudo escala com a
  janela. O canvas 3D ocupa a janela inteira, atrás.
- **A robô** (`criarRobo(container, { modelo, enquadre, grade })` em `assets/robo3d.js`) devolve uma API:
  - `olhar(x, y)`: a cabeça olha para um ponto (−1 a 1 em cada eixo); a página liga isso ao cursor;
  - `fixar(x, y, ms)`: olha para um ponto por um tempo (ex.: para o chat enquanto responde);
  - `falar(true|false)`: modo fala (a cabeça acena, o brilho pulsa);
  - `pulsar()`: um pulso de luz.

  O modelo não tem esqueleto: o giro da cabeça é feito no vertex shader, só acima do pescoço. Os pontos de ajuste
  (`uPivot`, `uY0`, `uY1`) valem para este GLB; outro modelo precisa de outros valores.
- **Chat:** `responder(html)` mostra os pontinhos de "pensando" e digita a resposta palavra por palavra. As respostas vêm
  de `RESPOSTAS` (pares expressão regular → HTML), e cada card tem um texto de abertura e sugestões em `ACOES`.

## Para ligar a uma IA de verdade

Troque a função `resposta(txt)` por uma chamada ao seu backend e passe o resultado para `responder(html)`. A robô já
reage sozinha: olha para o chat e fala enquanto o texto aparece.

## Atenção

As respostas atuais são **orientações genéricas, escritas para a demonstração**: não são os POPs reais das usinas. Antes
de qualquer uso com operadores, o chat precisa responder a partir dos documentos oficiais (POPs, manuais, regras
operativas, PAE), com revisão da equipe de operação. O aviso no rodapé do chat diz isso ao usuário.
