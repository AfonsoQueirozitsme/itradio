// Dados dos Locutores (vozes virtuais da estação — TTS clonadas ElevenLabs,
// não humanos). SEAM de ligação — LIGADO (overlay LEVE sobre o MOCK: só `estado`
// e `horasNoArDia` são dinâmicos, derivados da grelha; voiceId mascarado, bio,
// modelo, settings e quota ficam mock — sem HTTP ElevenLabs, sem .env). Contrato
// e MOCK ficam FIXOS. Fontes reais (ver mapa do apps/station):
//   locutores (notícias) → apps/station/news-live.mjs: vozes clonadas
//        NEWS_VOICE_A (Ruben Mateus) / NEWS_VOICE_B (Mariana Serrano); tts() faz
//        POST https://api.elevenlabs.io/v1/text-to-speech/{voiceId}; EL_MODEL
//        default eleven_turbo_v2_5 (turbo/flash = 0.5 créd/car, senão 1×);
//        EL_SETTINGS {stability:0.5, similarity_boost:0.8, style:0.0,
//        use_speaker_boost:true}; EL_OUTPUT mp3_44100_128; bake NORM {I:-16,
//        TP:-1.5, LRA:11} → "-16 LUFS".
//   quota            → elQuota() em news-live.mjs: GET /v1/user/subscription →
//        {character_count, character_limit} → usados/limite/restantes (Starter).
//   locutores (programa) → apps/station/lib/programs.mjs (PROGRAMS[] + janelas
//        via programWindows(), horas de Lisboa) dá o mapa locutor↔programa; hoje
//        a voz de cada programa é CLIP PRÉ-GERADO (ver build-programacao.mjs:
//        toca seca, sem bed; clips vêm de ~/Downloads/AudioNovo/), NÃO via API —
//        por isso as VOICE_* de programa são bindings PROPOSTOS.
//   fotos            → guardadas FORA do git (via sharp, quando ligado) sob a
//        data dir do host (ex.: /home/itradio/itfm-data). Mock: fotoUrl null.
// NB: janelas em horas de Lisboa (host/container em UTC → converter na ligação).
// Segredos (.env: ELEVENLABS_API_KEY, NEWS_VOICE_A/B) NUNCA são geridos aqui;
// os voice IDs reais (~20 chars alnum) aparecem SEMPRE mascarados (el_••••••XXX).

import { lisbonNow } from "./azuracast-read";
import { GRELHA, noArAgora } from "./grelha";

export type LocutorEstado = "no_ar" | "ativo" | "em_pausa" | "rascunho";
// tons StatusChip: no_ar→"live" (ping), ativo→"ok", em_pausa→"warn", rascunho→"neutral"

export type VoiceSettings = {
  stability: number; // 0.5   (EL_SETTINGS em news-live.mjs)
  similarity: number; // 0.8  (similarity_boost)
  style: number; // 0.0
  speakerBoost: boolean; // true (use_speaker_boost)
};

export type LocutorSample = {
  texto: string; // frase de exemplo
  dur: number; // segundos (duração do sample)
  ficheiro?: string; // path relativo (ex.: "samples/tomas_rocha.mp3"); sem ficheiro → player simulado
};

export type Locutor = {
  slug: string; // "tomas_rocha"
  nome: string;
  iniciais: string; // "RN" — avatar = círculo bg-[var(--ink)] com iniciais (SEM foto real)
  fotoUrl: string | null; // sempre null no mock (fotos ficam fora do git)
  voz: string; // "voz clonada · ElevenLabs" (rótulo fixo do card)
  voiceIdMasked: string; // "el_••••••U0Z" — NUNCA o id real (20 chars alnum no .env)
  envKey: string; // nome da var (não segredo): "NEWS_VOICE_B" / "VOICE_TOMAS_ROCHA"
  modelo: string; // "eleven_turbo_v2_5" (0.5 créd/car) | "eleven_multilingual_v2" (1×)
  settings: VoiceSettings;
  outputFormat: string; // "mp3_44100_128"
  loudness: string; // "-16 LUFS" (bake da estação: I=-16 TP=-1.5 LRA=11)
  programas: string[]; // programas atribuídos (nomes da grelha mock)
  janela: string; // "12:00–16:00" (Lisboa) | ":30 · 07–22" p/ notícias
  horasNoArDia: number; // 4.0
  estado: LocutorEstado;
  bio: string; // 1 frase
  sample: LocutorSample; // preview SIMULADO (play/pause + barra)
  tipo: "programa" | "noticias"; // notícias = co-locução gerada ao vivo
};

export type QuotaEL = {
  plano: string; // "Starter"
  usados: number; // 24600
  limite: number; // 30000 (character_limit de GET /v1/user/subscription)
  restantes: number; // 5400
  restantePct: number; // 18
  nota: string; // "Gerar samples/vozes novas consome o mesmo plafond."
};

export type LocutoresData = { locutores: Locutor[]; quota: QuotaEL };

// settings partilhadas por todas as vozes (EL_SETTINGS de news-live.mjs)
const SETTINGS: VoiceSettings = {
  stability: 0.5,
  similarity: 0.8,
  style: 0.0,
  speakerBoost: true,
};

const MOCK: LocutoresData = {
  locutores: [
    {
      slug: "diogo_silva",
      nome: "Diogo Silva",
      iniciais: "DS",
      fotoUrl: null,
      voz: "voz clonada · ElevenLabs",
      voiceIdMasked: "el_••••••k9r",
      envKey: "VOICE_DIOGO_SILVA",
      modelo: "eleven_turbo_v2_5",
      settings: SETTINGS,
      outputFormat: "mp3_44100_128",
      loudness: "-16 LUFS",
      programas: ["Boot Matinal"],
      janela: "07:00–10:00",
      horasNoArDia: 3.0,
      estado: "ativo",
      bio: "Arranca a manhã com rock e boa energia para pôr a cidade a mexer.",
      sample: { texto: "Bom dia! São 7 horas e isto é o Boot Matinal, na IT.FM.", dur: 11, ficheiro: "samples/rodrigo_neves.mp3" },
      tipo: "programa",
    },
    {
      slug: "sofia_martins",
      nome: "Sofia Martins",
      iniciais: "SM",
      fotoUrl: null,
      voz: "voz clonada · ElevenLabs",
      voiceIdMasked: "el_••••••v3t",
      envKey: "VOICE_SOFIA_MARTINS",
      modelo: "eleven_turbo_v2_5",
      settings: SETTINGS,
      outputFormat: "mp3_44100_128",
      loudness: "-16 LUFS",
      programas: ["Ctrl+Alt+Ritmo", "Tuga Underground"],
      janela: "10:00–13:00",
      horasNoArDia: 3.0,
      estado: "ativo",
      bio: "Dá o ritmo do meio-dia — dança e eletrónica, com salto ao Tuga Underground.",
      sample: { texto: "Ctrl, Alt, Ritmo — arranca o teu meio-dia com a IT.FM.", dur: 9, ficheiro: "samples/sofia_martins.mp3" },
      tipo: "programa",
    },
    {
      slug: "tomas_rocha",
      nome: "Tomás Rocha",
      iniciais: "TR",
      fotoUrl: null,
      voz: "voz clonada · ElevenLabs",
      voiceIdMasked: "el_••••••p6w",
      envKey: "VOICE_TOMAS_ROCHA",
      modelo: "eleven_turbo_v2_5",
      settings: SETTINGS,
      outputFormat: "mp3_44100_128",
      loudness: "-16 LUFS",
      programas: ["Pause & Play"],
      janela: "13:00–16:00",
      horasNoArDia: 3.0,
      estado: "no_ar",
      bio: "Companhia da tarde — o melhor indie e alternativo, sem pressas.",
      sample: { texto: "Boa tarde! São 14 horas e isto é o Pause & Play, com o Tomás Rocha.", dur: 13, ficheiro: "samples/tomas_rocha.mp3" },
      tipo: "programa",
    },
    {
      slug: "beatriz_lima",
      nome: "Beatriz Lima",
      iniciais: "BL",
      fotoUrl: null,
      voz: "voz clonada · ElevenLabs",
      voiceIdMasked: "el_••••••j2n",
      envKey: "VOICE_BEATRIZ_LIMA",
      modelo: "eleven_turbo_v2_5",
      settings: SETTINGS,
      outputFormat: "mp3_44100_128",
      loudness: "-16 LUFS",
      programas: ["Hora de Ponta"],
      janela: "16:00–20:00",
      horasNoArDia: 4.0,
      estado: "ativo",
      bio: "Leva-te a casa na hora de ponta — hip-hop e energia no trânsito.",
      sample: { texto: "Hora de ponta na IT.FM — vamos abrir caminho até casa.", dur: 9, ficheiro: "samples/beatriz_lima.mp3" },
      tipo: "programa",
    },
    {
      slug: "goncalo_pires",
      nome: "Gonçalo Pires",
      iniciais: "GP",
      fotoUrl: null,
      voz: "voz clonada · ElevenLabs",
      voiceIdMasked: "el_••••••z5c",
      envKey: "VOICE_GONCALO_PIRES",
      modelo: "eleven_multilingual_v2",
      settings: SETTINGS,
      outputFormat: "mp3_44100_128",
      loudness: "-16 LUFS",
      programas: ["Modo Noturno"],
      janela: "20:00–23:00",
      horasNoArDia: 3.0,
      estado: "em_pausa",
      bio: "O lado calmo da noite — R&B, soul e conversas em tom baixo.",
      sample: { texto: "Boa noite. Isto é o Modo Noturno, para acalmar o ritmo.", dur: 10, ficheiro: "samples/goncalo_pires.mp3" },
      tipo: "programa",
    },
    {
      slug: "ruben_mateus",
      nome: "Ruben Mateus",
      iniciais: "RM",
      fotoUrl: null,
      voz: "voz clonada · ElevenLabs",
      voiceIdMasked: "el_••••••OHD",
      envKey: "NEWS_VOICE_A",
      modelo: "eleven_turbo_v2_5",
      settings: SETTINGS,
      outputFormat: "mp3_44100_128",
      loudness: "-16 LUFS",
      programas: ["Notícias LIVE"],
      janela: ":30 · 07–22",
      horasNoArDia: 0.2,
      estado: "ativo",
      bio: "Pivot masculino do boletim — alterna manchetes de 3 em 3h.",
      sample: { texto: "IT.FM, notícias. As manchetes desta tarde.", dur: 8, ficheiro: "samples/ruben_mateus.mp3" },
      tipo: "noticias",
    },
    {
      slug: "mariana_serrano",
      nome: "Mariana Serrano",
      iniciais: "MS",
      fotoUrl: null,
      voz: "voz clonada · ElevenLabs",
      voiceIdMasked: "el_••••••U0Z",
      envKey: "NEWS_VOICE_B",
      modelo: "eleven_turbo_v2_5",
      settings: SETTINGS,
      outputFormat: "mp3_44100_128",
      loudness: "-16 LUFS",
      programas: ["Notícias LIVE"],
      janela: ":30 · 07–22",
      horasNoArDia: 0.2,
      estado: "ativo",
      bio: "Pivot feminino — co-locução com o Ruben sobre a news_bed.",
      sample: { texto: "Mais sobre este tema já a seguir, aqui na IT.FM.", dur: 9, ficheiro: "samples/mariana_serrano.mp3" },
      tipo: "noticias",
    },
  ],
  quota: {
    plano: "Starter",
    usados: 24600,
    limite: 30000,
    restantes: 5400,
    restantePct: 18,
    nota: "Gerar samples/vozes novas consome o mesmo plafond.",
  },
};

// HHMM inteiro (700) → minutos do dia (420). Pura, para somar janelas da grelha.
const hhmmToMin = (hhmm: number): number => Math.floor(hhmm / 100) * 60 + (hhmm % 100);

// Horas/dia no ar de um locutor de PROGRAMA = soma das janelas da grelha cujo
// `locutor` é o dele (Lisboa), em horas com 1 casa. Só grelha estática, sem I/O.
function horasNoArDaGrelha(nome: string): number {
  const min = GRELHA.filter((p) => p.locutor === nome).reduce(
    (acc, p) =>
      acc + p.windows.reduce((a, w) => a + (hhmmToMin(w.fimHHMM) - hhmmToMin(w.inicioHHMM)), 0),
    0,
  );
  return Math.round((min / 60) * 10) / 10;
}

export async function getLocutoresData(): Promise<LocutoresData> {
  // OVERLAY LEVE sobre o MOCK: tudo (voz, voiceIdMasked, modelo, settings, bio,
  // sample, quota…) fica baked; só `estado` e `horasNoArDia` refletem o vivo.
  // Sem HTTP nem .env aqui — a grelha (Lisboa) é a única fonte, sempre disponível.
  const clock = lisbonNow();
  const arNaHora = noArAgora(clock.hhmm); // {programa,locutor,genero,ate} — madrugada => locutor "—"

  const locutores = MOCK.locutores.map((L) => {
    // Notícias: estado/horas ficam MOCK (co-locução gerada ao vivo, não da grelha).
    if (L.tipo === "noticias") return L;

    // ── estado — no_ar se este locutor é quem a grelha põe no ar agora; senão
    // "desliga" o on-air do mock (no_ar → ativo) e preserva pausa/rascunho/ativo.
    const onAir = arNaHora.locutor === L.nome;
    const estado: LocutorEstado = onAir ? "no_ar" : L.estado === "no_ar" ? "ativo" : L.estado;

    // ── horasNoArDia — soma real das janelas da grelha deste locutor; 0 (nenhum
    // programa a bater com o nome) → mantém o mock em vez de mostrar 0 h.
    const horas = horasNoArDaGrelha(L.nome);
    const horasNoArDia = horas > 0 ? horas : L.horasNoArDia;

    return { ...L, estado, horasNoArDia };
  });

  return { locutores, quota: MOCK.quota };
}
