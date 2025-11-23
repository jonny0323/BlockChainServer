// src/modules/betting/service.js (혹은 betting.service.js)

import wrap from '#utility/wrapper.js'; 
import 'dotenv/config'; 
import axios from 'axios';
import { ethers } from 'ethers';
import * as bettingRepository from './repository.js'; // DB Repository 모듈 가정
import db from "../../config/db.js"
import { signTransactionWithId, signAndSendTransactionWithIdx } from '../../config/litPkpService.js';
import {extractIdFromToken,extractIdxFromToken} from '../../middleware/AuthMiddleware.js'


// ----------------------------------------------------
// ✅ 1. 환경 변수 로드 (process.env에서 가져옴)
// ----------------------------------------------------
const RPC_URL = process.env.POLYGON_RPC_URL; 
const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY; 
const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS; 
const GAS_LIMIT = 5000000
const GWEI_NEEDED = 50

// 🔥🔥 2. ABI 아티팩트 (Hardhat 폴더와 무관한 로컬 경로) 🔥🔥
// 이 경로를 Express.js 프로젝트 내의 안전한 복사 위치로 지정해야 합니다.
import BetFactoryArtifact from '../../shared/abi/BetFactory.json' with { type: 'json' };
import BetMarketArtifact from '../../shared/abi/BettingMarket.json' with { type: 'json' };

// ----------------------------------------------------
// ✅ 2. Factory 계약 인스턴스 헬퍼 함수 (v5)
// ----------------------------------------------------
function getFactoryContract() {
    console.log("DEBUG → getFactoryContract() 시작됨");

    // v5: JsonRpcProvider에 network 객체 전달
    const provider = new ethers.providers.JsonRpcProvider(RPC_URL, {
        name: "matic",
        chainId: 137
    });

    console.log("DEBUG → provider 생성 완료");

    const signer = new ethers.Wallet(ADMIN_PRIVATE_KEY, provider);
    console.log("DEBUG → signer.address:", signer.address);

    return new ethers.Contract(
        FACTORY_ADDRESS,
        BetFactoryArtifact.abi,
        signer
    );
}

// ----------------------------------------------------
// ✅ 3. CreateBetting 서비스 로직 (wrap 적용 가능)
// ----------------------------------------------------
const PRICE_FEEDS = {
    "BTC/USD": "0xc907E116054Ad103354f2D350FD2514433D57F6f",
    // 필요한 다른 페어 추가
};

export const CreateBetting = wrap(async (req, res) => {
    console.log("=== CreateBetting 시작 ===");

    const { title, settlementTime, targetPrice, assetType, priceFeedAddress } = req.body;

    console.log("📥 요청 데이터:", {
        title,
        settlementTime,
        targetPrice,
        assetType,
        priceFeedAddress
    });

    const factoryContract = getFactoryContract();
    const provider = factoryContract.provider;
    const signer = factoryContract.signer;

    // ✅ 1. 현재 블록 타임스탬프 확인
    const latestBlock = await provider.getBlock("latest");
    const currentTimestamp = latestBlock.timestamp;
    console.log("⏰ 현재 블록 타임스탬프:", currentTimestamp);

    // ✅ 2. settlementTime 검증
    const settlementTimeBN = ethers.BigNumber.from(settlementTime);
    console.log("📅 settlementTime:", settlementTimeBN.toString());
    
    if (settlementTimeBN.lte(currentTimestamp)) {
        throw new Error(`settlementTime이 현재 시간보다 과거입니다.`);
    }

    // ✅ 3. priceFeedAddress 검증
    if (!ethers.utils.isAddress(priceFeedAddress)) {
        throw new Error(`유효하지 않은 주소 형식: ${priceFeedAddress}`);
    }

    const code = await provider.getCode(priceFeedAddress);
    if (code === "0x" || code.length <= 2) {
        throw new Error(`priceFeedAddress가 컨트랙트가 아닙니다`);
    }

    // ✅ 4. targetPrice 검증
    const targetPriceBN = ethers.BigNumber.from(targetPrice);
    console.log("💰 targetPrice:", targetPriceBN.toString());

    if (targetPriceBN.lte(0)) {
        throw new Error(`targetPrice는 0보다 커야 합니다`);
    }

    // ✅ 5. Nonce & 가스
    const nonce = await provider.getTransactionCount(signer.address, "latest");
    
    const priorityFee = ethers.utils.parseUnits("500", "gwei");
    const maxFee = ethers.utils.parseUnits("1000", "gwei");
    
    console.log("📤 트랜잭션 전송 중...");

    const tx = await factoryContract.createMarket(
        settlementTimeBN,
        targetPriceBN,
        priceFeedAddress,
        {
            gasLimit: 2000000,
            maxPriorityFeePerGas: priorityFee,
            maxFeePerGas: maxFee,
            nonce: nonce,
            type: 2
        }
    );

    console.log("✅ TX SENT:", tx.hash);

    const receipt = await tx.wait();

    if (receipt.status === 0) {
        throw new Error(`트랜잭션 실패: ${tx.hash}`);
    }

    console.log("✅ 트랜잭션 성공!");

    // ✅ 6. 로그 파싱
    let newMarketAddress = null;
    const factoryInterface = new ethers.utils.Interface(BetFactoryArtifact.abi);

    for (const log of receipt.logs) {
        try {
            const parsedLog = factoryInterface.parseLog(log);
            if (parsedLog && parsedLog.name === "NewMarketCreated") {
                newMarketAddress = parsedLog.args.newMarketAddress;
                console.log("✅ 새 마켓 주소:", newMarketAddress);
                break;
            }
        } catch (_) {}
    }

    if (!newMarketAddress) {
        throw new Error("트랜잭션 로그에서 새 마켓 주소를 찾을 수 없습니다.");
    }

    // ✅ 7. DB 저장
    console.log("💾 DB 저장 중...");
    
    const dbResult = await bettingRepository.saveNewMarket({
        title,
        settlementTime: settlementTime.toString(),
        targetPrice: targetPrice.toString(),
        assetType,
        marketContractAddress: newMarketAddress,
        priceFeedAddress
    });

    console.log("=== CreateBetting 완료 ===");

    res.status(200).json({
        success: true,
        marketId: dbResult.insertId,
        marketAddress: newMarketAddress,
        transactionHash: tx.hash,
        polygonscan: `https://polygonscan.com/address/${newMarketAddress}`
    });
});

//=========================================================================================================================
//=========================================================================================================================
//=========================================================================================================================

//=========================================================================================================================
//=========================================================================================================================
//=========================================================================================================================


export const getFinalizableBets = wrap(async (req, res) => {
    console.log("📋 정산 가능한 베팅 목록 조회");
    
    // ✅ 1. 현재 시간 확인
    const provider = new ethers.providers.JsonRpcProvider(RPC_URL, {
        name: "matic",
        chainId: 137
    });
    
    const currentBlock = await provider.getBlock("latest");
    const currentTimestamp = currentBlock.timestamp;
    
    console.log("⏰ 현재 블록 타임스탬프:", currentTimestamp);
    console.log("📅 현재 시간:", new Date(currentTimestamp * 1000).toISOString());
    
    // ✅ 2. DB에서 정산 가능한 베팅 조회
    // settlement_time이 현재보다 과거이고, is_finalized = false인 베팅들
    const finalizableBets = await bettingRepository.getFinalizableBets(currentTimestamp);
    
    console.log(`📊 정산 가능한 베팅: ${finalizableBets.length}개`);
    
    // ✅ 3. 각 베팅의 현재가 조회
    const priceFeedABI = [
        "function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)"
    ];
    
    const betsWithPrice = await Promise.all(
        finalizableBets.map(async (bet) => {
            let currentPrice = "0";
            
            try {
                const priceFeed = new ethers.Contract(
                    bet.price_feed_address,
                    priceFeedABI,
                    provider
                );
                
                const roundData = await priceFeed.latestRoundData();
                currentPrice = ethers.utils.formatUnits(roundData.answer, 8);
            } catch (error) {
                console.error(`⚠️ 가격 조회 실패 (마켓 ${bet.idx}):`, error.message);
            }
            
            const yesAmount = parseFloat(ethers.utils.formatEther(bet.yes_bet_amount.toString()));
            const noAmount = parseFloat(ethers.utils.formatEther(bet.no_bet_amount.toString()));
            const totalAmount = yesAmount + noAmount;
            
            return {
                idx: bet.idx,
                title: bet.title,
                settlementTime: bet.settlement_time,
                targetPrice: ethers.utils.formatUnits(bet.target_price.toString(), 8),
                currentPrice: currentPrice,
                participantCount: bet.participant_count,
                totalBetAmount: totalAmount.toFixed(2),
                yesBetAmount: yesAmount.toFixed(2),
                noBetAmount: noAmount.toFixed(2),
                marketAddress: bet.market_contract_address,
                priceFeedAddress: bet.price_feed_address
            };
        })
    );
    
    res.status(200).json({
        success: true,
        count: betsWithPrice.length,
        bets: betsWithPrice
    });
});

// ============================================
// ✅ 여러 베팅 한번에 확정
// ============================================
export const finalizeBatchBets = wrap(async (req, res) => {
    console.log("🔥 배치 베팅 확정 시작");
    
    const { marketIds } = req.body;
    
    if (!marketIds || !Array.isArray(marketIds) || marketIds.length === 0) {
        throw new Error('확정할 베팅 ID 배열이 필요합니다.');
    }
    
    console.log(`📋 확정할 베팅: ${marketIds.length}개`);
    console.log("   IDs:", marketIds);
    
    // Provider & Signer 설정
    const provider = new ethers.providers.JsonRpcProvider(RPC_URL, {
        name: "matic",
        chainId: 137
    });
    const signer = new ethers.Wallet(ADMIN_PRIVATE_KEY, provider);
    
    console.log("👤 관리자 지갑:", signer.address);
    
    // ✅ 각 베팅을 순차적으로 처리
    const results = [];
    let nonce = await provider.getTransactionCount(signer.address, "pending");
    
    for (const marketId of marketIds) {
        try {
            console.log(`\n🎯 마켓 #${marketId} 확정 중...`);
            
            // 1. 마켓 정보 조회
            const market = await bettingRepository.getMarketDetail(marketId);
            
            if (!market) {
                console.error(`❌ 마켓 #${marketId}: 존재하지 않음`);
                results.push({
                    marketId,
                    success: false,
                    error: '존재하지 않는 마켓'
                });
                continue;
            }
            
            if (market.is_finalized) {
                console.warn(`⚠️ 마켓 #${marketId}: 이미 정산됨`);
                results.push({
                    marketId,
                    success: false,
                    error: '이미 정산된 마켓'
                });
                continue;
            }
            
            // 2. Contract 인스턴스 생성
            const marketContract = new ethers.Contract(
                market.market_contract_address,
                BetMarketArtifact.abi,
                signer
            );
            
            // 3. 가스 설정
            const priorityFee = ethers.utils.parseUnits("500", "gwei");
            const maxFee = ethers.utils.parseUnits("1000", "gwei");
            
            // 4. Finalize 호출
            const tx = await marketContract.finalize({
                gasLimit: 600000,
                maxPriorityFeePerGas: priorityFee,
                maxFeePerGas: maxFee,
                nonce: nonce++, // nonce 증가
                type: 2
            });
            
            console.log(`   TX 전송: ${tx.hash}`);
            
            // 5. 영수증 대기
            const receipt = await tx.wait();
            
            if (receipt.status === 0) {
                throw new Error(`트랜잭션 실패: ${tx.hash}`);
            }
            
            console.log(`   ✅ 확정 완료 (블록: ${receipt.blockNumber})`);
            
            // 6. 최종 가격 확인
            const finalPrice = await marketContract.getLatestPrice();
            const targetPrice = await marketContract.targetPrice();
            const winner = finalPrice.gte(targetPrice) ? "Above" : "Below";
            
            console.log(`   💰 최종가: ${ethers.utils.formatUnits(finalPrice, 8)}`);
            console.log(`   🎯 목표가: ${ethers.utils.formatUnits(targetPrice, 8)}`);
            console.log(`   🏆 승자: ${winner}`);
            
            // 7. DB 업데이트
            await bettingRepository.updateMarketFinalized(
                marketId,
                winner.toLowerCase(),
                ethers.utils.formatUnits(finalPrice, 8)
            );
            
            results.push({
                marketId,
                success: true,
                transactionHash: tx.hash,
                blockNumber: receipt.blockNumber,
                finalPrice: ethers.utils.formatUnits(finalPrice, 8),
                targetPrice: ethers.utils.formatUnits(targetPrice, 8),
                winner
            });
            
        } catch (error) {
            console.error(`❌ 마켓 #${marketId} 확정 실패:`, error.message);
            results.push({
                marketId,
                success: false,
                error: error.message
            });
        }
    }
    
    // ✅ 결과 요약
    const successCount = results.filter(r => r.success).length;
    const failCount = results.length - successCount;
    
    console.log("\n📊 배치 확정 완료");
    console.log(`   성공: ${successCount}개`);
    console.log(`   실패: ${failCount}개`);
    
    res.status(200).json({
        success: true,
        total: results.length,
        successCount,
        failCount,
        results
    });
});



















export const placeBettingWithPKP = wrap(async (req, res) => {
    console.log("🎲 PKP 베팅 요청 시작");
    
    const userId = extractIdFromToken(req.headers.authorization);
    const userIdx = extractIdxFromToken(req.headers.authorization);

    const { amount, isAbove } = req.body;
    const marketId = req.params.marketId;
    
    console.log("📍 마켓 ID:", marketId);
    console.log("👤 사용자 idx:", userId);
    console.log("💰 베팅 금액:", amount, "MATIC");
    console.log("📊 베팅 방향:", isAbove ? "Above ⬆️" : "Below ⬇️");
    
    // ✅ 검증
    if (!userId || !amount || typeof isAbove !== 'boolean') {
        throw new Error('필수 파라미터가 누락되었습니다.');
    }
    
    if (parseFloat(amount) <= 0) {
        throw new Error('베팅 금액은 0보다 커야 합니다.');
    }
    
    // ✅ 마켓 정보 조회
    const market = await bettingRepository.getMarketDetail(marketId);
    
    if (!market) {
        throw new Error('존재하지 않는 마켓입니다.');
    }
    
    if (market.is_finalized) {
        throw new Error('이미 종료된 베팅입니다.');
    }
    
    // ✅ 중복 베팅 확인 (선택사항)
    // const hasAlreadyBet = await bettingRepository.checkUserBet(marketId, userId);
    // if (hasAlreadyBet) {
    //     throw new Error('이미 베팅에 참여하셨습니다.');
    // }
    
    const betAmountWei = ethers.utils.parseEther(String(amount));
    
    const provider = new ethers.providers.JsonRpcProvider(RPC_URL, {
        name: "matic",
        chainId: 137
    });
    
    const marketContract = new ethers.Contract(
        market.market_contract_address,
        BetMarketArtifact.abi,
        provider
    );
    
    const data = marketContract.interface.encodeFunctionData("placeBet", [isAbove]);
    
    console.log("🔐 PKP 서명 & 전송 중...");
    
    try {
        const result = await signAndSendTransactionWithIdx(
            userId,
            market.market_contract_address,
            data,
            betAmountWei.toString()
        );
        
        console.log("✅ 트랜잭션 성공:", result.transactionHash);
        
        // ✅ DB 업데이트
        console.log("💾 DB 업데이트 중...");
        
        // 1. 참가자 수 업데이트
        await bettingRepository.updateParticipantCount(marketId, isAbove);
        
        // 2. 베팅 금액 업데이트
        await bettingRepository.updateBetAmount(marketId, isAbove, betAmountWei.toString());
        
        // 3. 베팅 기록 저장
        await bettingRepository.saveBet({
            userIdx: userIdx,
            betDirection: isAbove,
            amount: betAmountWei.toString(),
            betDetailIdx: marketId,
            transactionHash: result.transactionHash
        });
        
        console.log("🎉 PKP 베팅 & DB 업데이트 완료!");
        
        res.status(200).json({
            success: true,
            message: '베팅 성공!',
            transactionHash: result.transactionHash,
            blockNumber: result.blockNumber,
            gasUsed: result.gasUsed,
            polygonscan: `https://polygonscan.com/tx/${result.transactionHash}`
        });
        
    } catch (error) {
        console.error("❌ 베팅 실패:", error);
        throw new Error(`베팅 실패: ${error.message}`);
    }
});


export const GetMainData = wrap(async (req, res) => {
    // ✅ 진행 중인 베팅 목록 가져오기
    const bets = await bettingRepository.getActiveBets();
    console.log("ㅁㅇㄴㄹㅁㅇㄴㄹㅁㅇㄴㄹㅁㄴ아ㅣㄹ;ㅣ;ㅁㄴ아ㅓ리ㅏ;ㅓㄴㅇ;ㅏ")

    // ✅ 프론트엔드 형식으로 변환
    const formattedBets = bets.map(bet => {
        const yesAmount = parseFloat(ethers.utils.formatEther(bet.yes_bet_amount.toString()));
        const noAmount = parseFloat(ethers.utils.formatEther(bet.no_bet_amount.toString()));
        const totalAmount = yesAmount + noAmount;

        // ✅ 찬성 수익률 계산 (총 베팅액 / 찬성 베팅액)
        const yesOdds = yesAmount > 0 ? (totalAmount / yesAmount) : 1.0;

        return {
            idx: bet.idx,
            title: bet.title,
            settlementTime: bet.settlement_time,
            yesOdds: yesOdds.toFixed(2),
            participantCount: bet.participant_count,
            yesParticipantCount: bet.yes_participant_count,  // ✅ 추가
            noParticipantCount: bet.no_participant_count,    // ✅ 추가
            totalBetAmount: totalAmount.toFixed(2),
            yesBetAmount: yesAmount.toFixed(2),
            noBetAmount: noAmount.toFixed(2),
            status: '참여 중',
            assetType: bet.asset_type,
            targetPrice: ethers.utils.formatUnits(bet.target_price.toString(), 8) // Chainlink 8 decimals
        };
    });

    res.status(200).json({
        success: true,
        bets: formattedBets
    });
});

export const GetDetailData = wrap(async (req, res) => {
    console.log("📄 베팅 상세 조회 시작");
    
    const { marketId } = req.params;
    
    if (!marketId) {
        throw new Error('marketId가 필요합니다.');
    }
    
    // ✅ 1. 마켓 정보 조회
    const market = await bettingRepository.getMarketDetail(marketId);
    
    if (!market) {
        throw new Error('존재하지 않는 마켓입니다.');
    }
    
    console.log("📊 마켓 정보:", market.title);
    
    // ✅ 2. 현재가격 조회 (Chainlink)
    const provider = new ethers.providers.JsonRpcProvider(
        process.env.POLYGON_RPC_URL,
        { name: "matic", chainId: 137 }
    );
    
    const priceFeedABI = [
        "function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)"
    ];
    
    const priceFeed = new ethers.Contract(
        market.price_feed_address,
        priceFeedABI,
        provider
    );
    
    let currentPrice = "0";
    try {
        const roundData = await priceFeed.latestRoundData();
        currentPrice = ethers.utils.formatUnits(roundData.answer, 8);
        console.log("💰 현재가격:", currentPrice, "USD");
    } catch (error) {
        console.error("⚠️ 현재가격 조회 실패:", error.message);
    }
    
    // ✅ 3. 베팅 금액 및 배당률 계산
    const yesAmount = parseFloat(ethers.utils.formatEther(market.yes_bet_amount.toString()));
    const noAmount = parseFloat(ethers.utils.formatEther(market.no_bet_amount.toString()));
    const totalAmount = yesAmount + noAmount;
    
    const yesOdds = yesAmount > 0 ? (totalAmount / yesAmount) : 1.0;
    const noOdds = noAmount > 0 ? (totalAmount / noAmount) : 1.0;
    
    const yesParticipants = market.yes_participant_count;
    const noParticipants = market.no_participant_count;
    // ✅ 4. 참여자 수 조회
    const participants = await bettingRepository.getMarketParticipants(marketId);
    
    // ✅ 5. 사용자 베팅 내역 (로그인한 경우)
    let userBets = [];
    const authHeader = req.headers.authorization;
    
    if (authHeader) {
        try {
            const userId = extractIdxFromToken(authHeader);
            const bets = await bettingRepository.getUserBetHistory(marketId, userId);
            
            userBets = bets.map(bet => {
                const betAmount = parseFloat(ethers.utils.formatEther(bet.amount.toString()));
                const odds = bet.bet_direction ? yesOdds : noOdds;
                
                // 정산 여부에 따른 상태
                let status = '진행중';
                let profit = 0;
                
                if (market.is_finalized) {
                    const isWinner = 
                        (market.winner_direction === 'above' && bet.bet_direction) ||
                        (market.winner_direction === 'below' && !bet.bet_direction);
                    
                    if (isWinner) {
                        status = '승리';
                        profit = betAmount * odds - betAmount;
                    } else {
                        status = '패배';
                        profit = -betAmount;
                    }
                }
                
                return {
                    date: bet.created_at,
                    direction: bet.bet_direction ? 'YES' : 'NO',
                    odds: odds.toFixed(2),
                    amount: betAmount.toFixed(2),
                    status,
                    profit: profit.toFixed(2),
                    txHash: bet.transaction_hash
                };
            });
        } catch (error) {
            console.error("⚠️ 사용자 베팅 내역 조회 실패:", error);
        }
    }
    
    // ✅ 6. 응답 데이터 구성
    res.status(200).json({
        success: true,
        market: {
            idx: market.idx,
            title: market.title,
            settlementTime: market.settlement_time,
            targetPrice: ethers.utils.formatUnits(market.target_price.toString(), 8),
            currentPrice: currentPrice,
            contractAddress: market.market_contract_address,
            isFinalized: market.is_finalized,
            winnerDirection: market.winner_direction,
            description: `비트코인이 ${new Date(market.settlement_time).toLocaleDateString('ko-KR')}에 $${ethers.utils.formatUnits(market.target_price.toString(), 8)} 이상의 가격에 도달할지 예측하는 베팅입니다.`
        },
        betting: {
            totalAmount: totalAmount.toFixed(2),
            yesAmount: yesAmount.toFixed(2),
            noAmount: noAmount.toFixed(2),
            yesOdds: yesOdds.toFixed(2),
            noOdds: noOdds.toFixed(2),
            yesParticipants: participants.yesCount,
            noParticipants: participants.noCount,
            yesParticipants: yesParticipants,  // ✅ DB에서 직접
            noParticipants: noParticipants 
        },
        userBets: userBets
    });
    
    console.log("✅ 상세 조회 완료");
});

export const FinishBet = wrap(async (req, res) => {
    console.log("🏁 베팅 정산 시작");
    
    const { marketAddress } = req.body; // 또는 req.params.marketId
    
    console.log("📍 마켓 주소:", marketAddress);
    
    // 검증 (v5)
    if (!marketAddress || !ethers.utils.isAddress(marketAddress)) {
        throw new Error('유효한 마켓 주소가 필요합니다.');
    }
    
    // Provider & Signer (관리자 키 사용) (v5)
    const provider = new ethers.providers.JsonRpcProvider(RPC_URL, {
        name: "matic",
        chainId: 137
    });
    const signer = new ethers.Wallet(ADMIN_PRIVATE_KEY, provider);
    
    console.log("👤 정산 실행 지갑:", signer.address);
    
    // Contract 인스턴스
    const marketContract = new ethers.Contract(
        marketAddress,
        BetMarketArtifact.abi,
        signer
    );
    
    // ✅ 정산 시간 확인
    const settlementTime = await marketContract.settlementTime();
    const currentBlock = await provider.getBlock("latest");
    const currentTimestamp = currentBlock.timestamp;
    
    console.log("⏰ 현재 시간:", new Date(currentTimestamp * 1000).toISOString());
    console.log("📅 정산 시간:", new Date(Number(settlementTime) * 1000).toISOString());
    
    if (currentTimestamp < settlementTime) {
        throw new Error(`아직 정산 시간이 아닙니다. (${Math.floor((Number(settlementTime) - currentTimestamp) / 60)}분 남음)`);
    }
    
    // ✅ 이미 정산되었는지 확인
    const isFinalized = await marketContract.isFinalized();
    if (isFinalized) {
        throw new Error('이미 정산된 마켓입니다.');
    }
    
    // ✅ Nonce & 가스 설정
    const nonce = await provider.getTransactionCount(signer.address, "pending");
    console.log("🔢 Nonce:", nonce);
    
    // 현재 가스 가격 확인
    const feeData = await provider.getFeeData();
    
    // 초고속 가스비 설정 (20초 내 확정)
    const priorityFee = ethers.utils.parseUnits("600", "gwei");
    const maxFee = ethers.utils.parseUnits("1200", "gwei");
    
    console.log("⚡ 초고속 가스 설정:");
    console.log("   Priority:", ethers.utils.formatUnits(priorityFee, "gwei"), "gwei");
    console.log("   Max:", ethers.utils.formatUnits(maxFee, "gwei"), "gwei");
    
    console.log("📤 Finalize 트랜잭션 전송 중...");
    
    // finalize 호출 (v5)
    const tx = await marketContract.finalize({
        gasLimit: 600000, // 여유있게
        maxPriorityFeePerGas: priorityFee,
        maxFeePerGas: maxFee,
        nonce: nonce,
        type: 2 // EIP-1559
    });
    
    console.log("✅ TX 전송:", tx.hash);
    console.log("🔗 PolygonScan:", `https://polygonscan.com/tx/${tx.hash}`);
    
    console.log("⏳ 트랜잭션 완료 대기 중...");
    
    const receipt = await tx.wait();
    
    if (receipt.status === 0) {
        throw new Error(`정산 실패: ${tx.hash}`);
    }
    
    console.log("🎉 정산 완료!");
    console.log("   블록:", receipt.blockNumber);
    console.log("   가스:", receipt.gasUsed.toString());
    
    // ✅ 최종 가격 확인 (v5)
    const finalPrice = await marketContract.getLatestPrice();
    const targetPrice = await marketContract.targetPrice();
    
    console.log("💰 최종 가격:", ethers.utils.formatUnits(finalPrice, 8), "USD");
    console.log("🎯 목표 가격:", ethers.utils.formatUnits(targetPrice, 8), "USD");
    console.log("📊 결과:", finalPrice.gte(targetPrice) ? "Above 승리! ⬆️" : "Below 승리! ⬇️");
    
    res.status(200).json({
        success: true,
        message: '정산 완료!',
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        finalPrice: ethers.utils.formatUnits(finalPrice, 8),
        targetPrice: ethers.utils.formatUnits(targetPrice, 8),
        winner: finalPrice.gte(targetPrice) ? "Above" : "Below",
        polygonscan: `https://polygonscan.com/tx/${tx.hash}`
    });
});
