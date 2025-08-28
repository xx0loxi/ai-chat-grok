// DOM
const chatEl = document.getElementById('chat');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('send');
const stopBtn = document.getElementById('stop');
const hintsEl = document.getElementById('hints');
const clearBtn = document.getElementById('clear');

let abortController = null;
let conversation = [];

// Звёздное небо + лёгкий параллакс
(function starfield(){
  const cnv = document.querySelector('.stars');
  const ctx = cnv.getContext('2d');
  let w, h, stars;
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  let mouseX = 0, mouseY = 0;

  function reset(){
    w = cnv.width = innerWidth * DPR;
    h = cnv.height = innerHeight * DPR;
    cnv.style.width = innerWidth + 'px';
    cnv.style.height = innerHeight + 'px';
    stars = Array.from({length: 180}, () => ({
      x: Math.random()*w,
      y: Math.random()*h,
      z: Math.random()*1 + .2,
      s: Math.random()*1.2 + .2,
    }));
  }
  function tick(){
    ctx.clearRect(0,0,w,h);
    for(const st of stars){
      st.x += st.z*0.25 + (mouseX - w/2) * 0.00002 * st.z;
      st.y += st.z*0.15 + (mouseY - h/2) * 0.00002 * st.z;
      if(st.x>w) st.x=0; if(st.x<0) st.x=w;
      if(st.y>h) st.y=0; if(st.y<0) st.y=h;
      ctx.globalAlpha = .35 + st.z*.65;
      ctx.fillStyle = Math.random()>.995 ? '#58fff5' : '#ffffff';
      ctx.beginPath(); ctx.arc(st.x, st.y, st.s, 0, Math.PI*2); ctx.fill();
    }
    requestAnimationFrame(tick);
  }
  addEventListener('resize', reset);
  cnv.addEventListener('mousemove', e => {
    mouseX = e.offsetX * DPR;
    mouseY = e.offsetY * DPR;
  });
  reset(); tick();
})();

// Утилиты
function el(tag, cls, html){
  const n = document.createElement(tag);
  if(cls) n.className = cls;
  if(html!=null) n.innerHTML = html;
  return n;
}
function scrollToBottom(){ chatEl.scrollTop = chatEl.scrollHeight; }
function nowTime(){
  const d = new Date();
  return d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
}

// Простой Markdown-рендер
function renderMarkdown(text){
  const parts = text.split(/```([\s\S]*?)```/g);
  let html = '';
  for(let i=0;i<parts.length;i++){
    if(i%2===1){
      const code = parts[i].replace(/</g,'&lt;').replace(/>/g,'&gt;');
      html += `<div class="codeblock"><button class="copy">Копировать</button><pre><code>${code}</code></pre></div>`;
    }else{
      let t = parts[i]
        .replace(/^### (.*)$/gm, '<h3>$1</h3>')
        .replace(/^## (.*)$/gm, '<h2>$1</h2>')
        .replace(/^# (.*)$/gm, '<h1>$1</h1>')
        .replace(/^\- (.*)$/gm, '• $1')
        .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
        .replace(/\`([^`]+)\`/g, '<code>$1</code>')
        .replace(/\n{3,}/g, '\n\n');
      t = t.split('\n\n').map(p => `<p>${p.replace(/\n/g,'<br/>')}</p>`).join('');
      html += t;
    }
  }
  return html;
}

function attachCopyHandlers(scope){
  scope.querySelectorAll('.codeblock .copy').forEach(btn=>{
    btn.onclick = ()=>{
      const code = btn.parentElement.querySelector('pre').innerText;
      navigator.clipboard.writeText(code);
      const old = btn.textContent;
      btn.textContent = 'Скопировано';
      setTimeout(()=>btn.textContent=old, 1200);
    };
  });
}

// Сообщение
function addMessage(role, text, streaming=false){
  const bubble = el('article', 'bubble ' + role);
  const row = el('div','row');
  if(role==='assistant') row.appendChild(el('div','avatar'));
  const body = el('div','body');
  body.appendChild(el('div','meta', `${role==='user'?'Вы':'ИИ'} • ${nowTime()}`));
  const content = el('div','content');

  if(streaming){
    content.innerHTML = `<span class="typing"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>`;
  }else{
    content.innerHTML = renderMarkdown(text);
  }

  body.appendChild(content);
  row.appendChild(body);
  bubble.appendChild(row);
  chatEl.appendChild(bubble);
  scrollToBottom();
  return content;
}

// Приветствие
(function welcome(){
  const text = `Готов к диалогу.
- Текст теперь белый и читаемый.
- Enter — отправка, Shift+Enter — перенос строки.
- Нажми “Стоп”, чтобы прервать ответ.`;
  addMessage('assistant', text);
})();

// Подсказки
hintsEl.addEventListener('click', (e)=>{
  if(e.target.classList.contains('hint')){
    inputEl.value = e.target.textContent;
    inputEl.focus();
  }
});

// Отправка и стриминг
async function send(){
  const text = inputEl.value.trim();
  if(!text || abortController) return;

  inputEl.value = '';
  inputEl.style.height = '44px';

  conversation.push({role:'user', content:text});
  addMessage('user', text);

  const contentEl = addMessage('assistant','',true);

  abortController = new AbortController();
  stopBtn.style.display = 'inline-flex';
  sendBtn.disabled = true;

  try{
    const res = await fetch('/api/chat', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ messages: conversation }),
      signal: abortController.signal
    });
    if(!res.ok || !res.body) throw new Error('Сетевой ответ недоступен');

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let acc = '';
    let full = '';
    let firstChunkArrived = false;

    while(true){
      const {done, value} = await reader.read();
      if(done) break;
      acc += decoder.decode(value, {stream:true});

      let idx;
      while((idx = acc.indexOf('\n')) >= 0){
        const line = acc.slice(0, idx).trim();
        acc = acc.slice(idx+1);
        if(!line) continue;
        let obj;
        try{ obj = JSON.parse(line); }catch(_){ continue; }

        if(obj.error){
          contentEl.innerHTML = renderMarkdown('Ошибка: ' + obj.error);
          continue;
        }

        if(obj.delta){
          full += obj.delta;
          if(!firstChunkArrived){
            firstChunkArrived = true;
          }
          contentEl.innerHTML = renderMarkdown(full);
          attachCopyHandlers(contentEl);
          scrollToBottom();
        }
        if(obj.done){
          if(full) conversation.push({role:'assistant', content: full});
        }
      }
    }
  }catch(err){
    contentEl.innerHTML = renderMarkdown('Ошибка: ' + err.message);
  }finally{
    stop();
  }
}

function stop(){
  if(abortController){
    abortController.abort();
    abortController = null;
  }
  stopBtn.style.display = 'none';
  sendBtn.disabled = false;
}

// Слушатели
sendBtn.addEventListener('click', send);
stopBtn.addEventListener('click', stop);
clearBtn?.addEventListener('click', ()=>{
  chatEl.innerHTML = '';
  conversation = [];
  const text = 'Чат очищен. О чём поговорим?';
  addMessage('assistant', text);
});

// Enter — отправка, Shift+Enter — перенос
inputEl.addEventListener('keydown', (e)=>{
  if(e.key==='Enter' && !e.shiftKey){
    e.preventDefault();
    send();
  }else if(e.key==='Escape'){
    stop();
  }
  // авто-рост textarea
  requestAnimationFrame(()=>{
    inputEl.style.height='auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 220) + 'px';
  });
});

// Фокус на инпут при загрузке
window.addEventListener('load', ()=> inputEl.focus());