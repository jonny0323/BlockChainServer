import express from 'express';

import {
  CreateBetting,
  getFinalizableBets,
  placeBettingWithPKP,
  GetMainData,
  GetDetailData,
  finalizeBatchBets,
  FinishBet
} from './service.js';
import { verifyToken, verifyAdmin } from '../../middleware/AuthMiddleware.js';

const router = express.Router();

// ============================================
// 공개 API (인증 불필요)
// ============================================

// 메인 페이지 - 진행 중인 베팅 목록
router.get('/GetMainData', GetMainData); 

// 상세 페이지 - 특정 베팅 정보 (로그인 시 사용자 베팅 내역 포함)
router.get('/GetDetailData/:marketId', GetDetailData); 

// ============================================
// 관리자 전용 API (Admin 권한 필요) - 구체적 경로 먼저!
// ============================================

// 새로운 베팅 생성
router.post('/create', verifyToken, verifyAdmin, CreateBetting);

// 정산 가능한 베팅 목록 조회
router.get('/finalizeable', verifyToken, verifyAdmin, getFinalizableBets);

// 여러 베팅 한번에 확정
router.post('/finalize', verifyToken, verifyAdmin, finalizeBatchBets);

// ============================================
// 사용자 API (로그인 필요) - 동적 경로는 마지막!
// ============================================

// 베팅 참여
router.post('/:marketId', verifyToken, placeBettingWithPKP);

// 단일 베팅 확정
router.put('/:marketId/finalize', verifyToken, verifyAdmin, FinishBet);

export default router;