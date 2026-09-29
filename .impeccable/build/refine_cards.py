from pathlib import Path
import re
p=Path('.impeccable/build/body.html')
s=p.read_text(encoding='utf-8')
s=s.replace('<p>Вспомните перевод. Переверните. Запомните.</p>','')
s=re.sub(r'<span class="review-badge" id="review-badge">.*?</span>','',s)
s=s.replace('<div class="deck" id="deck"><article', '<div class="deck" id="deck"><div class="queued-card" id="queued-card" aria-hidden="true" inert><span class="queue-word" id="queued-word"></span><span class="letter-hint" id="queued-hint"></span></div><article')
front_start=s.index('<div class="face front"')
back_end=s.index('</div></div><span class="stamp"',front_start)
s=s[:front_start]+'''<div class="face front" id="front"><div class="card-top"><span class="card-tag" id="word-kind">глагол</span><span class="language">Русский</span></div><button type="button" class="flip-target" id="front-flip" aria-labelledby="translation letter-hint" aria-describedby="front-hint"><span class="translation prompt-word" id="translation">открывать, узнавать</span><span class="letter-hint" id="letter-hint" lang="en">d…</span></button><div class="card-bottom"><span class="sr-only" id="front-hint">Показать английское слово</span><span aria-hidden="true"></span><button type="button" class="sound" aria-label="Произнести английское слово" title="Послушать слово"><svg aria-hidden="true"><use href="#i-sound"/></svg></button></div></div>
<div class="face back" id="back" aria-hidden="true" inert><div class="card-top"><span class="card-tag">English</span><span class="language">Английский</span></div><button type="button" class="flip-target" id="back-flip" aria-labelledby="word transcription" aria-describedby="example example-ru back-hint"><span class="word" id="word" lang="en">discover</span><span class="transcription" id="transcription">/dɪˈskʌvə/</span><span class="example" id="example" lang="en"></span><span class="example-ru" id="example-ru"></span></button><div class="card-bottom"><span class="sr-only" id="back-hint">Вернуться к русскому слову</span><span aria-hidden="true"></span><button type="button" class="sound" aria-label="Произнести английский пример" data-speech="example" title="Послушать пример"><svg aria-hidden="true"><use href="#i-sound"/></svg></button></div></div>
'''+s[back_end:]
s=re.sub(r'<p class="session-feedback".*?</p>','',s)
s=re.sub(r'<div class="key-hints".*?</div>','',s)
s=re.sub(r'<p class="page-footer".*?</p>','',s)
s=s.replace('class="save-note"','class="save-note" hidden')
s=s.replace('На телефоне смахивайте влево или вправо.','Смахивайте влево, вправо или вниз. Свайп вниз — «Трудно». На лицевой стороне русский перевод и первая буква английского слова. Нажмите, чтобы увидеть ответ.')
p.write_text(s,encoding='utf-8')
