// server/server.js
require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 5500;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// Базовая проверка ключа
if (!OPENROUTER_API_KEY) {
  console.warn('ВНИМАНИЕ: Не задан OPENROUTER_API_KEY в .env');
}

app.use(cors());
app.use(express.json());

// Отдаём фронтенд
app.use(express.static(path.join(__dirname, '..', 'public')));

// Прокси в OpenRouter со стримингом NDJSON
app.post('/api/chat', async (req, res) => {
  const { messages = [] } = req.body || {};

  // Готовим потоковый ответ клиенту (NDJSON)
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  let upstream;
  try {
    upstream = await axios.post(
      'https://api.openrouter.ai/v1/chat/completions',
      {
        // Жёстко используем DeepSeek R1 free
        model: 'deepseek/deepseek-r1-0528:free',
        stream: true,
        messages
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          // Необязательные метаданные
          'HTTP-Referer': `http://localhost:${PORT}`,
          'X-Title': 'Grok-ish Chat'
        },
        responseType: 'stream',
        timeout: 300000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );

    upstream.data.on('data', chunk => {
      const lines = chunk.toString('utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        const m = line.match(/^data:\s*(.*)$/);
        if (!m) continue;

        if (m[1] === '[DONE]') {
          res.write(JSON.stringify({ done: true }) + '\n');
          return res.end();
        }

        try {
          const json = JSON.parse(m[1]);
          // В потоках OpenAI-совместимых API может приходить:
          // choices[0].delta.content (чанк текста)
          // choices[0].message.content (если не-стрим или первый крупный блок)
          // У DeepSeek R1 также может быть delta.reasoning — добавим, если прилетит.
          const deltaText =
            json?.choices?.[0]?.delta?.content ??
            json?.choices?.[0]?.message?.content ??
            '';

          const deltaReasoning =
            json?.choices?.[0]?.delta?.reasoning ?? '';

          const delta = (deltaReasoning || '') + (deltaText || '');
          if (delta) {
            res.write(JSON.stringify({ delta }) + '\n');
          }
        } catch (_err) {
          // Игнорируем промежуточные несоответствия формата
        }
      }
    });

    upstream.data.on('end', () => {
      try { res.write(JSON.stringify({ done: true }) + '\n'); } catch(_) {}
      res.end();
    });

    upstream.data.on('error', (e) => {
      try { res.write(JSON.stringify({ error: e.message }) + '\n'); } catch(_) {}
      res.end();
    });

    // Если клиент оборвал соединение — закрываем апстрим
    req.on('close', () => {
      try { upstream?.data?.destroy?.(); } catch(_) {}
    });

  } catch (e) {
    try {
      res.status(500).end(JSON.stringify({ error: e.message }) + '\n');
    } catch(_) {}
  }
});

// SPA-фоллбек
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('Server on http://localhost:' + PORT);
});