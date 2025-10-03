// 모듈 임포트
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai'); // Gemini 생성 AI
const { SpeechClient } = require('@google-cloud/speech'); // 음성->텍스트 API

// Express 앱 생성
const app = express();
const PORT = 3001;

// .env 환경변수 로드
require('dotenv').config({ path: './.env' });

// API 클라이언트 초기화
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// Google Speech 클라이언트를 초기화합니다.
const speechClient = new SpeechClient({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});

// 미들웨어 설정
app.use(cors()); // CORS 허용
app.use(bodyParser.json({ limit: '100mb' })); // JSON 요청 크기 제한 증가

// POST /api/summarize: 텍스트 요약
app.post('/api/summarize', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: '요약할 텍스트가 없습니다.' });
    }

    // Gemini 모델로 요약 생성
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
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

// POST /api/transcribe: 음성 텍스트 변환
app.post('/api/transcribe', async (req, res) => {
  try {
    const { audio: base64Audio, sampleRate, mimeType } = req.body;

    if (!base64Audio || !sampleRate || !mimeType) {
      return res.status(400).json({ error: '필수 정보가 누락되었습니다.' });
    }

    // Base64 오디오를 버퍼로 변환
    const audio = {
      content: base64Audio,
    };

    // MIME 타입에 따른 인코딩 설정
    let encoding = 'ENCODING_UNSPECIFIED';
    if (mimeType.includes('webm')) {
        encoding = 'WEBM_OPUS';
    } else if (mimeType.includes('wav')) {
        encoding = 'WAV';
    }

    // Speech-to-Text API 요청 설정
    const config = {
      encoding: encoding,
      sampleRateHertz: sampleRate,
      languageCode: 'ko-KR', // 언어: 한국어
      enableSpeakerDiarization: true, // 화자 분리 활성화
      diarizationSpeakerCount: 2
    };

    // API에 인식 요청
    const [response] = await speechClient.recognize({ audio, config });

    // 결과 텍스트만 추출하여 결합
    const transcription = response.results
      .map(result => result.alternatives[0].transcript)
      .join('\n');

    res.json({ transcription });
  } catch (error) {
    console.error('전사 중 오류:', error);
    res.status(500).json({ error: '전사 실패', details: error.message });
  }
});

// 서버 시작

app.listen(PORT, () => {
  console.log(`백엔드 서버 실행 중: http://localhost:${PORT}`);
});