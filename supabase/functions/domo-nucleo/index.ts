// ============================================================================
// Supabase Edge Function "nucleo" — backend do sistema da Domo Construtora.
// Porte de netlify/functions/nucleo.mjs: MESMO contrato de ações (o cliente em
// store.js não muda), agora sobre Postgres em vez de Netlify Blobs.
//
// Duas camadas de autenticação, iguais às de sempre:
//   1. TOKEN (header x-token) — barra robô/curioso. Viaja no navegador, é leve.
//   2. SENHA (header x-senha = sha256 da senha digitada) — conferida aqui no
//      servidor contra cfg.senhaHash ou contra o acesso próprio da pessoa.
// Ações públicas (só exigem o TOKEN) são as telas que a obra e o fornecedor
// abrem sem senha nenhuma. Nelas nunca sai preço, valor de ordem nem telefone
// de terceiro.
//
// verify_jwt = false no config.toml: o preflight CORS do navegador chega sem
// token e o gateway barraria antes de o código rodar. A autorização é feita
// AQUI DENTRO, como sempre foi.
// ============================================================================
import { json, preflight } from "../_shared/cors.ts";
import { COLECOES } from "../_shared/colecoes.ts";
import {
  PERFIS, identificar, cfgSemSegredo, podeFazer, motivoRecusa,
  filtrarLeitura, hashGuardado, perfilDe, sha256, type Quem,
} from "../_shared/acesso.ts";
import {
  db, agora, idNovo, tokenCurto, lerUm, gravarUm, lerTudo, apagarDeVez,
  lerCfgBruta, gravarCfg, proximoNumero, guardarIndiceNumero, lerNumeracao,
  definirNumeracao, registrarLog, lerLog, gravarBackup, apagarArquivo,
  marcarMudanca,
} from "../_shared/dados.ts";

const NOMES_COLECOES = Object.keys(COLECOES);

// ── Configuração padrão ─────────────────────────────────────────────────────
const CFG_PADRAO = {
  empresa: {
    nome: "DOMO INCORPORADORA E CONSTRUTORA LTDA",
    nomeCurto: "Domo Construtora",
    cnpj: "", ie: "", endereco: "", telefone: "", email: "",
  },
  obras: [{ id: "diamond", nome: "Edifício Diamond", endereco: "", ativa: true }],
  setores: ["Fundação", "Estrutura", "Alvenaria", "Instalações elétricas", "Instalações hidráulicas",
    "Revestimento", "Esquadrias", "Pintura", "Cobertura", "Administrativo", "Ferramentas/EPI", "Outros"],
  unidades: ["un", "pç", "m", "m²", "m³", "kg", "sc", "L", "cx", "rolo", "barra", "vb"],
  disciplinas: ["Arquitetônico", "Estrutural", "Elétrico", "Hidrossanitário", "Incêndio", "Climatização",
    "Gás", "Impermeabilização", "Terraplanagem", "Executivo", "As built", "Outros"],
  tiposDoc: ["CNPJ", "Contrato Social", "Alvará", "CND Federal", "CND Estadual", "CND Municipal",
    "CND FGTS", "CND Trabalhista", "ART/RRT", "Licença Ambiental", "Seguro", "Habite-se",
    "Matrícula", "Certificado Digital", "Outros"],
  assinaturas: {
    diretor: { nome: "ALESSANDRO GONÇALVES", cargo: "Diretor de Engenharia", crea: "CREA-MG 150.950/D" },
    engenheiro: { nome: "", cargo: "Engenheiro Civil", crea: "" },
  },
  clausulasOC: [
    "Esta Ordem de Compra tem força de contrato de aquisição, sendo regida pela legislação civil e comercial vigente.",
    "O fornecedor deverá emitir Nota Fiscal correspondente ao valor integral desta OC, com os dados fiscais do contratante.",
    "A entrega fora do prazo estabelecido sujeitará o fornecedor a multa de 0,5% ao dia sobre o valor dos materiais não entregues.",
    "Materiais entregues em desacordo com as especificações serão rejeitados e devolvidos às custas do fornecedor.",
    "O pagamento será liberado após recebimento, conferência e aceite formal dos materiais pelo Engenheiro da Obra.",
    "A presente OC somente produz efeitos após assinatura de ambas as partes e é válida pelo prazo indicado no campo Validade da Proposta.",
  ],
  senhaHash: null,
  usuarios: [] as any[],
  atualizadoEm: null,
};

async function lerCfg(): Promise<any> {
  const salvo = await lerCfgBruta();
  return { ...CFG_PADRAO, ...(salvo || {}) };
}

/* ── União de listas de dois donos ─────────────────────────────────────────── */
// Listas em que os dois lados TÊM RAZÃO ao mesmo tempo: em vez de o último a
// gravar apagar o do outro, o servidor junta item a item pelo id.
// 'etapas'/'responsaveis' entraram depois da fusão do cronograma: como todos os
// fornecedores da obra passaram a morar num registro só, o celular do
// almoxarife subindo uma cópia velha apagava as confirmações que o concreteiro
// tinha acabado de mandar pelo link.
const CAMPOS_UNIAO = ["historico", "recebimentos", "cotacoes", "anexos", "medicoes", "versoes",
  "diario", "documentos", "equipe", "avaliacoes", "aditivos", "adiantamentos",
  "etapas", "responsaveis", "fornecedores"];

// Dentro de cada item unido, estas listas também se juntam em vez de se
// sobrepor (as remessas e as entregas moram DENTRO da etapa; os preços moram
// DENTRO do fornecedor convidado).
const SUBLISTAS_UNIAO = ["remessas", "entregas", "itens_recebidos"];
const SUBOBJETOS_UNIAO = ["precos"];

function unirPorId(antigo: any, novo: any): any[] {
  const a = Array.isArray(antigo) ? antigo : [];
  const b = Array.isArray(novo) ? novo : [];
  const vistos = new Map<string, any>();
  for (const it of a.concat(b)) {
    if (!it) continue;
    const k = it.id || (it.em || "") + "|" + (it.o_que || it.texto || "");
    const anterior = vistos.get(k) || {};
    const unido: any = { ...anterior, ...it };
    for (const sub of SUBLISTAS_UNIAO) {
      if (Array.isArray(anterior[sub]) || Array.isArray(it[sub])) unido[sub] = unirPorId(anterior[sub], it[sub]);
    }
    for (const sub of SUBOBJETOS_UNIAO) {
      if (anterior[sub] || it[sub]) unido[sub] = { ...(anterior[sub] || {}), ...(it[sub] || {}) };
    }
    vistos.set(k, unido);
  }
  return Array.from(vistos.values());
}

// Todos os arquivos que pertencem a este registro: projeto/documento (com as
// revisões antigas) e as fotos de recebimento e do diário.
function arquivosDoRegistro(o: any): string[] {
  const ids: string[] = [];
  if (o.arquivoId) ids.push(o.arquivoId);
  for (const v of (o.versoes || [])) if (v && v.arquivoId) ids.push(v.arquivoId);
  for (const r of (o.recebimentos || [])) for (const f of (r.fotos || [])) if (f) ids.push(f);
  for (const d of (o.diario || [])) for (const f of (d.fotos || [])) if (f) ids.push(f);
  for (const d of (o.documentos || [])) if (d && d.arquivoId) ids.push(d.arquivoId);
  return Array.from(new Set(ids));
}

/* ── Gravação: onde mora a inteligência do sistema ─────────────────────────── */
async function gravar(col: string, registro: any, por: string): Promise<any> {
  if (!COLECOES[col]) throw new Error("Coleção desconhecida: " + col);
  const id = registro.id || idNovo();
  const antigo = await lerUm(col, id);
  const novo: any = { ...(antigo || {}), ...registro, id };

  for (const campo of CAMPOS_UNIAO) {
    if (antigo && (antigo[campo] || registro[campo])) novo[campo] = unirPorId(antigo[campo], registro[campo]);
  }

  // A situação de uma ordem de compra é DECIDIDA AQUI, depois de juntar os
  // recebimentos dos dois aparelhos. Cada celular só enxerga os recebimentos
  // que ele mesmo conhece: se o almoxarife registra 40 e o engenheiro 80 de um
  // pedido de 120, nenhum dos dois via "entregue" — a conta é do servidor.
  //
  // A situação que MANDA é a guardada, não a que veio do navegador: um modal de
  // recebimento aberto há dez minutos trazia o retrato velho e ressuscitava uma
  // compra que o escritório tinha acabado de cancelar.
  const situacaoValida = (antigo && antigo.situacao) || novo.situacao;
  if (antigo && antigo.situacao === "cancelada") novo.situacao = "cancelada";
  if (col === "oc" && Array.isArray(novo.recebimentos) && novo.recebimentos.length &&
      !["cancelada", "rascunho"].includes(situacaoValida)) {
    const recebidoDoItem = (itemId: string) => novo.recebimentos.reduce((s: number, r: any) => {
      const achado = (r.itens || []).find((i: any) => i.itemId === itemId);
      return s + ((achado && Number(achado.qtd)) || 0);
    }, 0);
    const completo = (novo.itens || []).length > 0 &&
      (novo.itens || []).every((i: any) => recebidoDoItem(i.id) + 0.001 >= (Number(i.qtd) || 0));
    // 'entregue' manual (encerrar mesmo com falta) não é rebaixado para parcial.
    if (completo) novo.situacao = "entregue";
    else if (novo.situacao !== "entregue") novo.situacao = "parcial";

    // Quem decidiu que chegou tudo foi o servidor — então é ele que fecha as
    // solicitações ligadas. O navegador sozinho não enxerga os recebimentos do
    // outro aparelho e deixaria a solicitação presa em "em compra".
    if (novo.situacao === "entregue" && (!antigo || antigo.situacao !== "entregue")) {
      for (const sid of (novo.scIds || [])) {
        try {
          const sc = await lerUm("sc", sid);
          if (!sc || sc.situacao === "atendida" || sc.apagadoEm) continue;
          // Só fecha quando TODAS as ordens daquela solicitação chegaram. Um
          // pedido dividido em duas compras virava "atendida" na primeira
          // entrega e o resto do material sumia do radar de todo mundo.
          let faltaAlguma = false;
          for (const oid of (sc.ocIds || [])) {
            if (oid === id) continue;
            const outra = await lerUm("oc", oid);
            if (!outra || outra.apagadoEm || outra.situacao === "cancelada") continue;
            if (outra.situacao !== "entregue") { faltaAlguma = true; break; }
          }
          if (faltaAlguma) continue;
          sc.situacao = "atendida";
          sc.historico = unirPorId(sc.historico, [{
            id: idNovo(), em: agora(), por: por || "—",
            o_que: "Material recebido na obra (" + (novo.codigo || "") + ")",
          }]);
          sc.atualizadoEm = agora();
          await gravarUm("sc", sid, sc);
        } catch { /* fechar a solicitação não pode derrubar a gravação da ordem */ }
      }
    }
  }

  if (!novo.criadoEm) { novo.criadoEm = agora(); novo.criadoPor = por || registro.criadoPor || "—"; }
  novo.atualizadoEm = agora();
  novo.atualizadoPor = por || novo.atualizadoPor || "—";

  const pre = COLECOES[col].pre;
  if (pre && !novo.numero) {
    novo.numero = await proximoNumero(col);
    novo.codigo = pre + "-" + String(novo.numero).padStart(4, "0");
    try { await guardarIndiceNumero(col, novo.numero, id); } catch { /* índice é atalho */ }
  }
  if (pre && !novo.codigo && novo.numero) novo.codigo = pre + "-" + String(novo.numero).padStart(4, "0");
  if ((col === "oc" || col === "os") && !novo.tokenPublico) novo.tokenPublico = tokenCurto();

  // Cada fornecedor convidado ganha um endereço próprio para responder — é o
  // link que vai no WhatsApp. Um token por convite: um fornecedor nunca vê a
  // resposta do outro.
  if (col === "cot") {
    novo.fornecedores = (novo.fornecedores || []).map((f: any) =>
      f && !f.token ? { ...f, token: tokenCurto() } : f);
  }
  // No cronograma o link é POR RESPONSÁVEL: um só endereço mostra todas as
  // etapas daquele fornecedor, e ele confirma data por data.
  if (col === "crono") {
    novo.responsaveis = (novo.responsaveis || []).map((r: any) =>
      r && !r.token ? { ...r, token: tokenCurto() } : r);
  }

  await gravarUm(col, id, novo);
  await marcarMudanca(col);
  novo._col = col;
  return novo;
}

/* ── Limpeza do que vem de fora (solicitação pública) ──────────────────────── */
const txt = (v: unknown, max?: number) => String(v == null ? "" : v).slice(0, max || 200).trim();
const num = (v: unknown) => { const n = parseFloat(String(v).replace(",", ".")); return isFinite(n) ? n : 0; };

function limparSolicitacao(r: any) {
  const itens = (Array.isArray(r.itens) ? r.itens : []).slice(0, 40).map((it: any, i: number) => ({
    id: it.id || idNovo(), n: i + 1,
    descricao: txt(it.descricao, 300),
    unid: txt(it.unid, 10),
    qtd: num(it.qtd),
    obs: txt(it.obs, 200),
  })).filter((it: any) => it.descricao);
  return {
    obraId: txt(r.obraId, 40) || "diamond",
    obra: txt(r.obra, 120),
    solicitante: {
      nome: txt(r.solicitante && r.solicitante.nome, 80),
      telefone: txt(r.solicitante && r.solicitante.telefone, 30),
      funcao: txt(r.solicitante && r.solicitante.funcao, 60),
    },
    setor: txt(r.setor, 60),
    urgencia: ["normal", "urgente", "critica"].includes(r.urgencia) ? r.urgencia : "normal",
    necessidadeEm: txt(r.necessidadeEm, 10),
    justificativa: txt(r.justificativa, 800),
    itens,
    situacao: "nova",
    origem: "link público",
  };
}

/* ── Compromisso: carimba o dono e barra mexer no que é de outro ─────────────
   O dono é decidido AQUI, não pelo corpo do pedido:
   - a direção pode criar/atribuir para qualquer pessoa cadastrada;
   - quem não é da direção só edita o que é seu, mas PODE encaminhar (passar o
     compromisso para outra pessoa) — aí ele sai da lista dela no próximo sync.
   O nome do dono é resolvido do cadastro (cfg.usuarios), não do que veio. */
function nomeDoDono(cfg: any, dono: string, fallback = ""): string {
  if (dono === "equipe") return "Direção";
  const u = (cfg.usuarios || []).find((x: any) => x.id === dono);
  return (u && u.nome) || fallback || "";
}

function prepararComp(quem: Quem | null, cfg: any, registro: any, atual: any): { erro?: string; registro?: any } {
  if (!quem) return { erro: "não autorizado" };
  const ehDir = perfilDe(quem) === "direcao";
  const meuId = quem.id;
  // Nome real de quem está agindo. É o que carimba a autoria no fio da conversa
  // — o corpo do pedido não escolhe "por quem".
  const euNome = (quem.proprio && quem.nome) || "Direção";

  // Quem NÃO é da direção só mexe no que já é seu (ou cria novo).
  if (!ehDir && atual && atual.dono && atual.dono !== meuId) {
    return { erro: "este compromisso não é seu" };
  }

  // Dono desejado: o que veio no corpo, senão o dono atual, senão eu mesmo.
  // Quem NÃO é da direção não CRIA compromisso já na agenda de outro — só na
  // própria. (Encaminhar depois é permitido; nascer no colo de alguém, não.)
  const dono = (!ehDir && !atual) ? meuId : (txt(registro.dono, 40) || (atual && atual.dono) || meuId);

  // Estes campos são carimbados PELO SERVIDOR, nunca aceitos do corpo — senão
  // qualquer um forjaria "veio da Direção" ou um donoNome falso. Tira do que
  // veio antes de montar o registro.
  const limpo: any = { ...registro };
  delete limpo.donoNome; delete limpo.encaminhadoPor; delete limpo.encaminhadoEm;

  const novo: any = { ...limpo, dono, donoNome: nomeDoDono(cfg, dono) };

  // ── O FIO DA CONVERSA ──────────────────────────────────────────────────────
  // Cada compromisso guarda a própria história (historico) e os anexos DENTRO
  // dele — não num log externo. As duas listas se juntam item a item pelo id
  // (estão no CAMPOS_UNIAO), então dois aparelhos escrevendo no mesmo fio não se
  // atropelam.
  // A conversa é APPEND-ONLY: entrada antiga é imutável. Para cada id que já
  // existe, devolvemos a versão GUARDADA (não a que veio do corpo) — senão dava
  // para reescrever ou reassinar o comentário de outro só reenviando o mesmo id.
  // Entrada nova tem a autoria carimbada com quem está de fato agindo.
  const mapaAntigo = new Map(((atual && atual.historico) || []).map((h: any) => [h.id, h]));
  novo.historico = (Array.isArray(novo.historico) ? novo.historico : []).map((h: any) => {
    if (!h) return h;
    if (mapaAntigo.has(h.id)) return mapaAntigo.get(h.id);   // congela a antiga
    return { ...h, por: euNome };                            // carimba a nova
  });
  // Anexo novo também leva a autoria real.
  const idsAnexo = new Set(((atual && atual.anexos) || []).map((a: any) => a.id));
  if (Array.isArray(novo.anexos)) {
    novo.anexos = novo.anexos.map((a: any) =>
      (a && !idsAnexo.has(a.id)) ? { ...a, por: euNome } : a);
  }

  // Encaminhou / voltou: o servidor é quem registra o evento no fio, com o
  // de-para verdadeiro — é a trilha "foi para a Ana e voltou" que o dono pediu.
  if (atual && atual.dono && atual.dono !== dono) {
    const deNome = atual.donoNome || nomeDoDono(cfg, atual.dono);
    const paraNome = nomeDoDono(cfg, dono);
    novo.encaminhadoPor = deNome;
    novo.encaminhadoEm = agora();
    novo.historico = [...(novo.historico || []), {
      id: idNovo(), em: agora(), por: euNome, tipo: "encaminhado",
      texto: "Encaminhou de " + deNome + " para " + paraNome,
    }];
  } else if (atual && atual.encaminhadoPor) {
    novo.encaminhadoPor = atual.encaminhadoPor;
    novo.encaminhadoEm = atual.encaminhadoEm;
  }
  return { registro: novo };
}

/* ══════════════════════════════════════════════════════════════════════════ */
Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }

  const h = Object.fromEntries(req.headers);
  const token = h["x-token"] || body.token;
  const TOKEN = Deno.env.get("TOKEN");
  if (!TOKEN || token !== TOKEN) return json({ error: "Não autorizado" }, 401);

  const { action } = body;
  const cfg = await lerCfg();

  const senhaCliente = h["x-senha"] || body.senha || "";
  const esperado = await hashGuardado(cfg);
  const quem: Quem | null = await identificar(cfg, senhaCliente);
  const autenticado = !!quem;
  // Nome que vai para o histórico: se o acesso é próprio, o nome do cadastro
  // manda — assim ninguém assina no lugar de outro trocando o campo do login.
  const por = (quem && quem.proprio && quem.nome) ||
    txt(h["x-quem"] ? decodeURIComponent(h["x-quem"]) : (body.por || ""), 60) || "—";

  const PUBLICAS = ["ping", "cfgPublico", "entrar", "novaSolicitacao", "andamento", "verPublico",
    "verCotacao", "responderCotacao", "verPrazos", "responderPrazo",
    "relatarEntrega", "sugerirEtapa"];
  if (!PUBLICAS.includes(action) && !autenticado) return json({ error: "Senha do painel inválida", semSenha: true }, 403);
  if (!PUBLICAS.includes(action) && !podeFazer(quem, action)) {
    await registrarLog({ acao: "bloqueado: " + action, por, perfil: quem!.perfil });
    return json({ error: "Seu acesso não permite isso. Fale com a direção.", semPermissao: true }, 403);
  }

  try {
    switch (action) {

      // Não devolve se a senha bate: isso virava um oráculo para testar senha
      // em massa sem deixar rastro. Quem quer conferir a senha usa 'entrar'.
      case "ping":
        return json({ ok: true, runtime: "supabase" });

      case "cfgPublico":
        return json({
          ok: true,
          empresa: { nome: cfg.empresa.nome, nomeCurto: cfg.empresa.nomeCurto },
          obras: (cfg.obras || []).filter((o: any) => o.ativa !== false).map((o: any) => ({ id: o.id, nome: o.nome })),
          setores: cfg.setores,
          unidades: cfg.unidades,
        });

      case "entrar": {
        if (!esperado) {
          return json({ ok: false, error: "Sistema ainda não configurado: falta o segredo PAINEL_SENHA." }, 503);
        }
        if (!autenticado) {
          await registrarLog({ acao: "login negado", por });
          return json({ ok: false, error: "Senha incorreta" }, 403);
        }
        // Carimba o último acesso de quem tem acesso próprio (é assim que a
        // direção vê quem parou de usar e pode desligar).
        if (quem!.proprio) {
          const usuarios = (cfg.usuarios || []).map((u: any) =>
            u.id === quem!.id ? { ...u, ultimoAcesso: agora() } : u);
          await gravarCfg({ ...cfg, usuarios });
        }
        await registrarLog({ acao: "entrou", por, perfil: quem!.perfil });
        return json({
          ok: true,
          senhaPadrao: !quem!.proprio && !cfg.senhaHash,
          proprio: quem!.proprio,
          nome: quem!.nome, cargo: quem!.cargo, perfil: quem!.perfil, usuarioId: quem!.id,
        });
      }

      // Tudo que o painel precisa numa requisição só.
      case "snapshot": {
        const todos = await lerTudo(body.colecoes || null, NOMES_COLECOES);
        // O celular da obra não leva preço nem contrato para casa: o cache fica
        // em texto no aparelho e sobrevive ao desligamento do acesso.
        let registros = filtrarLeitura(quem, todos);
        // Compromisso é agenda PESSOAL: quem não é da direção só recebe os seus.
        // A separação é aqui no servidor — mandar dono no corpo não abre a lista
        // de ninguém.
        if (perfilDe(quem) !== "direcao") {
          registros = registros.filter((r: any) => r._col !== "comp" || r.dono === quem!.id);
        }
        const cfgSaida = cfgSemSegredo(cfg);
        // Roster mínimo: só id + nome de quem está ativo, para o "encaminhar
        // para" funcionar para TODO mundo — sem levar telefone, cargo ou hash.
        // A lista completa (com telefone) continua só para a direção.
        cfgSaida.pessoas = (cfg.usuarios || []).filter((u: any) => u.ativo !== false)
          .map((u: any) => ({ id: u.id, nome: u.nome }));
        if (perfilDe(quem) !== "direcao") cfgSaida.usuarios = [];
        return json({
          ok: true, cfg: cfgSaida, registros, em: agora(),
          eu: { id: quem!.id, nome: quem!.nome, perfil: quem!.perfil, proprio: quem!.proprio },
        });
      }

      // Recusa item a item, NUNCA o pacote inteiro: o almoxarife manda o
      // recebimento e a solicitação no mesmo lote, e barrar tudo por causa de
      // um item fazia o app descartar o recebimento junto — trabalho de uma
      // manhã inteira sumindo por causa de uma linha proibida.
      case "salvarLote": {
        const itens = Array.isArray(body.itens) ? body.itens : [];
        if (!itens.length) return json({ ok: true, salvos: [] });
        const salvos: any[] = [];
        const recusados: any[] = [];
        for (const it of itens) {
          if (!it || !it.colecao || !it.registro) continue;
          const atual = it.registro.id ? await lerUm(it.colecao, it.registro.id) : null;
          // Compromisso tem regra própria: o dono é carimbado aqui, e quem não é
          // da direção só mexe no que é seu (mas pode ENCAMINHAR para outro).
          if (it.colecao === "comp") {
            const pronto = prepararComp(quem, cfg, it.registro, atual);
            if (pronto.erro) { recusados.push({ colecao: "comp", id: it.registro.id, motivo: pronto.erro }); continue; }
            salvos.push(await gravar("comp", pronto.registro, por));
            continue;
          }
          const motivo = motivoRecusa(quem, it.colecao, it.registro, atual);
          if (motivo) { recusados.push({ colecao: it.colecao, id: it.registro.id, motivo }); continue; }
          salvos.push(await gravar(it.colecao, it.registro, por));
        }
        if (recusados.length) {
          await registrarLog({
            acao: "recusou gravação", por, perfil: perfilDe(quem),
            detalhe: recusados.map((r) => r.colecao + ":" + r.motivo).join(" | "),
          });
        }
        // Compromisso NÃO vai para o log de auditoria: a história dele vive
        // dentro da própria conversa (historico), não num registro externo.
        const colsLog = itens.map((i: any) => i.colecao).filter((c: string) => c !== "comp");
        if (colsLog.length) {
          await registrarLog({ acao: "salvou", por, qtd: colsLog.length, cols: colsLog.join(",") });
        }
        return json({ ok: true, salvos, recusados });
      }

      // Lixeira: marca apagadoEm em vez de sumir com o registro.
      case "apagar": {
        const { colecao, id } = body;
        const r = await lerUm(colecao, id);
        if (!r) return json({ ok: true });
        r.apagadoEm = agora();
        r.apagadoPor = por;
        await gravarUm(colecao, id, r);
        await marcarMudanca(colecao);
        await registrarLog({ acao: "apagou", por, colecao, id, codigo: r.codigo || r.nome });
        return json({ ok: true });
      }

      // Apaga DE VEZ tudo que está na lixeira (o botão em Configurações), junto
      // com os arquivos que só aquele registro usava — senão uma planta de 60MB
      // ficaria ocupando espaço para sempre depois de apagada.
      case "esvaziarLixeira": {
        const { data } = await db.from("domo_registros").select("colecao, id, registro").eq("apagado", true);
        let apagados = 0, arquivos = 0;
        for (const linha of (data || [])) {
          const o = linha.registro as any;
          for (const idArq of arquivosDoRegistro(o)) {
            const meta = await lerUm("_arqmeta", idArq);
            const partes = (meta && meta.partes) || 1;
            const chaves = [idArq + "/meta"];
            for (let i = 0; i < partes; i++) chaves.push(idArq + "/p" + i);
            await apagarArquivo(chaves);
            await apagarDeVez("_arqmeta", idArq);
            arquivos++;
          }
          await apagarDeVez(linha.colecao, linha.id);
          apagados++;
        }
        await registrarLog({ acao: "esvaziou a lixeira", por, qtd: apagados, arquivos });
        return json({ ok: true, apagados, arquivos });
      }

      // Recomeça a numeração de uma coleção (virada de ano, ou depois de
      // limpar os testes).
      case "reiniciarNumeracao": {
        const col = body.colecao;
        if (!COLECOES[col] || !COLECOES[col].pre) return json({ ok: false, error: "Coleção sem numeração" }, 400);
        const proximo = Math.max(1, parseInt(body.proximo, 10) || 1);
        const { data } = await db.from("domo_seq_idx").delete().eq("colecao", col).gte("numero", proximo).select("numero");
        await definirNumeracao(col, proximo - 1);
        await registrarLog({ acao: "reiniciou a numeração", por, colecao: col, proximo });
        return json({ ok: true, proximo, soltas: (data || []).length });
      }

      case "restaurarItem": {
        const { colecao, id } = body;
        const r = await lerUm(colecao, id);
        if (!r) return json({ ok: false, error: "Não encontrado" }, 404);
        delete r.apagadoEm; delete r.apagadoPor;
        r.atualizadoEm = agora(); r.atualizadoPor = por;
        await gravarUm(colecao, id, r);
        await marcarMudanca(colecao);
        return json({ ok: true, registro: r });
      }

      // ── PÚBLICO: a obra pede material sem senha ─────────────────────────────
      case "novaSolicitacao": {
        const limpo: any = limparSolicitacao(body.registro || {});
        if (!limpo.solicitante.nome) return json({ ok: false, error: "Informe seu nome" }, 400);
        if (!limpo.itens.length) return json({ ok: false, error: "Inclua pelo menos um item" }, 400);
        const autor = limpo.solicitante.nome;
        limpo.historico = [{ id: idNovo(), em: agora(), por: autor, o_que: "Solicitação registrada pelo link da obra" }];
        const salvo = await gravar("sc", limpo, autor);
        await registrarLog({ acao: "nova solicitação", por: autor, codigo: salvo.codigo, obra: salvo.obra });
        return json({ ok: true, codigo: salvo.codigo, id: salvo.id, numero: salvo.numero });
      }

      // ── PÚBLICO: quadro de andamento da obra ───────────────────────────────
      // Basta abrir o link: a pessoa vê TODOS os pedidos e o que está por
      // chegar. O que NÃO sai daqui: preço unitário, valor da ordem e telefone
      // de quem pediu — informação comercial e dado pessoal de terceiro.
      case "andamento": {
        // Cache de 60s: sem ele, cada abertura varre a base inteira — e esta é
        // uma rota aberta, que pode ser chamada em rajada.
        const { data: cacheLinha } = await db.from("domo_meta").select("valor").eq("chave", "andamento_cache").maybeSingle();
        const cache = cacheLinha?.valor as any;
        if (cache && cache.em && (Date.now() - new Date(cache.em).getTime()) < 60000) {
          return json({ ok: true, em: cache.em, pedidos: cache.pedidos, doCache: true });
        }

        const todos = await lerTudo(["sc", "oc"], NOMES_COLECOES);
        const ocs = todos.filter((x: any) => x._col === "oc" && !x.apagadoEm);
        const porId = new Map(ocs.map((o: any) => [o.id, o]));
        const pedidos = todos
          .filter((x: any) => x._col === "sc" && !x.apagadoEm)
          .sort((a: any, b: any) => String(b.criadoEm || "").localeCompare(String(a.criadoEm || "")))
          .slice(0, 150)
          .map((s: any) => ({
            codigo: s.codigo, situacao: s.situacao, obra: s.obra, setor: s.setor, urgencia: s.urgencia,
            quem: (s.solicitante && s.solicitante.nome) || "—",
            criadoEm: s.criadoEm, necessidadeEm: s.necessidadeEm, motivoRecusa: s.motivoRecusa,
            itens: (s.itens || []).map((i: any) => ({ descricao: i.descricao, qtd: i.qtd, unid: i.unid })),
            compras: (s.ocIds || []).map((id: string) => porId.get(id)).filter(Boolean).map((o: any) => ({
              codigo: o.codigo, situacao: o.situacao,
              fornecedor: (o.fornecedor && o.fornecedor.nome) || "",
              entregaPrevista: o.entregaPrevista, recebidoEm: o.recebidoEm,
            })),
            historico: (s.historico || []).slice(-6).map((x: any) => ({ em: x.em, por: x.por, o_que: x.o_que })),
          }));

        const em = agora();
        try {
          await db.from("domo_meta").upsert({ chave: "andamento_cache", valor: { em, pedidos }, atualizado_em: em });
        } catch { /* sem cache, só fica mais lento */ }
        return json({ ok: true, em, pedidos });
      }

      // ── PÚBLICO: fornecedor abre a OC/OS pelo link do WhatsApp ─────────────
      case "verPublico": {
        const { tipo, id } = body;
        if (!["oc", "os"].includes(tipo)) return json({ ok: false, error: "Tipo inválido" }, 400);
        const r = await lerUm(tipo, id);
        if (!r || r.apagadoEm) return json({ ok: false, error: "Documento não encontrado" }, 404);
        if (!r.tokenPublico || r.tokenPublico !== body.t) return json({ ok: false, error: "Link inválido" }, 403);
        if (r.situacao === "rascunho") return json({ ok: false, error: "Documento ainda não emitido" }, 403);

        // LISTA BRANCA (nunca lista negra): só sai o que o documento precisa
        // mostrar. Lista negra sempre fica para trás quando um módulo novo passa
        // a guardar campo novo dentro do mesmo registro.
        const campos = tipo === "oc"
          ? ["id", "codigo", "situacao", "obra", "dataEmissao", "entregaPrevista", "fornecedor",
             "localEntrega", "prazoEntrega", "validadeProposta", "modalidade", "condicaoPagamento",
             "formaPagamento", "dadosBancarios", "garantia", "notaFiscalObrigatoria", "itens",
             "ipiPerc", "icmsPerc", "frete", "seguro", "desconto", "total", "totalLiquido", "observacoes"]
          : ["id", "codigo", "situacao", "obra", "localizacao", "contratoNumero", "dataEmissao",
             "dataInicio", "dataTerminoPrevista", "empreiteiro", "itens", "total", "observacoes"];
        const enxuto: any = {};
        for (const c of campos) if (r[c] !== undefined) enxuto[c] = r[c];

        const publico = { empresa: cfg.empresa, assinaturas: cfg.assinaturas, clausulasOC: cfg.clausulasOC };
        return json({ ok: true, registro: enxuto, cfg: publico });
      }

      // ── PÚBLICO: o fornecedor abre a cotação pelo link ─────────────────────
      case "verCotacao": {
        const c = await lerUm("cot", body.id);
        if (!c || c.apagadoEm) return json({ ok: false, error: "Cotação não encontrada" }, 404);
        const f = (c.fornecedores || []).find((x: any) => x.token && x.token === body.t);
        if (!f) return json({ ok: false, error: "Link inválido" }, 403);
        if (c.situacao === "cancelada") return json({ ok: false, error: "Esta cotação foi cancelada" }, 403);
        // O fornecedor vê SÓ o que precisa: os itens e a resposta dele. Nunca o
        // preço nem o nome dos concorrentes.
        return json({
          ok: true,
          empresa: { nome: cfg.empresa.nome, nomeCurto: cfg.empresa.nomeCurto },
          cotacao: {
            codigo: c.codigo, obra: c.obra, prazoResposta: c.prazoResposta,
            observacoes: c.observacoes, encerrada: c.situacao !== "aberta",
            itens: (c.itens || []).map((i: any) => ({ id: i.id, descricao: i.descricao, unid: i.unid, qtd: i.qtd })),
          },
          minhaResposta: {
            nome: f.nome, contato: f.contato, precos: f.precos || {}, frete: f.frete,
            prazoEntrega: f.prazoEntrega, condicaoPagamento: f.condicaoPagamento,
            validade: f.validade, obs: f.obs, respondidoEm: f.respondidoEm,
          },
        });
      }

      case "responderCotacao": {
        const c = await lerUm("cot", body.id);
        if (!c || c.apagadoEm) return json({ ok: false, error: "Cotação não encontrada" }, 404);
        if (c.situacao !== "aberta") return json({ ok: false, error: "Esta cotação já foi encerrada" }, 403);
        const i = (c.fornecedores || []).findIndex((x: any) => x.token && x.token === body.t);
        if (i < 0) return json({ ok: false, error: "Link inválido" }, 403);

        const precos: Record<string, number> = {};
        for (const it of (c.itens || [])) {
          const v = num((body.precos || {})[it.id]);
          if (v > 0) precos[it.id] = v;
        }
        if (!Object.keys(precos).length) return json({ ok: false, error: "Informe o preço de pelo menos um item" }, 400);

        const f = c.fornecedores[i];
        const total = (c.itens || []).reduce((s2: number, it: any) =>
          s2 + (precos[it.id] || 0) * (Number(it.qtd) || 0), 0) + num(body.frete);

        c.fornecedores[i] = {
          ...f, precos, frete: num(body.frete), total,
          prazoEntrega: txt(body.prazoEntrega, 60),
          condicaoPagamento: txt(body.condicaoPagamento, 60),
          validade: txt(body.validade, 40),
          obs: txt(body.obs, 500),
          contato: txt(body.contato, 80) || f.contato,
          respondidoEm: agora(),
        };
        c.historico = unirPorId(c.historico, [{
          id: idNovo(), em: agora(), por: f.nome || "fornecedor",
          o_que: "Cotação respondida por " + (f.nome || "—") + ": " +
            total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
        }]);
        c.atualizadoEm = agora();
        await gravarUm("cot", c.id, c);
        await marcarMudanca("cot");
        return json({ ok: true, total });
      }

      // ── PÚBLICO: o fornecedor vê as datas dele e diz se atende ─────────────
      case "verPrazos": {
        const c = await lerUm("crono", body.id);
        if (!c || c.apagadoEm) return json({ ok: false, error: "Cronograma não encontrado" }, 404);
        const r0 = (c.responsaveis || []).find((x: any) => x.token && x.token === body.t);
        if (!r0) return json({ ok: false, error: "Link inválido" }, 403);
        // Só as etapas DELE. Ninguém vê o cronograma inteiro da obra nem quem
        // mais está contratado.
        const minhas = (c.etapas || []).filter((e: any) => e.responsavelId === r0.id && !e.apagadoEm);
        return json({
          ok: true,
          empresa: { nome: cfg.empresa.nome, nomeCurto: cfg.empresa.nomeCurto },
          cronograma: { codigo: c.codigo, nome: c.nome, obra: c.obra, encerrado: c.situacao !== "ativo" },
          responsavel: { nome: r0.nome, contato: r0.contato },
          etapas: minhas.map((e: any) => ({
            id: e.id, nome: e.nome, inicio: e.inicio, fim: e.fim,
            qtd: e.qtd, unid: e.unid, obs: e.obs,
            resposta: e.resposta || null,
            remessas: e.remessas || [],
            entregas: (e.entregas || []).map((x: any) => ({ em: x.em, data: x.data, nf: x.nf, qtd: x.qtd, obs: x.obs })),
            concluida: !!e.concluidaEm,
            pendenteAprovacao: !!e.pendenteAprovacao,
            recusadaEm: e.recusadaEm || null,
          })),
        });
      }

      case "responderPrazo": {
        const c = await lerUm("crono", body.id);
        if (!c || c.apagadoEm) return json({ ok: false, error: "Cronograma não encontrado" }, 404);
        if (c.situacao !== "ativo") return json({ ok: false, error: "Este cronograma foi encerrado" }, 403);
        const r0 = (c.responsaveis || []).find((x: any) => x.token && x.token === body.t);
        if (!r0) return json({ ok: false, error: "Link inválido" }, 403);
        const i = (c.etapas || []).findIndex((e: any) => e.id === body.etapaId && e.responsavelId === r0.id);
        if (i < 0) return json({ ok: false, error: "Etapa não encontrada" }, 404);

        const atende = body.atende === true || body.atende === "sim";
        if (!atende && !txt(body.justificativa, 500)) {
          return json({ ok: false, error: "Diga por que não consegue atender" }, 400);
        }
        const e = c.etapas[i];

        // Programação do fornecedor: ferro e concreto chegam parcelados, então
        // ele detalha quantos caminhões e em que dias.
        const remessas = (Array.isArray(body.remessas) ? body.remessas : []).slice(0, 20)
          .map((x: any, n: number) => ({
            id: (x && x.id) || ("rm" + n + idNovo()),
            data: txt(x && x.data, 10),
            qtd: num(x && x.qtd),
            obs: txt(x && x.obs, 200),
          })).filter((x: any) => x.data || x.qtd);

        c.etapas[i] = {
          ...e,
          resposta: {
            em: agora(), por: txt(body.por, 80) || r0.nome,
            atende,
            novaData: txt(body.novaData, 10),
            justificativa: txt(body.justificativa, 500),
          },
          ...(remessas.length ? { remessas } : {}),
        };
        c.historico = unirPorId(c.historico, [{
          id: idNovo(), em: agora(), por: r0.nome,
          o_que: (atende ? "✅ " : "⛔ ") + r0.nome + (atende ? " confirmou" : " NÃO atende") +
            ' a etapa "' + (e.nome || "") + '"' +
            (!atende && body.novaData ? " — propôs " + body.novaData : "") +
            (body.justificativa ? ": " + txt(body.justificativa, 200) : ""),
        }]);
        c.atualizadoEm = agora();
        await gravarUm("crono", c.id, c);
        await marcarMudanca("crono");
        return json({ ok: true });
      }

      // ── PÚBLICO: o fornecedor relata o que já entregou ─────────────────────
      case "relatarEntrega": {
        const c = await lerUm("crono", body.id);
        if (!c || c.apagadoEm) return json({ ok: false, error: "Cronograma não encontrado" }, 404);
        if (c.situacao !== "ativo") return json({ ok: false, error: "Este cronograma foi encerrado" }, 403);
        const r0 = (c.responsaveis || []).find((x: any) => x.token && x.token === body.t);
        if (!r0) return json({ ok: false, error: "Link inválido" }, 403);
        const i = (c.etapas || []).findIndex((e: any) => e.id === body.etapaId && e.responsavelId === r0.id);
        if (i < 0) return json({ ok: false, error: "Etapa não encontrada" }, 404);

        const rel = {
          id: idNovo(), em: agora(), por: txt(body.por, 80) || r0.nome,
          data: txt(body.data, 10), nf: txt(body.nf, 40), qtd: num(body.qtd),
          obs: txt(body.obs, 500),
          fotos: (Array.isArray(body.fotos) ? body.fotos : []).slice(0, 5).map((f: any) => txt(f, 60)),
        };
        const e = c.etapas[i];
        c.etapas[i] = { ...e, entregas: unirPorId(e.entregas, [rel]) };
        c.historico = unirPorId(c.historico, [{
          id: idNovo(), em: agora(), por: r0.nome,
          o_que: "🚚 " + r0.nome + ' informou entrega em "' + (e.nome || "") + '"' +
            (rel.qtd ? " — " + rel.qtd : "") + (rel.nf ? " · NF " + rel.nf : ""),
        }]);
        c.atualizadoEm = agora();
        await gravarUm("crono", c.id, c);
        await marcarMudanca("crono");
        return json({ ok: true });
      }

      // ── PÚBLICO: o fornecedor sugere uma etapa ─────────────────────────────
      case "sugerirEtapa": {
        const c = await lerUm("crono", body.id);
        if (!c || c.apagadoEm) return json({ ok: false, error: "Cronograma não encontrado" }, 404);
        if (c.situacao !== "ativo") return json({ ok: false, error: "Este cronograma foi encerrado" }, 403);
        const r0 = (c.responsaveis || []).find((x: any) => x.token && x.token === body.t);
        if (!r0) return json({ ok: false, error: "Link inválido" }, 403);
        const nome = txt(body.nome, 160);
        if (!nome) return json({ ok: false, error: "Escreva o que precisa acontecer" }, 400);
        // Sugestão NÃO entra no cronograma: entra como proposta esperando o
        // engenheiro aprovar. Quem manda na data da obra é a obra.
        const etapa = {
          id: idNovo(), nome, responsavelId: r0.id,
          inicio: txt(body.inicio, 10), fim: txt(body.fim, 10),
          qtd: num(body.qtd), unid: txt(body.unid, 10), obs: txt(body.obs, 500),
          sugeridaPor: r0.nome, sugeridaEm: agora(), pendenteAprovacao: true,
        };
        c.etapas = [...(c.etapas || []), etapa];
        c.historico = unirPorId(c.historico, [{
          id: idNovo(), em: agora(), por: r0.nome,
          o_que: "💡 " + r0.nome + ' sugeriu a etapa "' + nome + '"' +
            (etapa.inicio ? " para " + etapa.inicio : "") + " — esperando sua aprovação",
        }]);
        c.atualizadoEm = agora();
        await gravarUm("crono", c.id, c);
        await marcarMudanca("crono");
        return json({ ok: true });
      }

      // ── Configurações ──────────────────────────────────────────────────────
      case "salvarCfg": {
        const novo = { ...cfg, ...(body.cfg || {}) };
        novo.senhaHash = cfg.senhaHash;      // senha só muda pela ação própria
        novo.usuarios = cfg.usuarios || [];  // idem os acessos: o cliente nem vê os hashes
        novo.atualizadoEm = agora();
        novo.atualizadoPor = por;
        await gravarCfg(novo);
        await registrarLog({ acao: "mudou configuração", por });
        return json({ ok: true, cfg: cfgSemSegredo(novo) });
      }

      /* ── Acessos da equipe ─────────────────────────────────────────────────
         Um acesso por pessoa: o histórico passa a dizer QUEM aprovou, e
         desligar alguém não obriga a trocar a senha de todo mundo. */
      case "salvarUsuario": {
        const u = body.usuario || {};
        const nome = txt(u.nome, 60);
        if (!nome) return json({ ok: false, error: "Informe o nome" }, 400);
        const perfil = PERFIS[u.perfil] ? u.perfil : "obra";
        const lista = cfg.usuarios || [];
        const existente = u.id ? lista.find((x: any) => x.id === u.id) : null;
        if (u.id && !existente) return json({ ok: false, error: "Acesso não encontrado" }, 404);

        // Hash novo só vem quando a direção define/troca a senha da pessoa.
        let hash = existente ? existente.hash : null;
        if (u.novaHash) {
          const nh = txt(u.novaHash, 128);
          if (nh.length < 32) return json({ ok: false, error: "Senha inválida" }, 400);
          hash = await sha256(nh);
        }
        if (!hash) return json({ ok: false, error: "Defina uma senha para esta pessoa" }, 400);
        // Duas pessoas com a mesma senha se confundem no login (ele identifica
        // pelo hash). Melhor barrar na hora de criar do que descobrir depois.
        if (hash === (await hashGuardado(cfg)) ||
            lista.some((x: any) => x.hash === hash && x.id !== (u.id || ""))) {
          return json({ ok: false, error: "Essa senha já está em uso por outro acesso. Escolha outra." }, 400);
        }

        const registro = {
          ...(existente || {}),
          id: u.id || idNovo(),
          nome, cargo: txt(u.cargo, 60), telefone: txt(u.telefone, 30),
          perfil, hash, ativo: u.ativo !== false,
          criadoEm: (existente && existente.criadoEm) || agora(),
          atualizadoEm: agora(), atualizadoPor: por,
        };
        const usuarios = existente
          ? lista.map((x: any) => x.id === registro.id ? registro : x)
          : [...lista, registro];
        await gravarCfg({ ...cfg, usuarios, atualizadoEm: agora() });
        await registrarLog({
          acao: existente ? "alterou o acesso de " + nome : "criou acesso para " + nome, por, perfil,
        });
        return json({ ok: true, cfg: cfgSemSegredo({ ...cfg, usuarios }) });
      }

      case "apagarUsuario": {
        const id = txt(body.id, 40);
        const lista = cfg.usuarios || [];
        const alvo = lista.find((x: any) => x.id === id);
        if (!alvo) return json({ ok: true });
        const usuarios = lista.filter((x: any) => x.id !== id);
        await gravarCfg({ ...cfg, usuarios, atualizadoEm: agora() });
        await registrarLog({ acao: "removeu o acesso de " + alvo.nome, por });
        return json({ ok: true, cfg: cfgSemSegredo({ ...cfg, usuarios }) });
      }

      // A própria pessoa troca a senha dela (não precisa ser da direção).
      case "minhaSenha": {
        if (!quem!.proprio) {
          return json({ ok: false, error: "Você entrou com a senha da equipe. Troque em Configurações." }, 400);
        }
        const nh = txt(body.novaHash, 128);
        if (!nh || nh.length < 32) return json({ ok: false, error: "Senha inválida" }, 400);
        const novoHash = await sha256(nh);
        if (novoHash === (await hashGuardado(cfg)) ||
            (cfg.usuarios || []).some((x: any) => x.hash === novoHash && x.id !== quem!.id)) {
          return json({ ok: false, error: "Essa senha já está em uso. Escolha outra." }, 400);
        }
        const usuarios = (cfg.usuarios || []).map((x: any) =>
          x.id === quem!.id ? { ...x, hash: novoHash, atualizadoEm: agora() } : x);
        await gravarCfg({ ...cfg, usuarios, atualizadoEm: agora() });
        await registrarLog({ acao: "trocou a própria senha", por });
        return json({ ok: true });
      }

      case "trocarSenha": {
        const nova = txt(body.novaHash, 128);
        if (!nova || nova.length < 32) return json({ ok: false, error: "Senha inválida" }, 400);
        await gravarCfg({ ...cfg, senhaHash: await sha256(nova), atualizadoEm: agora() });
        await registrarLog({ acao: "trocou a senha da equipe", por });
        return json({ ok: true });
      }

      // ── Log e backup ───────────────────────────────────────────────────────
      case "log":
        return json({ ok: true, linhas: await lerLog(body.limite || 200) });

      case "backup": {
        const registros = await lerTudo(null, NOMES_COLECOES);
        // O arquivo do backup sai do servidor e vai parar no computador de
        // alguém: nenhum hash de senha viaja junto.
        const limpo = cfgSemSegredo(cfg);
        // A numeração entra no backup: sem ela, uma restauração recomeçaria em
        // SC-0001 e repetiria número de documento que já foi para fornecedor.
        const seq = await lerNumeracao();
        return json({ ok: true, em: agora(), cfg: limpo, registros, seq });
      }

      case "restaurar": {
        const registros = Array.isArray(body.registros) ? body.registros : [];
        let n = 0;
        const maiorNumero: Record<string, number> = {};
        for (const r of registros) {
          const col = r._col;
          if (!COLECOES[col] || !r.id) continue;
          const copia = { ...r };
          delete copia._col;
          await gravarUm(col, r.id, copia);
          if (r.numero) maiorNumero[col] = Math.max(maiorNumero[col] || 0, Number(r.numero) || 0);
          n++;
        }
        // A numeração acompanha o que foi restaurado, senão o próximo documento
        // sairia com um número que já existe.
        const atual = await lerNumeracao();
        for (const [col, maior] of Object.entries(maiorNumero)) {
          const ja = atual["ultimo_" + col];
          if (!ja || (ja.n || 0) < maior) await definirNumeracao(col, maior);
        }
        await marcarMudanca(Object.keys(maiorNumero));
        await registrarLog({ acao: "restaurou backup", por, qtd: n });
        return json({ ok: true, restaurados: n });
      }

      default:
        return json({ error: "Ação desconhecida: " + action }, 400);
    }
  } catch (e) {
    console.error("[nucleo] erro:", e);
    return json({ error: (e as Error)?.message || String(e) }, 500);
  }
});
