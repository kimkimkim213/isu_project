const express = require('express');
const bodyParser = require('body-parser');
// 환경변수 관리: .env 로드
const cors = require('cors');

const { GoogleGenerativeAI } = require('@google/generative-ai');//요약용 API 수신
const { SpeechClient } = require('@google-cloud/speech');//음성인식용 API 수신

const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const PORT = 3001;

require('dotenv').config({ path: './.env' }); // 환경변수 설정

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY); // 요약용

const speechClient = new SpeechClient({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});

app.use(cors()); // 모든 도메인 허용
app.use(bodyParser.json({ limit: '100mb' })); // JSON 요청 크기 설정

// 업로드 저장 디렉터리 및 multer 설정 (간단 구현)
const UP_DIR = path.join(__dirname, '../uploads');
// 디렉터리 없으면 생성(간단 안전장치)
try { fs.mkdirSync(UP_DIR, { recursive: true }); } catch (e) { console.warn('백: 업로드 폴더 생성 실패(무시):', e.message); }
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UP_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });
app.use('/uploads', express.static(UP_DIR));

// 요약 요청 처리
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
    console.error('백: 요약 오류:', error);
    res.status(500).json({ error: '요약 실패', details: error.message });
  }
});

// 음성 전사(STT) 처리
// /api/transcribe: form-data(audio) 우선 처리, 없으면 base64 JSON 처리
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  try {
    const startTime = Date.now();
    // Basic request metadata
    const contentType = req.headers['content-type'] || '';
    const contentLength = req.get('content-length') || '';
    console.log('백: /api/transcribe 요청 수신 - content-type:', contentType, 'content-length:', contentLength);

    let audioBuffer = null;
    let sampleRate = null;
    let mimeType = null;

    if (req.file) {
      // form-data로 파일이 올라온 경우
      const fp = req.file.path;
      mimeType = req.file.mimetype || 'audio/webm';
      try {
        audioBuffer = fs.readFileSync(fp);
        console.log('백: 업로드된 파일 읽음:', fp);
        console.log('백: 파일 메타 - originalname:', req.file.originalname, 'mimetype:', mimeType, 'size:', audioBuffer.length);
        // Log first 64 bytes for quick inspection (hex)
  try { console.log('백: 파일 바이트(선두 64 바이트, hex):', audioBuffer.slice(0, 64).toString('hex')); } catch (e) { console.warn('백: 파일 바이트 출력 실패(무시):', e && e.message ? e.message : e); }
      } catch (e) {
        console.error('백: 업로드 파일 읽기 오류:', e);
        return res.status(500).json({ error: '파일 처리 실패', details: e.message });
      } finally {
        // 업로드된 파일 즉시 삭제(임시 저장)
    try { fs.unlinkSync(fp); } catch (e) { console.warn('백: 업로드 임시파일 삭제 실패(무시):', e && e.message ? e.message : e); }
      }
      sampleRate = req.body.sampleRate ? Number(req.body.sampleRate) : 16000;
    } else {
      // 기존 base64 JSON 처리
      const { audio: base64Audio, sampleRate: sr, mimeType: mt } = req.body;
      if (!base64Audio || !sr || !mt) {
        return res.status(400).json({ error: '필수 정보(audio, sampleRate, mimeType)가 누락되었습니다.' });
      }
      audioBuffer = Buffer.from(base64Audio, 'base64');
      console.log('백: base64로 수신 - mimeType:', mt, 'base64_len:', base64Audio.length, 'buffer_bytes:', audioBuffer.length);
  try { console.log('백: base64 오디오 바이트(선두 64 바이트, hex):', audioBuffer.slice(0,64).toString('hex')); } catch (e) { console.warn('백: base64 바이트 출력 실패(무시):', e && e.message ? e.message : e); }
      sampleRate = sr;
      mimeType = mt;
    }

    console.log('백: 수신된 오디오 버퍼 크기:', audioBuffer.length, '바이트');
    console.log(`백: 수신된 오디오 속성: 샘플레이트=${sampleRate}, MIME=${mimeType}`);

    const audio = { content: audioBuffer.toString('base64') };

  // Map common incoming MIME types to Google Speech encodings.
  // For WAV files containing 16-bit PCM data use LINEAR16.
  let encoding = 'ENCODING_UNSPECIFIED';
  if (mimeType && mimeType.includes('webm')) {
    encoding = 'WEBM_OPUS';
  } else if (mimeType && mimeType.includes('wav')) {
    // The Speech API expects 'LINEAR16' for PCM WAV files (16-bit PCM).
    encoding = 'LINEAR16';
  }

  // Ensure sampleRate is a number and set default to 16000 for WAV/LINEAR16
  if (!sampleRate || typeof sampleRate !== 'number' || Number.isNaN(sampleRate)) {
    sampleRate = 16000;
  }

    const config = {
      encoding: encoding,
      sampleRateHertz: sampleRate,
      languageCode: 'ko-KR',
      enableSpeakerDiarization: true,
      diarizationSpeakerCount: 2
    };

    console.log('백: Google 전송 설정:', JSON.stringify(config, null, 2));
    // Measure time to call Google
    const callStart = Date.now();
    const [response] = await speechClient.recognize({ audio, config });
    const callDur = Date.now() - callStart;

    console.log('백: Google STT 호출 완료 (ms):', callDur);
  try { console.log('백: Google STT 응답 요약:', JSON.stringify(response, ['results','alternatives','transcript'], 2).slice(0,2000)); } catch (e) { console.warn('백: STT 응답 요약 출력 실패(무시):', e && e.message ? e.message : e); }

    const transcription = (response.results || [])
      .map(result => (result.alternatives && result.alternatives[0]) ? result.alternatives[0].transcript : '')
      .filter(t => t)
      .join('\n');

    const totalDur = Date.now() - startTime;
    console.log('백: 전사 완료 — 전사문자 길이:', transcription.length, '처리시간(ms):', totalDur);

    res.json({ transcription });
  } catch (error) {
    console.error('백: 전사 오류:', error);
    res.status(500).json({ error: '전사 실패', details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`백: 서버 실행 중: http://localhost:${PORT}`);
});

// 간단한 업로드 엔드포인트: form-data 파일 필드명 'audio' 사용
app.post('/api/upload', upload.single('audio'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '파일 없음' });
    const url = `http://localhost:${PORT}/uploads/${req.file.filename}`;
    console.log('백: 업로드 완료 URL:', url);
    res.json({ url });
  } catch (e) {
    console.error('백: 업로드 오류:', e);
    res.status(500).json({ error: '업로드 실패', details: e.message });
  }
});