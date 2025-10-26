const express = require('express');
const cors = require('cors');

const { GoogleGenerativeAI } = require('@google/generative-ai');//전사본 요약용 API
const { SpeechClient } = require('@google-cloud/speech');//음성인식용 API

const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();

// 전역 예외 처리
process.on('uncaughtException', (err) => {
  console.error('백: uncaughtException 발생:', err && err.stack ? err.stack : err);
});//동기 처리중 예외 발생시
process.on('unhandledRejection', (reason, p) => {
  console.error('백: unhandledRejection 발생 - reason:', reason, 'promise:', p);
});//비동기 처리중 예외 발생시

//환경변수 로드 및 확인 (최소한으로 로드)
require('dotenv').config();
// 로컬 fe_isu/.env에 추가 설정이 있을 수 있으므로, GOOGLE_API_KEY가 비어있을 때만 보조 로드
const feEnvPath = path.join(__dirname, 'fe_isu', '.env');
if (!process.env.GOOGLE_API_KEY && fs.existsSync(feEnvPath)) {
  require('dotenv').config({ path: feEnvPath });
}

// GOOGLE_APPLICATION_CREDENTIALS가 상대경로로 설정되어 있을 수 있으므로 __dirname 기준으로 절대경로로 정규화
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  const gac = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (gac && !path.isAbsolute(gac)) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(__dirname, gac);
  }
  console.log('백: GOOGLE_APPLICATION_CREDENTIALS normalized to', process.env.GOOGLE_APPLICATION_CREDENTIALS);
}

// GOOGLE_API_KEY는 .env에서 직접 설정되어야 합니다. 필요하면 수동으로 값을 확인하세요.

// PORT 번호 설정 - 기본값 3001
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

// 전역 클라이언트 생성 (간단하게)
let genAI = null;
let speechClient = null;

// genAI 초기화 (간단한 실패 로직)
if (process.env.GOOGLE_API_KEY) {
  try {
    genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
  } catch (err) {
    console.error('백: genAI 초기화 오류:', err && err.message ? err.message : err);
    genAI = null;
  }
} else {
  console.warn('백: 환경변수(GOOGLE_API_KEY) 설정되지 않음 - 요약 기능 사용 불가');
}

// SpeechClient 생성 시도
function createSpeechClient() {
  try {
    const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (keyPath && fs.existsSync(keyPath) && fs.statSync(keyPath).isFile()) {
      console.log('백: SpeechClient initialized from keyFilename:', keyPath);
      return new SpeechClient({ keyFilename: keyPath });
    }
    console.log('백: SpeechClient initialized using Application Default Credentials (ADC)');
    return new SpeechClient();
  } catch (e) {
    console.error('백: SpeechClient 생성 중 오류:', e && e.message ? e.message : e);
    return null;
  }
}

speechClient = createSpeechClient();

app.use(cors());

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
//파싱 처리 제한 - 50MB

// JSON 파싱 오류 처리
app.use((err, req, res, next) => {
  if (err && (err instanceof SyntaxError || err.type === 'entity.parse.failed')) {
    console.error('백: JSON 파싱 오류:', err.message);
    return res.status(400).json({ error: '유효하지 않은 JSON 요청' });
  }
  next(err);
});

//클라이언트 데이터 수신용 파일 생성
const UP_DIR = path.join(__dirname, 'fe_isu', 'uploads'); //업로드 디렉토리 설정
// 디렉토리 없으면 생성
try { fs.mkdirSync(UP_DIR, { recursive: true }); }
catch (e) { console.warn('백: 업로드 폴더 생성 실패(무시):', e.message); }
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UP_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
// multer 제한 설정 - >=50MB, 오디오 파일만 허용
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['audio/webm', 'audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/ogg', 'audio/opus'];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error('허용되지 않는 파일 형식입니다. 오디오 파일만 업로드하세요.'));
  }
});
app.use('/uploads', express.static(UP_DIR));

// 요약 요청 처리
app.post('/api/summarize', async (req, res) => {
  try {
    const { text } = req.body;//요약할 텍스트
    if (!text) {
      return res.status(400).json({ error: '요약할 텍스트가 없음' });
    }
    if (!genAI) {
      return res.status(500).json({ error: '요약 엔진 초기화되지 않음' });
    }
    // 요약 AI 모델 호출 처리
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const prompt = `요약문을 제외한 다른 반응이나 말은 모두 출력하지 말고,이 다음에 주어지는 대화의 전문을 핵심을 꼽아 요약해줘. / 대화: ${text}`;
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const summary = response.text();
    res.json({ summary });//요약문 반환
    } catch (error) {
    console.error('백: 요약 오류:', error);
    res.status(500).json({ error: '요약 실패', 사유: error && error.message ? error.message : String(error) });
  }
});

// 음성 전사 처리
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  if (!speechClient) return res.status(500).json({ error: '음성인식 클라이언트 초기화되지 않음' });
  if (!req.file) return res.status(400).json({ error: '오디오 파일 필요' });

  const startTime = Date.now();
  const fp = req.file.path;
  const mimeType = req.file.mimetype || 'audio/webm';

  try {
    const audioBuffer = await fs.promises.readFile(fp);
    const sampleRate = req.body.sampleRate ? Number(req.body.sampleRate) : 16000;

    console.log('백: 전사 요청 수신 - 파일:', req.file.originalname, '크기:', audioBuffer.length, '샘플레이트:', sampleRate, 'MIME:', mimeType);

    const audio = { content: audioBuffer.toString('base64') };
    let encoding = 'ENCODING_UNSPECIFIED';
    if (mimeType.includes('webm')) encoding = 'WEBM_OPUS';
    else if (mimeType.includes('wav')) encoding = 'LINEAR16';

    const config = {
      encoding,
      sampleRateHertz: sampleRate || 16000,
      languageCode: 'ko-KR',
      enableSpeakerDiarization: true,
      diarizationSpeakerCount: 'auto',
    };

    const callStart = Date.now();
    const [operation] = await speechClient.longRunningRecognize({ audio, config });
    const [response] = await operation.promise();

    if (!response || !response.results || response.results.length === 0) {
      console.warn('백: STT가 결과를 반환하지 않음');
      return res.status(502).json({ error: '음성 인식 결과가 없습니다. 다시 시도하세요.' });
    }

    const transcription = (response.results || [])
      .map(r => (r.alternatives && r.alternatives[0]) ? r.alternatives[0].transcript : '')
      .filter(Boolean)
      .join('\n');

    if (!transcription || transcription.trim().length === 0) {
      console.warn('백: STT 결과가 비어 있음');
      return res.status(502).json({ error: '음성 인식 결과가 없습니다. 다시 시도하세요.' });
    }

    console.log('백: 전사 완료 — 문자 길이:', transcription.length, '처리시간(ms):', Date.now() - startTime);
    return res.json({ transcription });
  } catch (error) {
    console.error('백: 전사 오류:', error);
    return res.status(500).json({ error: '전사 실패', details: error && error.message ? error.message : String(error) });
  } finally {
    // 임시 파일은 항상 시도해서 삭제
    fs.promises.unlink(fp).catch(err => console.warn('백: 업로드 임시파일 삭제 실패:', err && err.message ? err.message : err));
  }
});

// 업로드 앤드포인트
app.post('/api/upload', upload.single('audio'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '파일 없음' });//파일이 없으면 오류400 반환
    const url = `http://localhost:${PORT}/uploads/${req.file.filename}`;//업로드된 파일URL 생성
    console.log('백: 업로드 완료 URL:', url);//업로드된 파일 URL 표시
    res.json({ url });//URL 반환
  } catch (e) {
    console.error('백: 업로드 오류:', e);
    res.status(500).json({ error: '업로드 실패', details: e.message });
  }
});

// Multer 전용 에러 핸들러: 업로드 관련 에러를 명확히 처리
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    console.error('백: Multer 오류:', err.code, err.message);
    return res.status(400).json({ error: '파일 업로드 오류', code: err.code, message: err.message });
  }
  next(err);
});

// 서버 시작 - 포트가 사용 중일 때 자동으로 다음 포트로 재시도
function startServer(port, attemptsLeft = 5) {
  const server = app.listen(port, () => {
    console.log(`백: 서버 실행 중: http://localhost:${port}`);
  });

  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`백: 포트 ${port} 사용 중(EADDRINUSE)`);
      if (attemptsLeft > 1) {
        const nextPort = port + 1;
        console.log(`백: 포트 ${nextPort}으로 재시도합니다... (${attemptsLeft - 1}회 남음)`);
        // 약간의 지연 후 재시도
        setTimeout(() => startServer(nextPort, attemptsLeft - 1), 200);
      } else {
        console.error('백: 사용 가능한 포트를 찾지 못했습니다. 프로세스를 종료합니다.');
        process.exit(1);
      }
    } else {
      console.error('백: 서버 시작 중 오류:', err);
      process.exit(1);
    }
  });
}

startServer(PORT);
