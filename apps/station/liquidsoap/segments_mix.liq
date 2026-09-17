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
# NOTÍCIAS LIVE (programas/noticias_live.mp3): é um boletim PRÉ-PRODUZIDO
# (voz + bed já mixados a -16 LUFS), por isso NÃO leva o bed extra nem o +30%;
# a música desce bem mais (0.18) e o boletim toca por cima, limpo, como um
# noticiário. O ficheiro é reescrito in-place de 3 em 3h (news-live.mjs) e
# reaproveitado por replay entre gerações.
#
# Agendamento próprio (as playlists de segmentos ficam DESATIVADAS no AzuraCast):
#   - um thread verifica a hora local a cada 2s;
#   - ao minuto :30, se a hora tiver conteúdo e ainda não disparou nesta hora,
#     empurra o clip para uma fila (toca UMA vez) e faz o ducking;
#   - o fim é agendado pela DURAÇÃO do clip (determinístico), repondo a música.
# Re-arma sozinho todos os dias (o guard reinicia quando o minuto sai de :30).
#
# Grelha :30 (dia):
#   transito → 7, 9              (só de manhã)
#   meteo    → 8, 11             (manhã) + 15 (uma passagem à tarde)
#   NOTÍCIAS → 10, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 23   (o resto do dia)
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

# Notícias live: boletim pré-produzido (voz+bed a -16). Sem bed extra, sem +30%.
# Duração lida a cada disparo (o ficheiro muda de 3 em 3h).
def fire_news() =
  p = "#{MEDIA}/programas/noticias_live.mp3"
  dur = request.duration(p) ?? 30.
  log.important(label="itfm_segments", "INÍCIO noticias dur=#{dur}s music=0.18 (self-bed)")
  seg_gain := 1.0
  bed_vol := 0.0
  music_vol := 0.18
  ignore(seg_q.push(request.create(p)))
  # Fim do boletim (pela duração): repõe a música.
  thread.run(delay=dur + 0.3, {restore_music()})
  log.important(label="itfm_segments", "fim noticias agendado para +#{dur + 0.3}s")
end

# --- Agendador (flanco em :30, re-arma diariamente) -------------------------
# Gatilho manual: `touch #{MEDIA}/.itfm_fire_news` dispara JÁ um boletim de
# notícias (com ducking), sem esperar pelo :30 e SEM restart — o ficheiro é
# consumido (removido) no disparo. Útil p/ testes/demo on-air.
fire_trigger = "#{MEDIA}/.itfm_fire_news"
last_fired_hour = ref(-1)

def scheduler() =
  t = time.local()
  # gatilho manual (ficheiro-sentinela) → dispara notícias já
  if file.exists(fire_trigger) then
    ignore(file.remove(fire_trigger))
    log.important(label="itfm_segments", "gatilho manual → fire_news()")
    fire_news()
  end
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
