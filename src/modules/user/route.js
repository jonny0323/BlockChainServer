import express from 'express';
import {
  GoogleLogin,
  CreateToken,
  GetWallet,
  GetAddress,
  Withdraw,
  Logout
} from './service.js';
import { verifyToken } from '../../middleware/AuthMiddleware.js';


const router = express.Router();

// ✅ Google 로그인
router.get('/login', GoogleLogin); 

// ✅ Google 로그인 콜백
router.get('/login/callback', CreateToken);

// ✅ 지갑 주소 조회
router.get('/address',verifyToken, GetAddress);

// ✅ 지갑 잔액 조회
router.get('/wallet',verifyToken, GetWallet);


// ✅ 출금
router.post('/withdraw',verifyToken, Withdraw);

// ✅ 로그아웃
router.delete('/logout',verifyToken, Logout);

export default router;