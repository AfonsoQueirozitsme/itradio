/**
 * lib/programs.mjs — FONTE ÚNICA dos programas da IT.FM.
 *
 * Hoje o array vive inline em build-programacao.mjs; passa a viver aqui para o
 * serviço de música e o builder partilharem a mesma verdade (slug, janela,
 * género). Os campos `dir`/`locutor`/`genero` mantêm o shape do build atual (para
 * um futuro refactor importar daqui sem mudança de comportamento); os campos de
 * música (`ytGenre*`, `poolSize`, `poolCap`, `minDur`, `maxDur`) são novos.
 *
 * `poolSize` = faixas NOVAS a acrescentar por refresh; `poolCap` = TETO da pool
 * no ar (o deploy retira as mais antigas acima do teto → rotação, não crescimento
 * infinito). Sem `poolCap`, assume-se DEFAULT_POOL_CAP.
 *
 * `ytGenre` é o rótulo a procurar em `ytmusicapi.get_mood_categories()`; como os
 * rótulos exatos podem variar, o select.py faz match por substring e cai para
 * `ytGenreAlts` (por ordem) — e, em último recurso, para charts.
 *
 * Janela: [inicio, fim) em horas locais de Lisboa. A música toca 24/7 na sua
 * janela; a madrugada (23–07) é coberta à parte pelo deployer da programação.
 *
 * `windows` (opcional): lista de [inicioHHMM, fimHHMM] quando a janela NÃO é um
 * bloco contíguo de horas inteiras — ex.: um programa modular curto (Tuga
 * Underground 12:00–12:30) obriga o programa anfitrião a ceder essa meia-hora,
 * ficando com duas janelas. Sem `windows`, assume-se [[hhmm(inicio), hhmm(fim)]].
 */
export const PROGRAMS = [
  {
    dir: "BootMatinal_DiogoSilva", nome: "Boot Matinal", locutor: "Diogo Silva", slug: "diogo_silva",
    genero: "rock", inicio: 7, fim: 10,
    vibe: "Rock dos anos 2000. Linkin Park, Foo Fighters, Green Day, The Killers, Muse, RHCP, Nickelback, 3 Doors Down, Hoobastank, Sum 41. Alternative rock, post-grunge, pop-punk da era 2000-2010. Energia de manhã — nada demasiado pesado (sem metal extremo), mas com atitude e riffs.",
    ytGenre: "Best Rock Songs 2000s", ytGenreAlts: ["Rock Hits 2000s", "2000s Rock Anthems", "Most Popular Rock Songs", "Rock Classics 2000s"],
    poolSize: 20, poolCap: 60, minDur: 120, maxDur: 360,
    djMode: true,
  },
  {
    dir: "CtrlAltRitmo_SofiaMartins", nome: "Ctrl+Alt+Ritmo", locutor: "Sofia Martins", slug: "sofia_martins",
    genero: "techno", inicio: 10, fim: 13,
    vibe: "Techno comercial e groovy. Fisher, Chris Lake, Dom Dolla, Solardo, CamelPhat, Rüfüs Du Sol, Anyma, Meduza, Gorgon City. Tech-house com groove, não techno industrial/underground. O beat tem de ser dançável e acessível — aquele techno que passam nos festivais mainstream (Tomorrowland, Ultra) mas com groove e soul, não pancada seca. Bass house e melodic techno também encaixam.",
    windows: [[1000, 1200], [1230, 1300]],
    ytGenre: "Best Tech House", ytGenreAlts: ["Top Tech House 2026", "Tech House Hits", "Commercial House Music", "Trending House Music"],
    poolSize: 20, poolCap: 60, minDur: 120, maxDur: 360,
    djMode: true,
  },
  {
    dir: "TugaUnderground", nome: "Tuga Underground", locutor: "Sofia Martins", slug: "tuga_underground",
    genero: "hiphop", inicio: 12, fim: 13,
    vibe: "Meia-hora dedicada ao rap português underground. Boom bap, líricas cruas, beats pesados. Sem pop português, sem kizomba. Artistas de nicho, mixtapes, freestyles.",
    windows: [[1200, 1230]],
    ytGenre: "Rap Tuga 2026",
    ytGenreAlts: ["Hip Hop Tuga", "Rap Português", "Rap Tuga Trending", "Melhores Rap Tuga"],
    poolSize: 10, poolCap: 30, minDur: 120, maxDur: 360,
    djMode: true,
  },
  {
    dir: "Pause&Play_TomasRocha", nome: "Pause & Play", locutor: "Tomás Rocha", slug: "tomas_rocha",
    genero: "house", inicio: 13, fim: 16,
    vibe: "Tarde relaxada, indie & alternative. Faixas com personalidade: indie rock, dream pop, shoegaze acessível, alt-pop. O ouvinte está a trabalhar com fones — quer descobertas sem choques. Nada pesado nem demasiado pop genérico.",
    ytGenre: "Indie Hits", ytGenreAlts: ["Best Indie Songs", "Indie Pop Hits", "Popular Indie Music", "Trending Indie"],
    poolSize: 20, poolCap: 60, minDur: 120, maxDur: 360,
    djMode: true,
  },
  {
    dir: "HoraDePonta_BeatrizLima", nome: "Hora de Ponta", locutor: "Beatriz Lima", slug: "beatriz_lima",
    genero: "pop", inicio: 16, fim: 20,
    vibe: "Pop & hits atuais para o drive time. Dua Lipa, The Weeknd, Doja Cat, SZA, Sabrina Carpenter, Olivia Rodrigo, Harry Styles, Bad Bunny, Billie Eilish, Miley Cyrus, Tate McRae, Beyoncé, Bruno Mars, Charlie XCX. Os maiores hits de 2022-2026, pop mainstream com produção forte. Energia positiva, toda a gente conhece — zero obscuridades. Nada antes de 2020 (isto não é throwback).",
    ytGenre: "Top Hits 2026", ytGenreAlts: ["Most Popular Songs 2026", "Trending Music", "Best Pop Songs", "Viral Hits"],
    poolSize: 20, poolCap: 60, minDur: 120, maxDur: 360,
    djMode: true,
  },
  {
    dir: "ModoNoturno_GoncaloPires", nome: "Modo Noturno", locutor: "Gonçalo Pires", slug: "goncalo_pires",
    genero: "ecletico", inicio: 20, fim: 23,
    vibe: "Mix eclético noturno: pop-rap groovy + funk/disco + afrobeats quentes. Anderson .Paak, Tyler The Creator, Childish Gambino, Daft Punk, Jamiroquai, Purple Disco Machine, Chromeo, Burna Boy, Wizkid, Tems, Frank Ocean, Pharrell, Mac Miller, Kaytranada, Jungle. Começa groovy e soulful, sobe ao pico, fecha com vibes quentes e melódicas. Produção elegante, artistas com personalidade — nada genérico. O ouvinte está a curtir a noite, não a dormir.",
    ytGenre: "Best Funk Disco Songs", ytGenreAlts: ["Afrobeats Hits", "Popular Funk Music", "Trending Afrobeats 2026", "Best R&B Groovy"],
    poolSize: 20, poolCap: 60, minDur: 120, maxDur: 360,
    djMode: true,
  },
];

/** Teto por omissão da pool no ar (faixas), quando o programa não define `poolCap`. */
export const DEFAULT_POOL_CAP = 60;

/** Programa por slug (ou undefined). */
export const programBySlug = (slug) => PROGRAMS.find((p) => p.slug === slug);

/** Teto da pool no ar do programa (faixas a manter; as mais antigas saem). */
export const programPoolCap = (p) => p.poolCap ?? DEFAULT_POOL_CAP;

/** Janela HHMM (ex.: 7 → 700, 20 → 2000) para schedule_items. */
export const hhmm = (hour) => hour * 100;

/**
 * Janelas de agendamento do programa como lista de [inicioHHMM, fimHHMM].
 * Usa `windows` se existir (programas com janela partida); senão deriva o bloco
 * contíguo [hhmm(inicio), hhmm(fim)]. Fonte única para schedule_items + colisões.
 */
export const programWindows = (p) => p.windows ?? [[hhmm(p.inicio), hhmm(p.fim)]];
