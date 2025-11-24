import wrap from '#utility/wrapper.js'
import 'dotenv/config';
import qs from 'qs';
import axios from 'axios';
import { mintAndRegisterPKP, signAndSendTransactionWithIdx } from '../../config/litPkpService.js';
import jwt from 'jsonwebtoken';
import * as userRepository from './repository.js';
import { ethers } from 'ethers';

//=====================================================================================================
// JWT 토큰 생성
//=====================================================================================================

function genAccessToken(userIdx,userId, isAdmin = false) {
    return jwt.sign(
        { 
            idx : userIdx,
            id: userId,
            admin: isAdmin  // ✅ admin 정보 추가
        },
        process.env.JWT_SECRET,
        { expiresIn: '3h' }
    );
}

//=====================================================================================================
// Google 로그인
//=====================================================================================================

export const GoogleLogin = wrap((req, res) => {
    console.log("Google 로그인 리다이렉트");
    
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.GOOGLE_CLIENT_ID}&redirect_uri=${process.env.GOOGLE_REDIRECT_URL}&response_type=code&scope=openid email`;
    res.redirect(url);
});

//=====================================================================================================
// Google 로그인 콜백 & 회원가입
//=====================================================================================================

export const CreateToken = wrap(async (req, res) => {
    console.log("=== CreateToken 시작 ===");
    
    const { code } = req.query;

    // 1. Google OAuth Access Token 발급
    const resp = await axios.post(
        process.env.GOOGLE_TOKEN_URL,
        qs.stringify({
            code: code,
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            redirect_uri: process.env.GOOGLE_REDIRECT_URL,
            grant_type: 'authorization_code'
        }),
        {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        }
    );

    const googleAccessToken = resp.data.access_token;

    // 2. Google 사용자 정보 조회
    const userInfo = await axios.get(process.env.GOOGLE_INFORMATION_URL, {
        headers: {
            Authorization: `Bearer ${googleAccessToken}`
        }
    });

    const googleId = userInfo.data.sub;

    // 3. DB에서 기존 유저 확인
    const existingUser = await userRepository.findUserByGoogleId(googleId);
    console.log("통과");

    // ✅ 기존 유저 로그인
    if (existingUser) {
        const accessToken = genAccessToken(
            existingUser.idx,
            existingUser.google_id, 
            existingUser.is_admin  // ✅ DB의 admin 정보 전달
        );
        
        console.log("✅ 기존 유저 로그인:", {
            googleId: existingUser.google_id,
            isAdmin: existingUser.is_admin
        });
        
        res.redirect(`https://block-chain-front.vercel.app/callback?token=${accessToken}`);
        return;
    }

    // ✅ 신규 유저 - PKP 생성
    const pkpData = await mintAndRegisterPKP(googleId);

    // 4. DB에 사용자 정보 저장
    const newUser = await userRepository.createUser({
        googleId: googleId,
        pkpPublicKey: pkpData.pkpPublicKey,
        pkpTokenId: pkpData.pkpTokenId,
        pkpEthAddress: pkpData.pkpEthAddress
    });
//여기다가 신규 유저 db넣어야함 idx 추출

    const UserIdx = await userRepository.findUserByGoogleId({
        googleId: googleId,
    });

    
    // 5. JWT 생성 (신규 유저는 기본적으로 admin=false)
    const accessToken = genAccessToken(
        UserIdx.idx,
        newUser.googleId,
        false  // ✅ 신규 유저는 일반 유저
    );
    
    console.log("✅ 신규 유저 가입:", {
        googleId: newUser.googleId,
        isAdmin: false
    });
    
    res.redirect(`https://block-chain-front.vercel.app/callback?token=${accessToken}`);
});

//=====================================================================================================
// 지갑 주소 조회
//=====================================================================================================
export const GetAddress = wrap(async (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) throw new Error('인증 토큰이 누락되었습니다.');

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.id;

    const user = await userRepository.findUserByGoogleId(userId);
    
    if (!user) throw new Error('사용자를 찾을 수 없습니다.');

    res.status(200).json({
        success: true,
        depositAddress: user.pkp_eth_address,
    });
});

//=====================================================================================================
// 지갑 잔액 조회
//=====================================================================================================

export const GetWallet = wrap(async (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) throw new Error('인증 토큰이 누락되었습니다.');

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.id;

    const user = await userRepository.findUserByGoogleId(userId);
    
    if (!user) throw new Error('사용자를 찾을 수 없습니다.');

    // ✅ Polygon에서 실제 잔액 조회
    const provider = new ethers.providers.JsonRpcProvider(
        process.env.POLYGON_RPC_URL,
        { name: "matic", chainId: 137 }
    );
    
    const balance = await provider.getBalance(user.pkp_eth_address);

    res.status(200).json({
        success: true,
        pkpEthAddress: user.pkp_eth_address,
        balance: ethers.utils.formatEther(balance),  // MATIC
        balanceWei: balance.toString()
    });
});

//=====================================================================================================
// 로그아웃
//=====================================================================================================

export const Logout = wrap(async (req, res) => {
    res.status(200).json({ 
        success: true,
        message: '로그아웃 성공'
    });
});

//=====================================================================================================
// ✅ 출금 (PKP 지갑 → 외부 지갑)
//=====================================================================================================

export const Withdraw = wrap(async (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) throw new Error('인증 토큰이 누락되었습니다.');

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.id;

    const { targetAddress, amount } = req.body;
    
    if (!targetAddress || !ethers.utils.isAddress(targetAddress)) {
        throw new Error('유효한 출금 주소가 필요합니다.');
    }

    const withdrawalAmount = Number(amount);
    if (isNaN(withdrawalAmount) || withdrawalAmount <= 0) {
        throw new Error('유효한 출금 금액이 필요합니다.');
    }

    // ✅ PKP로 출금 트랜잭션 서명 & 전송
    const result = await signAndSendTransactionWithIdx(
        userId,
        targetAddress,
        "0x",
        ethers.utils.parseEther(withdrawalAmount.toString()).toString()
    );

    res.status(200).json({
        success: true,
        transactionHash: result.transactionHash,
        amount: withdrawalAmount,
        to: targetAddress
    });
});


