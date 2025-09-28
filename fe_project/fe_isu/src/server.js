const express = require('express');
const bodyParser = require('body-parser');

const cors = require('cors');

const { GoogleGenerativeAI } = require('@google/generative-ai');//요약용 API 수신
const { SpeechClient } = require('@google-cloud/speech');//음성인식용 API 수신

const app = express();
const PORT = 3001;

require('dotenv').config({ path: './.env' });//환경변수 설정

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY) //요약용 API 클라이언트에 환경변수 설정

const speechClient = new SpeechClient({//음성인식용 API 클라이언트에 환경변수(경로) 설정
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});

app.use(cors()); // 모든 도메인에서 오는 요청 허용
app.use(bodyParser.json({ limit: '100mb' })); //json 요청 설정

app.post('/api/summarize', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: '요약할 텍스트가 없습니다.' });
    }
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const prompt = `요약문을 제외한 다른 반응이나 말은 모두 출력하지 말고,이 다음에 주어지는 대화의 전문을 핵심을 꼽아 체계적으로 요약해줘. / 대화: ${text}`;
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const summary = response.text();
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

  
    res.json({ transcription });
  } catch (error) {
    console.error('전사 중 오류:', error);
    res.status(500).json({ error: '전사 실패', details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`백엔드 서버 실행 중: http://localhost:${PORT}`);
});