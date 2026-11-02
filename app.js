'use strict';
/* Conselho IA
   Ideias aproveitadas (sem copiar código):
   - llm-council: opiniões separadas, revisão anônima e um presidente que fecha a resposta.
   - free-claude-code: vários provedores gratuitos com troca automática quando um falha. */

// ---------- Provedores: todos testados para aceitar chamadas direto do navegador ----------
const PROVEDORES = {
  gemini: { nome: 'Google Gemini', forte: 'Lê muito texto de uma vez. Ótimo para fechar o resumo.',
    base: 'https://generativelanguage.googleapis.com/v1beta/openai', chave: true,
    pegar: 'https://aistudio.google.com/app/apikey',
    modelos: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'], prefere: [/^(models\/)?gemini-[\d.]+-flash$/], maior: true },
  groq: { nome: 'Groq', forte: 'Muito rápido. Bom para planejar.',
    base: 'https://api.groq.com/openai/v1', chave: true,
    pegar: 'https://console.groq.com/keys',
    modelos: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'] },
  mistral: { nome: 'Mistral', forte: 'Modelo europeu, com outro olhar. Bom para criticar.',
    base: 'https://api.mistral.ai/v1', chave: true,
    pegar: 'https://console.mistral.ai/api-keys',
    modelos: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest'] },
  openrouter: { nome: 'OpenRouter', forte: 'Vários modelos gratuitos com uma chave só. Bom para simplificar.',
    base: 'https://openrouter.ai/api/v1', chave: true,
    pegar: 'https://openrouter.ai/keys',
    modelos: ['openrouter/free'] },
  llm7: { nome: 'LLM7', forte: 'Funciona sem cadastro.',
    base: 'https://api.llm7.io/v1', chave: false,
    modelos: ['default', 'gpt-oss:20b', 'GLM-5.3-Flash'] },
  ovh: { nome: 'OVHcloud', forte: 'Funciona sem cadastro, mas aceita poucos pedidos por minuto.',
    base: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1', chave: false,
    modelos: ['gpt-oss-120b', 'gpt-oss-20b', 'Meta-Llama-3_3-70B-Instruct'] },
};

// Cada lugar tenta a própria IA primeiro e cai para as seguintes se ela falhar.
const CONSELHO = [
  { id: 'planejador', nome: 'Planejador', cor: 'var(--planejador)', pos: [50, 10],
    ordem: ['groq', 'llm7', 'gemini', 'openrouter', 'mistral', 'ovh'],
    papel: 'Você é o Planejador: define telas, funções e a ordem de construção.' },
  { id: 'critico', nome: 'Crítico', cor: 'var(--critico)', pos: [88, 50],
    ordem: ['mistral', 'ovh', 'gemini', 'groq', 'openrouter', 'llm7'],
    papel: 'Você é o Crítico: procura falhas, riscos, custos escondidos e problemas de segurança.' },
  { id: 'simplificador', nome: 'Simplificador', cor: 'var(--simplificador)', pos: [12, 50],
    ordem: ['openrouter', 'llm7', 'groq', 'mistral', 'gemini', 'ovh'],
    papel: 'Você é o Simplificador: corta o supérfluo e busca o caminho mais simples e de custo zero.' },
];
const PRESIDENTE = { id: 'presidente', nome: 'Presidente', cor: 'var(--presidente)', pos: [50, 89],
  ordem: ['gemini', 'groq', 'mistral', 'openrouter', 'llm7', 'ovh'] };
const LUGARES = [...CONSELHO, PRESIDENTE];

const CONTEXTO = 'O dono do projeto é leigo em tecnologia, tem pequenos negócios no Brasil e quer custo zero sempre que possível. Responda em português do Brasil, em texto simples, sem tabelas.';
const PEDIDO_FINAL = 'Revise este plano, aponte só problemas que mudem o resultado, construa o projeto e publique.';

// ---------- Armazenamento (pode falhar em janela anônima; o app continua funcionando) ----------
const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* segue sem salvar */ } };
const ler = (k, padrao) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : padrao; } catch (e) { return padrao; } };
let chaves = ler('ci-chaves', {});
let historico = ler('ci-historico', []);

// ---------- Utilidades ----------
const $ = id => document.getElementById(id);
const estimar = t => Math.ceil((t || '').length / 4);
const milhar = n => n.toLocaleString('pt-BR');
const esperar = (ms, sinal) => new Promise((ok, erro) => {
  const t = setTimeout(ok, ms);
  sinal?.addEventListener('abort', () => { clearTimeout(t); erro(new DOMException('parado', 'AbortError')); }, { once: true });
});
function avisar(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('ver');
  clearTimeout(avisar.t); avisar.t = setTimeout(() => t.classList.remove('ver'), 3000);
}
// Tira o raciocínio interno que alguns modelos devolvem e a formatação que o app não mostra.
function limpar(texto) {
  return (texto || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?think>[\s\S]*$/i, '')
    .replace(/\*\*/g, '').replace(/^#{1,6}\s*/gm, '').trim();
}
function embaralhar(lista) {
  const a = [...lista];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------- Descoberta de modelos: os nomes grátis mudam com frequência ----------
const descobertos = {};
async function modelosDe(id) {
  const p = PROVEDORES[id];
  if (!p.prefere) return p.modelos;
  if (descobertos[id]) return descobertos[id];
  try {
    const r = await fetch(p.base + '/models', { headers: { Authorization: 'Bearer ' + chaves[id] }, signal: AbortSignal.timeout(10000) });
    const lista = ((await r.json()).data || []).map(m => m.id.replace(/^models\//, ''));
    const bons = lista.filter(m => p.prefere.some(re => re.test(m)))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    descobertos[id] = [...new Set([...bons, ...p.modelos])];
  } catch (e) { descobertos[id] = p.modelos; }
  return descobertos[id];
}

// ---------- Chamada com troca automática ----------
const pausados = new Map(); // "provedor/modelo" -> horário em que pode voltar
const conectado = id => !PROVEDORES[id].chave || !!chaves[id];

class ErroConselho extends Error {}

async function chamarUma(id, modelo, mensagens, limite, sinal) {
  const p = PROVEDORES[id];
  const headers = { 'Content-Type': 'application/json' };
  if (p.chave) headers.Authorization = 'Bearer ' + chaves[id];
  const tempo = AbortSignal.timeout(90000);
  const r = await fetch(p.base + '/chat/completions', {
    method: 'POST', headers,
    body: JSON.stringify({ model: modelo, messages: mensagens, max_tokens: limite, temperature: 0.5 }),
    signal: AbortSignal.any([sinal, tempo]),
  });
  if (!r.ok) {
    const e = new ErroConselho('HTTP ' + r.status);
    e.status = r.status; e.retry = Number(r.headers.get('retry-after')) || 0;
    throw e;
  }
  const j = await r.json();
  const texto = limpar(j.choices?.[0]?.message?.content);
  if (!texto) throw new ErroConselho('resposta vazia');
  return { texto, entrada: j.usage?.prompt_tokens || 0, saida: j.usage?.completion_tokens || estimar(texto) };
}

async function chamar(lugar, mensagens, limite, sinal, aoEsperar) {
  const ordem = lugar.ordem.filter(conectado);
  let tentativas = 0;
  while (tentativas++ < 3) {
    let proximaLiberacao = Infinity;
    for (const id of ordem) {
      for (const modelo of await modelosDe(id)) {
        const chave = id + '/' + modelo;
        const volta = pausados.get(chave) || 0;
        if (volta > Date.now()) { proximaLiberacao = Math.min(proximaLiberacao, volta); continue; }
        try {
          const r = await chamarUma(id, modelo, mensagens, limite, sinal);
          return { ...r, provedor: PROVEDORES[id].nome, modelo };
        } catch (e) {
          if (sinal.aborted) throw e;
          if (e.status === 401 || e.status === 403) break; // chave inválida: pula o provedor
          if (e.status === 429) {
            const ms = (e.retry || 60) * 1000;
            pausados.set(chave, Date.now() + ms);
            proximaLiberacao = Math.min(proximaLiberacao, Date.now() + ms);
          }
        }
      }
    }
    if (proximaLiberacao === Infinity) break;
    aoEsperar?.();
    await esperar(Math.min(Math.max(proximaLiberacao - Date.now(), 1000), 65000), sinal);
  }
  throw new ErroConselho('Nenhuma IA disponível');
}

// ---------- Etapas do debate (cada uma limita o tamanho para gastar pouco) ----------
const sistema = (lugar) => `${lugar.papel} ${CONTEXTO}`;

const msgOpiniao = (lugar, ideia) => [
  { role: 'system', content: sistema(lugar) },
  { role: 'user', content: `Projeto proposto:\n${ideia}\n\nDê sua proposta em até 180 palavras: o que construir, como, e o maior cuidado.` },
];
const msgCritica = (lugar, ideia, outras) => [
  { role: 'system', content: sistema(lugar) },
  { role: 'user', content: `Projeto: ${ideia}\n\nPropostas de outros conselheiros, sem identificação:\n\n${outras.map(o => `Proposta ${o.letra}:\n${o.texto}`).join('\n\n')}\n\nEm até 120 palavras, diga o que aproveitar e o que está errado em cada uma. Termine com uma linha por proposta no formato "NOTA A: 7" (0 a 10).` },
];
const msgReplica = (lugar, ideia, propria, criticas) => [
  { role: 'system', content: sistema(lugar) },
  { role: 'user', content: `Projeto: ${ideia}\n\nSua proposta:\n${propria}\n\nCríticas que o conselho fez:\n${criticas}\n\nEm até 120 palavras, ajuste sua proposta. Diga o que mudou e o que você mantém. Termine com "CONSENSO: sim" se o conselho já concorda no essencial, ou "CONSENSO: não" e o motivo em uma linha.` },
];
const msgPresidente = (ideia, material, respostas, anterior) => [
  { role: 'system', content: `Você é o Presidente do conselho e fecha o debate sem inventar nada novo. ${CONTEXTO}` },
  { role: 'user', content: `Projeto: ${ideia}\n\nDebate:\n${material}\n${anterior ? `\nResumo anterior:\n${anterior}\n` : ''}${respostas ? `\nO dono do projeto respondeu ou pediu:\n${respostas}\nEsta orientação vale mais que o debate.\n` : ''}
Escreva exatamente as duas partes abaixo, usando os títulos como estão.

=== PARA VOCÊ ===
Em até 150 palavras e sem termos técnicos: o que será feito, por que o conselho escolheu assim, onde houve discordância e as perguntas que só o dono pode responder.

=== PARA O CLAUDE ===
Pedido enxuto de no máximo 300 palavras, com estes itens: Objetivo; Usuários; Funções essenciais; Regras importantes; Tecnologia sugerida; Fora do escopo; Riscos; Como saber que ficou pronto. Não repita informação. Dúvidas sem resposta entram como "Pendente". Na última linha escreva: ${PEDIDO_FINAL}` },
];

function separar(texto) {
  const m = texto.match(/=+\s*PARA VOC[ÊE]\s*=+([\s\S]*?)=+\s*PARA O CLAUDE\s*=+([\s\S]*)/i);
  if (m) return { resumo: m[1].trim(), briefing: m[2].trim() };
  return { resumo: 'O Presidente não separou as partes. O texto completo está no pedido abaixo.', briefing: texto.trim() };
}

// ---------- Tela: mesa ----------
function montarMesa() {
  const mesa = $('mesa');
  LUGARES.forEach(l => {
    const d = document.createElement('div');
    d.className = 'lugar'; d.id = 'lugar-' + l.id;
    d.style.left = l.pos[0] + '%'; d.style.top = l.pos[1] + '%'; d.style.setProperty('--cor', l.cor);
    const i = document.createElement('i'), b = document.createElement('b'), s = document.createElement('small');
    b.textContent = l.nome; s.id = 'modelo-' + l.id;
    d.append(i, b, s); mesa.append(d);
  });
}
function marcar(id, estado, detalhe) {
  const d = $('lugar-' + id);
  d.classList.remove('falando', 'feito', 'erro');
  if (estado) d.classList.add(estado);
  if (detalhe !== undefined) $('modelo-' + id).textContent = detalhe;
}
const status = t => { $('mesa-status').textContent = t; };

// ---------- Tela: falas ----------
function novaEtapa(titulo) {
  const li = document.createElement('li'); li.className = 'etapa'; li.textContent = titulo;
  $('falas').append(li);
}
function novaFala(f) {
  const li = document.createElement('li');
  li.className = 'fala' + (f.falhou ? ' falhou' : '');
  li.style.setProperty('--cor', f.cor);
  const det = document.createElement('details'); det.open = !!f.aberta;
  const sum = document.createElement('summary'); sum.textContent = f.nome;
  const sm = document.createElement('small'); sm.textContent = f.modelo ? `${f.provedor}, ${f.modelo}` : '';
  sum.append(sm);
  const corpo = document.createElement('div'); corpo.textContent = f.texto; // sempre texto puro, nunca HTML
  det.append(sum, corpo); li.append(det); $('falas').append(li);
}

// ---------- Fluxo principal ----------
let controle = null;
let atual = null;
let gasto = 0;

function somar(r) {
  gasto += (r.entrada || 0) + (r.saida || 0);
  $('consumo').textContent = `Consumo das IAs gratuitas neste debate: cerca de ${milhar(gasto)} tokens. Nada disso sai do seu plano do Claude.`;
}
function registrar(sessao, etapa, lugar, r) {
  const f = { etapa, nome: lugar.nome, cor: lugar.cor, texto: r.texto, provedor: r.provedor, modelo: r.modelo };
  sessao.falas.push(f); novaFala(f);
}
function falhou(sessao, etapa, lugar) {
  const f = { etapa, nome: lugar.nome, cor: lugar.cor, texto: 'Esta IA não respondeu nesta etapa. O debate seguiu sem ela.', falhou: true };
  sessao.falas.push(f); novaFala(f);
}

// Pede a todos em paralelo. Quem falhar fica de fora; o debate não trava.
async function rodada(sessao, etapa, titulo, lugares, criar, limite, sinal) {
  novaEtapa(titulo); status(titulo);
  const resultados = await Promise.all(lugares.map(async l => {
    marcar(l.id, 'falando');
    try {
      const r = await chamar(l, criar(l), limite, sinal, () => status('Aguardando liberar o limite gratuito'));
      marcar(l.id, 'feito', r.provedor); somar(r); registrar(sessao, etapa, l, r);
      return { lugar: l, texto: r.texto };
    } catch (e) {
      if (sinal.aborted) throw e;
      marcar(l.id, 'erro'); falhou(sessao, etapa, l);
      return null;
    }
  }));
  return resultados.filter(Boolean);
}

function montarMaterial(propostas, criticas, replicas) {
  // Se houve réplica, ela substitui a proposta original: menos texto para o Presidente ler.
  const base = replicas.length ? replicas : propostas;
  return [...base.map(x => `${x.lugar.nome}:\n${x.texto}`), ...criticas.map(c => `Crítica de ${c.lugar.nome}:\n${c.texto}`)].join('\n\n');
}

async function fecharComPresidente(sessao, respostas, sinal) {
  status('O Presidente está fechando o resumo');
  marcar('presidente', 'falando');
  const anterior = respostas ? sessao.briefing : '';
  const r = await chamar(PRESIDENTE, msgPresidente(sessao.ideia, sessao.material, respostas, anterior), 1000, sinal, () => status('Aguardando liberar o limite gratuito'));
  marcar('presidente', 'feito', r.provedor); somar(r);
  Object.assign(sessao, separar(r.texto));
  sessao.presidente = `${r.provedor}, ${r.modelo}`;
}

function mostrarResultado(s) {
  $('resumo').textContent = s.resumo;
  $('briefing').textContent = s.briefing;
  $('medida').textContent = `Tamanho: cerca de ${milhar(estimar(s.briefing))} tokens para o Claude ler, contra ${milhar(estimar(s.material))} do debate inteiro.`;
  $('resultado').hidden = false;
}

function salvar(s) {
  historico = [s, ...historico.filter(x => x.id !== s.id)].slice(0, 30);
  guardar('ci-historico', historico);
  desenharHistorico();
}

function ocupado(sim) {
  $('iniciar').disabled = sim; $('refazer').disabled = sim;
  $('parar').hidden = !sim;
}

async function iniciar(ideia, modo) {
  controle = new AbortController();
  const sinal = controle.signal;
  gasto = 0;
  const s = atual = { id: Date.now(), data: new Date().toISOString(), ideia, modo, falas: [] };
  $('falas').textContent = ''; $('debate').hidden = false; $('resultado').hidden = true; $('consumo').textContent = '';
  LUGARES.forEach(l => marcar(l.id, null, ''));
  ocupado(true);
  try {
    const propostas = await rodada(s, 1, 'Cada IA dá sua opinião', CONSELHO, l => msgOpiniao(l, ideia), 700, sinal);
    if (propostas.length < 2) throw new ErroConselho('poucas');

    // Letras embaralhadas: ninguém sabe de quem é cada proposta (ideia do llm-council).
    const anonimas = embaralhar(propostas).map((p, i) => ({ ...p, letra: 'ABC'[i] }));
    const legenda = 'Letras nesta rodada: ' + anonimas.map(a => `${a.letra} = ${a.lugar.nome}`).join(', ');
    const criticas = await rodada(s, 2, 'Criticam as propostas umas das outras, sem saber de quem são',
      propostas.map(p => p.lugar), l => msgCritica(l, ideia, anonimas.filter(a => a.lugar !== l)), 350, sinal);
    const f = { etapa: 2, nome: 'Quem é quem', cor: 'var(--linha)', texto: legenda };
    s.falas.push(f); novaFala(f);

    let replicas = [];
    if (modo === 'completo') {
      const todasCriticas = criticas.map(c => c.texto).join('\n---\n');
      replicas = await rodada(s, 3, 'Respondem às críticas e dizem se há consenso',
        propostas.map(p => p.lugar), l => msgReplica(l, ideia, propostas.find(p => p.lugar === l).texto, todasCriticas), 350, sinal);
    }
    s.material = montarMaterial(propostas, criticas, replicas);
    await fecharComPresidente(s, '', sinal);
    s.gasto = gasto;
    mostrarResultado(s); salvar(s);
    status('Debate encerrado');
    $('resultado').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'auto' : 'smooth' });
  } catch (e) {
    LUGARES.forEach(l => { if ($('lugar-' + l.id).classList.contains('falando')) marcar(l.id, null); });
    if (sinal.aborted) status('Debate parado');
    else status('Debate interrompido: poucas IAs responderam. Espere alguns minutos e tente de novo, ou adicione chaves em Conexões.');
  } finally { ocupado(false); }
}

async function refazer() {
  const pedido = $('respostas').value.trim();
  if (!atual || !pedido) { avisar('Escreva sua resposta antes de refazer.'); return; }
  controle = new AbortController();
  ocupado(true);
  try {
    await fecharComPresidente(atual, pedido, controle.signal);
    atual.gasto = gasto;
    mostrarResultado(atual); salvar(atual);
    $('respostas').value = ''; status('Resumo refeito'); avisar('Resumo refeito.');
  } catch (e) {
    marcar('presidente', 'erro');
    status(controle.signal.aborted ? 'Parado' : 'O Presidente não respondeu. Espere alguns minutos e toque em Refazer resumo.');
  } finally { ocupado(false); }
}

// ---------- Histórico ----------
function abrirSessao(s) {
  atual = s; gasto = s.gasto || 0;
  $('ideia').value = s.ideia;
  $('falas').textContent = ''; $('debate').hidden = false;
  let etapa = 0;
  const nomes = { 1: 'Cada IA dá sua opinião', 2: 'Criticam as propostas umas das outras, sem saber de quem são', 3: 'Respondem às críticas e dizem se há consenso' };
  s.falas.forEach(f => { if (f.etapa !== etapa) { etapa = f.etapa; novaEtapa(nomes[etapa]); } novaFala(f); });
  somar({});
  mostrarResultado(s);
  trocarTela('conselho'); status('Debate salvo');
}
function desenharHistorico() {
  const ul = $('lista-historico'); ul.textContent = '';
  $('historico-vazio').hidden = historico.length > 0;
  historico.forEach(s => {
    const li = document.createElement('li');
    const a = document.createElement('button'); a.className = 'abrir';
    a.textContent = s.ideia.slice(0, 90);
    const d = document.createElement('small'); d.textContent = new Date(s.data).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    a.append(d); a.onclick = () => abrirSessao(s);
    const x = document.createElement('button'); x.className = 'secundario'; x.textContent = 'Apagar';
    x.setAttribute('aria-label', 'Apagar debate: ' + s.ideia.slice(0, 40));
    x.onclick = () => { historico = historico.filter(h => h.id !== s.id); guardar('ci-historico', historico); desenharHistorico(); };
    li.append(a, x); ul.append(li);
  });
}

// ---------- Conexões ----------
async function testar(id, saida) {
  saida.textContent = 'Testando...';
  try {
    const modelo = (await modelosDe(id))[0];
    const r = await chamarUma(id, modelo, [{ role: 'user', content: 'Responda só: ok' }], 200, new AbortController().signal);
    saida.textContent = `Funcionando: ${modelo}` + (r.texto ? '' : '');
  } catch (e) {
    saida.textContent = e.status === 401 || e.status === 403 ? 'Chave recusada. Confira se copiou inteira.'
      : e.status === 429 ? 'Limite gratuito atingido agora. A chave parece certa; tente mais tarde.'
      : 'Não respondeu agora. Tente de novo em alguns minutos.';
  }
}
function desenharProvedores() {
  const caixa = $('provedores'); caixa.textContent = '';
  Object.entries(PROVEDORES).forEach(([id, p]) => {
    const div = document.createElement('div'); div.className = 'provedor';
    const h = document.createElement('h3'); h.textContent = p.nome;
    const t = document.createElement('p'); t.textContent = p.forte;
    div.append(h, t);
    const linha = document.createElement('div'); linha.className = 'linha-chave';
    const saida = document.createElement('span'); saida.className = 'situacao';
    if (p.chave) {
      const input = document.createElement('input'); input.type = 'password'; input.autocomplete = 'off';
      input.value = chaves[id] || ''; input.placeholder = 'Cole a chave aqui'; input.setAttribute('aria-label', 'Chave de ' + p.nome);
      input.onchange = () => { chaves[id] = input.value.trim(); if (!chaves[id]) delete chaves[id]; guardar('ci-chaves', chaves); delete descobertos[id]; saida.textContent = chaves[id] ? 'Chave salva.' : 'Chave removida.'; };
      const a = document.createElement('a'); a.className = 'secundario'; a.href = p.pegar; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Pegar chave grátis';
      linha.append(input, a);
    }
    const b = document.createElement('button'); b.className = 'secundario'; b.textContent = 'Testar';
    b.onclick = () => { if (p.chave && !chaves[id]) { saida.textContent = 'Cole a chave antes de testar.'; return; } testar(id, saida); };
    linha.append(b); div.append(linha, saida); caixa.append(div);
  });
}

// ---------- Navegação e início ----------
function trocarTela(nome) {
  document.querySelectorAll('.tela').forEach(t => { t.hidden = t.id !== 'tela-' + nome; });
  document.querySelectorAll('.aba').forEach(b => b.classList.toggle('ativa', b.dataset.tela === nome));
}
function ligar() {
  montarMesa(); desenharProvedores(); desenharHistorico();
  document.querySelectorAll('.aba').forEach(b => { b.onclick = () => trocarTela(b.dataset.tela); });
  $('form-ideia').onsubmit = e => {
    e.preventDefault();
    const ideia = $('ideia').value.trim();
    if (ideia) iniciar(ideia, document.querySelector('[name=modo]:checked').value);
  };
  $('parar').onclick = () => controle?.abort();
  $('refazer').onclick = refazer;
  $('copiar').onclick = async () => {
    try { await navigator.clipboard.writeText($('briefing').textContent); avisar('Pedido copiado. Agora cole no Claude.'); }
    catch (e) {
      const r = document.createRange(); r.selectNodeContents($('briefing'));
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      avisar('Texto selecionado. Pressione Ctrl+C para copiar.');
    }
  };
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
}
ligar();
