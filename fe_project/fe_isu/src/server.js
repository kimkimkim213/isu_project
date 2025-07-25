const express = require('express');
const bodyParser = require('body-parser');
const { SpeechClient } = require('@google-cloud/speech');
const fs = require('fs');
const dotenv = require('dotenv');
const cors = require('cors');

const app = express();
const PORT = 3001;

require('dotenv').config({ path: './key.env' });


const speechClient = new SpeechClient({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

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
      enableSpeakerDiarization: true, // 화자 분리 활성화
      diarizationSpeakerCount: 2 // 예상 화자 수 설정 (필요시 조정 가능)
    };

    console.log('Sending request to Google with config:', JSON.stringify(config, null, 2));

    console.log('Sending request to Google with config:', JSON.stringify(config, null, 2));

    const [response] = await speechClient.recognize({ audio, config });

    console.log('Google Speech-to-Text API 응답:', JSON.stringify(response, null, 2));

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
