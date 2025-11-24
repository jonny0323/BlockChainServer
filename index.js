//기본 설정====================================================================================
import 'dotenv/config';
import express from 'express';

const app = express();

import cors from 'cors';
app.use(cors({
    origin: [
        'https://block-chain-front.vercel.app',
    ],
    credentials: true  // 쿠키/인증 허용
}));


app.use(express.json());
//라우터 이동 정리====================================================================================
import userRoute from './src/modules/user/route.js';
app.use('/user', userRoute);

import bettingRoute from './src/modules/betting/route.js';
app.use('/betting', bettingRoute);



//git Action====================================================================================
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    message: '3000포트에서 웹서버 실행중'
  });
});
//에러 핸들러====================================================================================
app.use((err, req, res, next) => {
  console.log('에러', err);
  res.status(err.statusCode || 500).json({ message: err.message });
});
//서버 시작===================================================================================
app.listen(process.env.PORT, () => {
  console.log(`${process.env.PORT}포트에서 웹서버 실행중`);
});

