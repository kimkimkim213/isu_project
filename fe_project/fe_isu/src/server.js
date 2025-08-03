const express = require('express');
const bodyParser = require('body-parser');
const { SpeechClient } = require('@google-cloud/speech');
const fs = require('fs');
const dotenv = require('dotenv');
const cors = require('cors');
// 1. @google/generative-ai 패키지를 사용합니다.
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = 3001;

require('dotenv').config({ path: './.env' });

// 2. GoogleGenerativeAI 클라이언트를 초기화합니다.
// .env 파일에 GOOGLE_API_KEY를 설정해야 합니다.
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY)

const speechClient = new SpeechClient({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

app.post('/api/summarize', async (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: '요약할 텍스트가 없습니다.' });
    }

    // 3. Vertex AI (Gemini Pro) 모델을 사용하여 요약합니다.
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" });
    const prompt = `주어지는 대화의 전문을 요약해 주세요. 대화: ${text}`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const summary = response.text();

    // 4. 요약 결과를 클라이언트에 전송합니다.
    res.json({ summary });
  } catch (error) {
    console.error('요약 중 오류:', error);
    res.status(500).json({ error: '요약 실패', details: error.message });
  }
});

app.post('/api/transcribe', async (req, res) => {
  try {
    const { audio: base64Audio, sampleRate, mimeType } = req.body;

    if (!base64Audio || !sampleRate || !mimeType) {
      return res.status(400).json({ error: '필수 정보(audio, sampleRate, mimeType)가 누락되었습니다.' });
    }

    const audioBuffer = Buffer.from(base64Audio, 'base64');
    console.log('Received audio buffer size:', audioBuffer.length, 'bytes');
    console.log(`Received audio properties: Sample Rate=${sampleRate}, Mime Type=${mimeType}`);

    const audio = {
      content: audioBuffer.toString('base64'),
    };

    let encoding = 'ENCODING_UNSPECIFIED';
    if (mimeType.includes('webm')) {
        encoding = 'WEBM_OPUS';
    } else if (mimeType.includes('wav')) {
        encoding = 'WAV';
    }

    const config = {
      encoding: encoding,
      sampleRateHertz: sampleRate,
      languageCode: 'ko-KR',
      enableSpeakerDiarization: true,
      diarizationSpeakerCount: 2
    };

    console.log('Sending request to Google with config:', JSON.stringify(config, null, 2));

    const [response] = await speechClient.recognize({ audio, config });

    console.log('Google Speech-to-Text API 응답:', JSON.stringify(response, null, 2));

    const transcription = response.results
      .map(result => result.alternatives[0].transcript)
      .join('\n');

    // 5. 'transcription' 변수를 올바르게 사용합니다.
    res.json({ transcription });
  } catch (error) {
    console.error('전사 중 오류:', error);
    res.status(500).json({ error: '전사 실패', details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`백엔드 서버 실행 중: http://localhost:${PORT}`);
});