const express = require('express');
const bodyParser = require('body-parser');
const { SpeechClient } = require('@google-cloud/speech');
const fs = require('fs');
const dotenv = require('dotenv');
const cors = require('cors');

const app = express();
const PORT = 3001;

dotenv.config({ path: '.env' });

const speechClient = new SpeechClient({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

app.post('/api/transcribe', async (req, res) => {
  try {
    const base64Audio = req.body.audio;
    const audioBuffer = Buffer.from(base64Audio, 'base64');

    // 오디오 버퍼의 크기를 로그로 출력 (디버깅 목적)
    console.log('Received audio buffer size:', audioBuffer.length, 'bytes');

    const audio = {
      content: audioBuffer.toString('base64'),
    };

    const config = {
      encoding: 'WEBM_OPUS',
      sampleRateHertz: 48000,
      languageCode: 'ko-KR',
    };

    const [response] = await speechClient.recognize({ audio, config });

    console.log('Google Speech-to-Text API 응답:', JSON.stringify(response, null, 2));

    const transcription = response.results
      .map(result => result.alternatives[0].transcript)
      .join('\n');

    res.json({ transcription });
  } catch (error) {
    console.error('전사 중 오류:', error);
    res.status(500).json({ error: '전사 실패', details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`백엔드 서버 실행 중: http://localhost:${PORT}`);
});
