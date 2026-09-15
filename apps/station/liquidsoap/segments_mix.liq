# ============================================================================
# IT.FM — Segmentos com ducking real (Liquidsoap custom)
# ----------------------------------------------------------------------------
# Injetado em backend_config.custom_config pelo provision.mjs.
#
# O que faz, ao contrário do scheduler do AzuraCast (que SUSPENDE a música
# enquanto o clip toca):
#   - a MÚSICA da rotação (`radio`) CONTINUA por baixo, reduzida a 50%;
#   - o SEGMENTO (trânsito / meteo / tech ao minuto) toca por cima, +30%;
#   - o BED "Breaking News" entra por baixo (Tech 30% · Trânsito/Meteo 20%)
#     e faz fade de ~1s no fim.
#
# IMPORTANTE: as 3 playlists de segmentos ficam DESATIVADAS no AzuraCast
# (is_enabled=false) — senão tocavam duas vezes. O agendamento passa a ser
# feito aqui, com os MESMOS predicados de horário do AzuraCast (uma vez ao :30).
#
# Os anúncios de topo de hora e os jingles continuam a ser geridos pelo
# AzuraCast (interrompem a música na mesma) — não são afetados por isto.
# ============================================================================

let MEDIA = "{{MEDIA_DIR}}"

# --- Fontes dos segmentos: cada clip toca UMA vez por ativação --------------
# once(single(...)) => carrega o ficheiro e reproduz uma vez; quando termina,
# o source fica indisponível e o switch cai para o ramo seguinte / nada.
def seg_clip(name) =
  once(single("#{MEDIA}/segmentos/#{name}.mp3"))
end

# Agenda: mesmo padrão do AzuraCast — predicate.at_most(1, {minuto :30 na hora})
# garante uma reprodução por ocorrência (não repete dentro do minuto).
segments =
  switch(
    id="itfm_segments",
    track_sensitive=false,
    [
      (predicate.at_most(1, {(30m) and (7h0m-7h59m)}),  seg_clip("transito")),
      (predicate.at_most(1, {(30m) and (9h0m-9h59m)}),  seg_clip("transito")),
      (predicate.at_most(1, {(30m) and (14h0m-14h59m)}), seg_clip("transito")),
      (predicate.at_most(1, {(30m) and (17h0m-17h59m)}), seg_clip("transito")),
      (predicate.at_most(1, {(30m) and (8h0m-8h59m)}),  seg_clip("meteo")),
      (predicate.at_most(1, {(30m) and (11h0m-11h59m)}), seg_clip("meteo")),
      (predicate.at_most(1, {(30m) and (13h0m-13h59m)}), seg_clip("meteo")),
      (predicate.at_most(1, {(30m) and (15h0m-15h59m)}), seg_clip("meteo")),
      (predicate.at_most(1, {(30m) and (18h0m-18h59m)}), seg_clip("meteo")),
      (predicate.at_most(1, {(30m) and (20h0m-20h59m)}), seg_clip("meteo")),
      (predicate.at_most(1, {(30m) and (22h0m-22h59m)}), seg_clip("meteo")),
      (predicate.at_most(1, {(30m) and (10h0m-10h59m)}), seg_clip("tech_ao_minuto")),
      (predicate.at_most(1, {(30m) and (12h0m-12h59m)}), seg_clip("tech_ao_minuto")),
      (predicate.at_most(1, {(30m) and (16h0m-16h59m)}), seg_clip("tech_ao_minuto")),
      (predicate.at_most(1, {(30m) and (19h0m-19h59m)}), seg_clip("tech_ao_minuto")),
      (predicate.at_most(1, {(30m) and (21h0m-21h59m)}), seg_clip("tech_ao_minuto")),
      (predicate.at_most(1, {(30m) and (23h0m-23h59m)}), seg_clip("tech_ao_minuto")),
    ]
  )

# --- Volumes controláveis ao vivo -------------------------------------------
music_vol = ref(1.0)   # música: 1.0 normal, 0.5 durante segmento (ducking)
bed_vol   = ref(0.0)   # bed: 0 parado; 0.30/0.20 durante segmento
seg_gain  = 1.30       # segmento +30%

bed_q = request.queue(id="news_bed_queue")

music = amplify({music_vol()}, radio)
seg   = amplify(seg_gain, segments)
bed   = amplify({bed_vol()}, bed_q)

# Mistura final: música (ducked) + segmento (+30%) + bed.
mixed = add(normalize=false, [music, seg, bed])

# --- Ducking ----------------------------------------------------------------
seg_active = ref(false)

def bed_volume_for(fname) =
  if string.contains(substring="tech_ao_minuto", fname) then 0.30
  elsif string.contains(substring="transito", fname) then 0.20
  elsif string.contains(substring="meteo", fname) then 0.20
  else 0.20 end
end

# Segmento começou: metadados do source de segmentos disparam o ducking.
def on_seg_start(m) =
  fname = m["filename"]
  vol = bed_volume_for(fname)
  log.important(label="itfm_segments", "INÍCIO faixa=#{fname} bed=#{vol} music=0.5")
  seg_active := true
  music_vol := 0.5
  bed_vol := vol
  ignore(bed_q.push(request.create("#{MEDIA}/beds/news_bed.mp3")))
end
segments.on_metadata(synchronous=false, on_seg_start)

# Deteta o fim (o source de segmentos deixa de estar pronto) e restaura a
# música com um pequeno fade; o bed faz fade de ~1s e é esvaziado.
def watch_end() =
  if seg_active() and not source.is_ready(segments) then
    seg_active := false
    log.important(label="itfm_segments", "FIM — restaura música, fade do bed")
    # fade do bed (~1s)
    thread.run(delay=0.00, {bed_vol := bed_vol() * 0.6})
    thread.run(delay=0.35, {bed_vol := bed_vol() * 0.4})
    thread.run(delay=0.70, {bed_vol := 0.0})
    thread.run(delay=0.80, {bed_q.skip()})
    # música volta a 100% suavemente
    thread.run(delay=0.00, {music_vol := 0.7})
    thread.run(delay=0.35, {music_vol := 0.85})
    thread.run(delay=0.70, {music_vol := 1.0})
  end
end
thread.run(every=0.25, watch_end)

# Reatribui a saída principal.
radio = mixed
