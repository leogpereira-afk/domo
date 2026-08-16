// Configuração do app da Domo Construtora — versão SUPABASE.
//
// Este arquivo vira o config.js na virada (Fase 5). Enquanto o site do Netlify
// estiver no ar, o config.js continua apontando para lá — os dois convivem, e
// só um deles é o que a equipe usa.
//
// TOKEN — a MESMA string precisa estar aqui e no segredo TOKEN do Supabase
// (Edge Functions → Secrets). Ele viaja no navegador, então é autenticação
// LEVE: barra robô e curioso, não ataque dirigido. Quem protege os dados de
// verdade é a SENHA, conferida no servidor.
const TOKEN = '7eaad94c34590145c245e67c2be93b25dc6ab80987223b1d';

// Endpoints das Edge Functions. PREENCHER o project ref na virada.
const SUPABASE_URL = 'https://reoghclxripktzpdwhiy.supabase.co';
const API = SUPABASE_URL + '/functions/v1/domo-nucleo';
const API_ARQ = SUPABASE_URL + '/functions/v1/domo-acervo';

// Versão exibida no rodapé (subir junto com o CACHE do sw.js a cada deploy).
const VERSAO = 'v44';
