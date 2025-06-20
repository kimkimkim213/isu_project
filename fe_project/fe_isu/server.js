const express = require('express');
const bodyParser = require('body-parser');
const { SpeechClient } = require('@google-cloud/speech');
const fs = require('fs');
const dotenv = require('dotenv');
const app = express();
const PORT = 3001;
const cors = require('cors');

dotenv.config({ path: './.env' }); // 환경 변수 로딩

const speechClient = new SpeechClient({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS, // key.env에서 경로 읽기
});

app.use(cors());

app.use(bodyParser.json({ limit: '10mb' }));



app.post('/api/transcribe', async (req, res) => {
  try {
    const base64Audio = req.body.audio;
    const audioBuffer = Buffer.from(base64Audio, 'base64');

    const audio = {
      content: audioBuffer.toString('base64'), // 재확인: Google API는 base64 문자열을 기대
    };

    const config = {
      encoding: 'WEBM_OPUS',
      sampleRateHertz: 44100,
      languageCode: 'ko-KR', // 한국어 인식
    };

    const [response] = await speechClient.recognize({ audio, config });
    console.log('Google Speech-to-Text API 응답:', JSON.stringify(response, null, 2));
    const transcription = response.results
      .map(result => result.alternatives[0].transcript)
      .join('\n');

    res.json({ transcription });
  } catch (error) {
    console.error('전사 중 오류:', error);
    res.status(500).json({ error: '전사 실패' });
  }
});

app.listen(PORT, () => {
  console.log(`백엔드 서버 실행 중: http://localhost:${PORT}`);
});
