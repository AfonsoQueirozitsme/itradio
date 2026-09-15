# === Bed "Breaking News" por baixo dos segmentos falados ===
#
# Injetado no ponto "custom_config" do AzuraCast (corre depois do AutoDJ e
# antes do output, onde a variável `radio` é o source final).
#
# Quando começa um segmento, o bed entra desde o início ao volume respetivo;
# quando o segmento acaba, o bed faz fade e pára ~1s depois.
#   - Tech ao Minuto (news) → 30%
#   - Trânsito / Meteo       → 20%
#
# {{MEDIA_DIR}} é substituído pelo provision.mjs pela media dir da estação
# (ex.: /var/azuracast/stations/it.fm/media).

news_bed_path = "{{MEDIA_DIR}}/beds/news_bed.mp3"
news_bed_q = request.queue(id="news_bed_queue")
news_bed_vol = ref(0.0)
bed_playing = ref(false)

# Bed com volume controlável (getter sobre a ref) somado ao source principal.
news_bed = amplify({news_bed_vol()}, news_bed_q)
radio = add(normalize=false, [radio, news_bed])

# Volume do bed consoante o segmento que está a tocar (0 = não é segmento).
def bed_volume_for(fname) =
  if string.contains(substring="segmentos/tech_ao_minuto", fname) then 0.30
  elsif string.contains(substring="segmentos/transito", fname) then 0.20
  elsif string.contains(substring="segmentos/meteo", fname) then 0.20
  else 0.0
  end
end

# A cada mudança de faixa no source principal, decide se um segmento entrou/saiu.
def news_ducking(m) =
  fname = m["filename"]
  vol = bed_volume_for(fname)
  log.important(label="news_bed", "faixa=#{fname} bed_vol=#{vol}")
  if vol > 0.0 and not bed_playing() then
    # Segmento começou: bed desde o início, ao volume respetivo.
    bed_playing := true
    news_bed_vol := vol
    ignore(news_bed_q.push(request.create(news_bed_path)))
  elsif vol <= 0.0 and bed_playing() then
    # Segmento acabou: fade proporcional de ~1s e pára o bed.
    bed_playing := false
    thread.run(delay=0.25, {news_bed_vol := news_bed_vol() * 0.6})
    thread.run(delay=0.50, {news_bed_vol := news_bed_vol() * 0.5})
    thread.run(delay=0.75, {news_bed_vol := news_bed_vol() * 0.4})
    thread.run(delay=1.00, {news_bed_vol := 0.0})
    thread.run(delay=1.05, {news_bed_q.skip()})
  end
end
radio.on_metadata(synchronous=false, news_ducking)
