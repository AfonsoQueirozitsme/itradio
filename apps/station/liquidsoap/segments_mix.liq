# ============================================================================
# IT.FM — Segmentos com ducking real (Liquidsoap custom)
# ----------------------------------------------------------------------------
# Injetado em backend_config.custom_config pelo provision.mjs.
#
# Ao contrário do scheduler do AzuraCast (que SUSPENDE a música enquanto o clip
# toca), aqui:
#   - a MÚSICA da rotação (`radio`) CONTINUA por baixo, reduzida a 50%;
#   - o SEGMENTO (trânsito / meteo) toca por cima, +30%;
#   - o BED "Breaking News" entra por baixo (20%) e faz fade, acabando ~1s
#     depois do segmento.
#
# NOTÍCIAS LIVE: fluxo completo com jingles:
#   1. Jingle curto de entrada (bumper)
#   2. Bed de notícias a 10% + voz do noticiário em simultâneo
#   3. Jingle de saída
#   4. Restauro gradual da música
# Usa noticias_voice.mp3 (voz-only, sem bed) se disponível; senão cai no
# boletim pré-produzido (noticias_live.mp3, retrocompatível). A bed corre
# em paralelo via bed_queue. Os ficheiros são reescritos in-place de 3 em 3h
# pelo news-live.mjs e reaproveitados por replay entre gerações.
#
# Agendamento próprio (as playlists de segmentos ficam DESATIVADAS no AzuraCast):
#   - um thread verifica a hora local a cada 2s;
#   - ao minuto :30, se a hora tiver conteúdo e ainda não disparou nesta hora,
#     empurra o clip para uma fila (toca UMA vez) e faz o ducking;
#   - ADICIONALMENTE, ao minuto :00 das horas em NEWS_TOP_OF_HOUR, dispara o
#     boletim no TOPO da hora (como um noticiário clássico de rádio);
#   - o fim é agendado pela DURAÇÃO do clip (determinístico), repondo a música.
# Re-arma sozinho todos os dias (cada guard reinicia quando sai do seu minuto).
#
# Grelha :30 (dia):
#   transito → 7, 9              (só de manhã)
#   meteo    → 8, 11             (manhã) + 15 (uma passagem à tarde)
#   NOTÍCIAS → 10, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 23   (o resto do dia)
# Notícias no TOPO da hora (:00): 19  (boletim das 19h, hora nobre)
#
# Os anúncios de topo de hora e os jingles continuam geridos pelo AzuraCast.
# ============================================================================

let MEDIA = "{{MEDIA_DIR}}"

# --- Durações dos clips fixos (lidas uma vez no arranque) -------------------
def safe_dur(p) =
  d = request.duration(p) ?? -1.
  if d > 0. then d else 30. end
end
dur_transito = safe_dur("#{MEDIA}/segmentos/transito.mp3")
dur_meteo    = safe_dur("#{MEDIA}/segmentos/meteo.mp3")

# ============================================================================
# DJ-MODE — Smart Crossfade (Layer 2)
# ----------------------------------------------------------------------------
# Applies intelligent crossfading between music tracks using the cross()
# operator. This wraps AzuraCast's `radio` source BEFORE segment injection,
# so segments still duck over the (now crossfaded) music stream.
#
# How it works:
#   1. cross() holds the last N seconds of the outgoing track and the first
#      N seconds of the incoming track, then calls our transition function.
#   2. The callback reads per-track BPM metadata and adjusts the blend:
#        - Similar BPM (diff < 10) → long 8s overlap, smooth sinusoidal mix
#        - Moderate diff (10-30)   → standard 6s overlap
#        - Large diff (> 30)       → short 4s transition
#        - No BPM metadata         → default duration (cross_def_dur ref)
#   3. During the overlap, frequency filters prevent "mud":
#        - Outgoing track → low-pass at 6 kHz (clears competing highs)
#        - Incoming track → high-pass at 150 Hz (avoids bass buildup)
#        - Both tracks use sinusoidal volume curves for smooth perception
#   4. Segment/news injection is unaffected: fire() and fire_news() control
#      music_vol / seg_gain / bed_vol refs which sit AFTER the crossfade.
#
# Tuneable parameters (change and redeploy, or adjust via Liquidsoap telnet):
#   cross_max_dur  — maximum overlap window in seconds (default 8.0)
#   cross_def_dur  — default fade when no BPM info (ref, default 6.0)
#   cross_lpf_freq — low-pass cutoff on outgoing track in Hz (default 6000.)
#   cross_hpf_freq — high-pass cutoff on incoming track in Hz (default 150.)
#
# FALLBACK: If DJ crossfade causes startup issues, comment out the single
# line `radio = cross(...)` below. AzuraCast's default transitions will be
# used instead and everything else (segments, news, ducking) keeps working.
# ============================================================================

cross_max_dur  = 8.0
cross_def_dur  = ref(6.0)
cross_lpf_freq = 6000.
cross_hpf_freq = 150.

def dj_crossfade(a, b) =
  # Detect jingles/sweepers: short tracks (< 20s) or paths containing "jingle"/"sweeper".
  # These should NOT get a long crossfade — use a quick 0.5s fade instead.
  old_dur_s = list.assoc(default="0", "duration", a.metadata)
  new_dur_s = list.assoc(default="0", "duration", b.metadata)
  old_dur = float_of_string(default=0., old_dur_s)
  new_dur = float_of_string(default=0., new_dur_s)
  old_path = list.assoc(default="", "filename", a.metadata)
  new_path = list.assoc(default="", "filename", b.metadata)

  is_short = (old_dur > 0. and old_dur < 20.) or (new_dur > 0. and new_dur < 20.)
  is_jingle = string.contains(substring="jingle", old_path) or
              string.contains(substring="jingle", new_path) or
              string.contains(substring="sweeper", old_path) or
              string.contains(substring="sweeper", new_path)

  if is_short or is_jingle then
    log.info(label="itfm_dj",
      "jingle/short detected (dur=#{old_dur_s}->#{new_dur_s}) — quick cut (0.5s)")
    a_out = fade.out(duration=0.5, type="lin", a.source)
    b_in  = fade.in(duration=0.5, type="lin", b.source)
    add(normalize=false, [a_out, b_in])
  else
    # Read BPM from track metadata (set by AzuraCast tags or music-build).
    old_bpm_s = list.assoc(default="0", "bpm", a.metadata)
    new_bpm_s = list.assoc(default="0", "bpm", b.metadata)
    old_bpm   = float_of_string(default=0., old_bpm_s)
    new_bpm   = float_of_string(default=0., new_bpm_s)

    # Absolute BPM difference — determines transition length.
    raw_diff = old_bpm - new_bpm
    bpm_diff = if raw_diff < 0. then 0. - raw_diff else raw_diff end

    fade_dur =
      if old_bpm > 1. and new_bpm > 1. then
        if bpm_diff < 10. then 8.
        elsif bpm_diff < 30. then 6.
        else 4.
        end
      else
        cross_def_dur()
      end

    log.info(label="itfm_dj",
      "crossfade: BPM #{old_bpm_s}->#{new_bpm_s} diff=#{bpm_diff} fade=#{fade_dur}s")

    # Outgoing track: sinusoidal fade-out + low-pass to clear competing highs.
    a_out = fade.out(duration=fade_dur, type="sin", a.source)
    a_out = filter.iir.butterworth.low(frequency=cross_lpf_freq, order=2, a_out)

    # Incoming track: sinusoidal fade-in + high-pass to prevent bass mud.
    b_in = fade.in(duration=fade_dur, type="sin", b.source)
    b_in = filter.iir.butterworth.high(frequency=cross_hpf_freq, order=2, b_in)

    # Mix both streams during the overlap.
    add(normalize=false, [a_out, b_in])
  end
end

# Apply DJ crossfade to the music stream. cross() detects track boundaries
# in AzuraCast's `radio` source and calls our transition function.
# Segments/news are injected AFTER this, so they are unaffected.
radio = cross(duration=cross_max_dur, dj_crossfade, radio)

# --- Filas e volumes controláveis ao vivo -----------------------------------
seg_q = request.queue(id="itfm_seg_queue")
bed_q = request.queue(id="itfm_bed_queue")

music_vol = ref(1.0)   # 1.0 normal · 0.5 segmento · 0.18 notícias (ducking)
bed_vol   = ref(0.0)   # 0 parado · 0.20 durante segmento (não usado nas notícias)
seg_gain  = ref(1.30)  # 1.30 segmento (+30%) · 1.0 notícias (já a -16 LUFS)

music = amplify({music_vol()}, radio)
seg   = amplify({seg_gain()}, seg_q)
bed   = amplify({bed_vol()}, bed_q)

# Mistura final: música (ducked) + segmento/notícias + bed.
mixed = add(normalize=false, [music, seg, bed])

# --- Mapa hora -> conteúdo :30 ----------------------------------------------
def seg_file_for_hour(h) =
  if list.mem(h, [7, 9]) then "transito"
  elsif list.mem(h, [8, 11, 15]) then "meteo"
  elsif list.mem(h, [10, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 23]) then "news"
  else "" end
end

# Horas com notícias no TOPO da hora (minuto :00). O boletim das 19h é o de
# hora nobre; o das 19:30 (grelha acima) mantém-se, como numa rádio a sério.
def news_top_of_hour(h) =
  list.mem(h, [19])
end

def dur_for(name) =
  if name == "transito" then dur_transito else dur_meteo end
end

# --- Ducking / restauro -----------------------------------------------------
def restore_music() =
  thread.run(delay=0.0, {music_vol := 0.70})
  thread.run(delay=0.3, {music_vol := 0.85})
  thread.run(delay=0.6, {music_vol := 1.00})
end

# Segmento clássico (transito/meteo): voz crua +30%, bed por baixo a 20%.
def fire(name) =
  dur = dur_for(name)
  log.important(label="itfm_segments", "INÍCIO #{name} dur=#{dur}s music=0.5 bed=0.20")
  seg_gain := 1.30
  music_vol := 0.5
  bed_vol := 0.20
  ignore(seg_q.push(request.create("#{MEDIA}/segmentos/#{name}.mp3")))
  ignore(bed_q.push(request.create("#{MEDIA}/beds/news_bed.mp3")))
  # Fim do segmento (pela duração): repõe a música.
  thread.run(delay=dur + 0.2, {restore_music()})
  # Bed acaba ~1s depois do segmento, com fade.
  thread.run(delay=dur + 0.2, {bed_vol := bed_vol() * 0.6})
  thread.run(delay=dur + 0.5, {bed_vol := bed_vol() * 0.4})
  thread.run(delay=dur + 0.9, {bed_vol := 0.0})
  thread.run(delay=dur + 1.1, {bed_q.skip()})
  log.important(label="itfm_segments", "fim agendado para +#{dur + 0.2}s")
end

# Notícias live com jingles e bed separada.
# Fluxo: jingle entrada → bed a 10% + voz → jingle saída → restauro.
# A voz sem bed (noticias_voice.mp3) é gerada pelo news-live.mjs ao lado do
# boletim pré-mixado. Se o ficheiro voice-only não existir, cai no boletim
# pré-produzido antigo (retrocompatível).
#
# Jingles: usa jingle_news_in/out.mp3 se existirem, senão jingle_1.mp3.
def news_jingle_in() =
  p = "#{MEDIA}/jingles/jingle_news_in.mp3"
  if file.exists(p) then p else "#{MEDIA}/jingles/jingle_1.mp3" end
end
def news_jingle_out() =
  p = "#{MEDIA}/jingles/jingle_news_out.mp3"
  if file.exists(p) then p else "#{MEDIA}/jingles/jingle_1.mp3" end
end
def news_jingle_dur(p) =
  d = request.duration(p) ?? -1.
  if d > 0. then d else 5. end
end

def fire_news() =
  voice_p = "#{MEDIA}/programas/noticias_voice.mp3"
  mixed_p = "#{MEDIA}/programas/noticias_live.mp3"
  has_voice = file.exists(voice_p)
  p = if has_voice then voice_p else mixed_p end
  dur = request.duration(p) ?? 30.

  jin = news_jingle_in()
  jout = news_jingle_out()
  jin_dur = news_jingle_dur(jin)
  jout_dur = news_jingle_dur(jout)
  total = jin_dur + dur + jout_dur

  log.important(label="itfm_segments",
    "INÍCIO noticias: jingle_in=#{jin_dur}s voz=#{dur}s jingle_out=#{jout_dur}s total=#{total}s voice_only=#{has_voice}")

  # 1. Duck music to 10%
  music_vol := 0.10
  seg_gain := 1.0

  # 2. Queue: jingle-in → voice/bulletin → jingle-out (FIFO)
  ignore(seg_q.push(request.create(jin)))
  ignore(seg_q.push(request.create(p)))
  ignore(seg_q.push(request.create(jout)))

  # 3. News bed at 10%, starts with the jingle (bed_queue is parallel)
  if has_voice then
    bed_vol := 0.10
    ignore(bed_q.push(request.create("#{MEDIA}/beds/news_bed.mp3")))
  else
    # Pre-mixed bulletin already has bed baked in
    bed_vol := 0.0
  end

  # 4. Schedule restore after all segments finish
  # Bed fades out during the outro jingle
  thread.run(delay=jin_dur + dur + 0.2, {
    bed_vol := 0.06
  })
  thread.run(delay=jin_dur + dur + jout_dur * 0.5, {
    bed_vol := 0.03
  })
  thread.run(delay=total + 0.2, {
    bed_vol := 0.0
    bed_q.skip()
  })
  # Restore music after everything
  thread.run(delay=total + 0.5, {restore_music()})

  log.important(label="itfm_segments", "fim noticias agendado para +#{total + 0.5}s")
end

# --- Agendador (flancos :00 e :30, re-arma diariamente) ---------------------
# Gatilho manual: `touch #{MEDIA}/.itfm_fire_news` dispara JÁ um boletim de
# notícias (com ducking), sem esperar pela grelha e SEM restart — o ficheiro é
# consumido (removido) no disparo. Útil p/ testes/demo on-air.
fire_trigger = "#{MEDIA}/.itfm_fire_news"
last_fired_hour = ref(-1)   # guard do flanco :30
last_fired_top  = ref(-1)   # guard do flanco :00 (notícias de topo de hora)

def scheduler() =
  t = time.local()
  # gatilho manual (ficheiro-sentinela) → dispara notícias já
  if file.exists(fire_trigger) then
    ignore(file.remove(fire_trigger))
    log.important(label="itfm_segments", "gatilho manual → fire_news()")
    fire_news()
  end
  # Notícias no TOPO da hora (:00), guard próprio.
  if t.min == 0 then
    if last_fired_top() != t.hour and news_top_of_hour(t.hour) then
      last_fired_top := t.hour
      log.important(label="itfm_segments", "topo de hora → fire_news() (#{t.hour}h)")
      fire_news()
    end
  else
    last_fired_top := -1
  end
  # Grelha :30 (segmentos + notícias), guard próprio.
  if t.min == 30 then
    if last_fired_hour() != t.hour then
      name = seg_file_for_hour(t.hour)
      if name == "news" then
        last_fired_hour := t.hour
        fire_news()
      elsif name != "" then
        last_fired_hour := t.hour
        fire(name)
      end
    end
  else
    last_fired_hour := -1
  end
end
thread.run(every=2.0, scheduler)

# Reatribui a saída principal.
radio = mixed
