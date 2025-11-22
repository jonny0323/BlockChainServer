import express from 'express';

import {
  CreateBetting,
  FinishBet,
  placeBettingWithPKP,
  GetMainData,
  GetDetailData
} from './service.js';
import { verifyToken } from '../../middleware/AuthMiddleware.js';


const router = express.Router();

// // 4. ✨ POST: 새로운 마켓 생성 (Admin 기능: CreateBet)
router.post('/create', CreateBetting);

router.post('/:marketId', placeBettingWithPKP);

// // 5. ✨ PUT: 마켓 정산 완료 (Admin 기능: CompleteBet)
router.put('/:marketId/finalize',FinishBet);

router.get('/GetMainData', GetMainData); 

router.get('/GetDetailData/:marketId', GetDetailData); 

// // 관리자 권한 미들웨어 추가

export default router;