# ============================================================================
# IT.FM — Segmentos com ducking real (Liquidsoap custom)
# ----------------------------------------------------------------------------
# Injetado em backend_config.custom_config pelo provision.mjs.
#
# Ao contrário do scheduler do AzuraCast (que SUSPENDE a música enquanto o clip
# toca), aqui:
#   - a MÚSICA da rotação (`radio`) CONTINUA por baixo, reduzida a 50%;
#   - o SEGMENTO (trânsito / meteo / tech ao minuto) toca por cima, +30%;
#   - o BED "Breaking News" entra por baixo (Tech 30% · Trânsito/Meteo 20%)
#     e faz fade, acabando ~1s depois do segmento.
#
# Agendamento próprio (as playlists de segmentos ficam DESATIVADAS no AzuraCast):
#   - um thread verifica a hora local a cada 2s;
#   - ao minuto :30, se a hora tiver segmento e ainda não disparou nesta hora,
#     empurra o clip para uma fila (toca UMA vez) e faz o ducking;
#   - o fim é agendado pela DURAÇÃO do clip (determinístico), repondo a música.
# Re-arma sozinho todos os dias (o guard reinicia quando o minuto sai de :30).
#
# Os anúncios de topo de hora e os jingles continuam geridos pelo AzuraCast.
# ============================================================================

let MEDIA = "{{MEDIA_DIR}}"

# --- Durações dos clips (lidas uma vez no arranque) -------------------------
def safe_dur(p) =
  d = request.duration(p) ?? -1.
  if d > 0. then d else 30. end
end
dur_transito = safe_dur("#{MEDIA}/segmentos/transito.mp3")
dur_meteo    = safe_dur("#{MEDIA}/segmentos/meteo.mp3")
dur_tech     = safe_dur("#{MEDIA}/segmentos/tech_ao_minuto.mp3")

# --- Filas e volumes controláveis ao vivo -----------------------------------
seg_q = request.queue(id="itfm_seg_queue")
bed_q = request.queue(id="itfm_bed_queue")

music_vol = ref(1.0)   # 1.0 normal · 0.5 durante segmento (ducking)
bed_vol   = ref(0.0)   # 0 parado · 0.30/0.20 durante segmento
seg_gain  = 1.30       # segmento +30%

music = amplify({music_vol()}, radio)
seg   = amplify(seg_gain, seg_q)
bed   = amplify({bed_vol()}, bed_q)

# Mistura final: música (ducked) + segmento (+30%) + bed.
mixed = add(normalize=false, [music, seg, bed])

# --- Mapa hora -> segmento --------------------------------------------------
def seg_file_for_hour(h) =
  if list.mem(h, [7, 9, 14, 17]) then "transito"
  elsif list.mem(h, [8, 11, 13, 15, 18, 20, 22]) then "meteo"
  elsif list.mem(h, [10, 12, 16, 19, 21, 23]) then "tech_ao_minuto"
  else "" end
end

def dur_for(name) =
  if name == "transito" then dur_transito
  elsif name == "meteo" then dur_meteo
  else dur_tech end
end

def bed_volume_for(name) =
  if name == "tech_ao_minuto" then 0.30 else 0.20 end
end

# --- Ducking / restauro -----------------------------------------------------
def restore_music() =
  thread.run(delay=0.0, {music_vol := 0.70})
  thread.run(delay=0.3, {music_vol := 0.85})
  thread.run(delay=0.6, {music_vol := 1.00})
end

def fire(name) =
  vol = bed_volume_for(name)
  dur = dur_for(name)
  log.important(label="itfm_segments", "INÍCIO #{name} dur=#{dur}s music=0.5 bed=#{vol}")
  music_vol := 0.5
  bed_vol := vol
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

# --- Agendador (flanco em :30, re-arma diariamente) -------------------------
last_fired_hour = ref(-1)

def scheduler() =
  t = time.local()
  if t.min == 30 then
    name = seg_file_for_hour(t.hour)
    if name != "" and last_fired_hour() != t.hour then
      last_fired_hour := t.hour
      fire(name)
    end
  else
    last_fired_hour := -1
  end
end
thread.run(every=2.0, scheduler)

# Reatribui a saída principal.
radio = mixed
