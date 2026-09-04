// Configuração do Firebase deste app.
// 1. Crie um projeto em https://console.firebase.google.com
// 2. Ative o Firestore Database (modo produção, com as regras de firestore.rules deste repo)
// 3. Em "Configurações do projeto" > "Seus apps" > Web, copie o objeto de config e cole abaixo.
// O firebaseConfig de apps web NÃO é secreto (fica visível no navegador) — a segurança
// vem das regras do Firestore (veja firestore.rules), não do sigilo destas chaves.
export const firebaseConfig = {
  apiKey: 'AIzaSyDjU-zKtgWZyw3wTWPOt967Hpx-AvlkCt0',
  authDomain: 'hidro-simulador.firebaseapp.com',
  projectId: 'hidro-simulador',
  storageBucket: 'hidro-simulador.firebasestorage.app',
  messagingSenderId: '445903392564',
  appId: '1:445903392564:web:3970663c68127dc3a71f61',
};
