import wrap from '#utility/wrapper.js'; 
import 'dotenv/config'; 
import axios from 'axios';
import { ethers } from 'ethers';
import * as bettingRepository from './repository.js'; // DB Repository 모듈 가정
import db from "../../config/db.js"
import { signTransactionWithId, signAndSendTransactionWithIdx } from '../../config/litPkpService.js';
import {extractIdFromToken,extractIdxFromToken} from '../../middleware/AuthMiddleware.js'

import BetFactoryArtifact from '../../shared/abi/BetFactory.json' with { type: 'json' };
import BetMarketArtifact from '../../shared/abi/BettingMarket.json' with { type: 'json' };

//=====================================================================================================
// 1. 환경 변수 로드 (process.env에서 가져옴)
//=====================================================================================================
const RPC_URL = process.env.POLYGON_RPC_URL; 
const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY; 
const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS; 
const GAS_LIMIT = 5000000
const GWEI_NEEDED = 50


//=====================================================================================================
// 2. Factory 계약 인스턴스 헬퍼 함수 (v5)
//=====================================================================================================
function getFactoryContract() {
    // v5: JsonRpcProvider에 network 객체 전달
    const provider = new ethers.providers.JsonRpcProvider(RPC_URL, {
        name: "matic",
        chainId: 137
    });

    const signer = new ethers.Wallet(ADMIN_PRIVATE_KEY, provider);

    return new ethers.Contract(
        FACTORY_ADDRESS,
        BetFactoryArtifact.abi,
        signer
    );
}

//=====================================================================================================
// 3. CreateBetting 서비스 로직 (wrap 적용 가능)
//=====================================================================================================
const PRICE_FEEDS = {
    "BTC/USD": "0xc907E116054Ad103354f2D350FD2514433D57F6f",
};

export const CreateBetting = wrap(async (req, res) => {
    const { title, settlementTime, targetPrice, assetType, priceFeedAddress } = req.body;

    const factoryContract = getFactoryContract();
    const provider = factoryContract.provider;
    const signer = factoryContract.signer;

    // 1. 현재 블록 타임스탬프 확인
    const latestBlock = await provider.getBlock("latest");
    const currentTimestamp = latestBlock.timestamp;

    // 2. settlementTime 검증
    const settlementTimeBN = ethers.BigNumber.from(settlementTime);
    
    if (settlementTimeBN.lte(currentTimestamp)) {
        throw new Error(`settlementTime이 현재 시간보다 과거입니다.`);
    }

    // 3. priceFeedAddress 검증
    if (!ethers.utils.isAddress(priceFeedAddress)) {
        throw new Error(`유효하지 않은 주소 형식: ${priceFeedAddress}`);
    }

    const code = await provider.getCode(priceFeedAddress);
    if (code === "0x" || code.length <= 2) {
        throw new Error(`priceFeedAddress가 컨트랙트가 아닙니다`);
    }

    // 4. targetPrice 검증
    const targetPriceBN = ethers.BigNumber.from(targetPrice);

    if (targetPriceBN.lte(0)) {
        throw new Error(`targetPrice는 0보다 커야 합니다`);
    }

    // 5. Nonce & 가스
    const nonce = await provider.getTransactionCount(signer.address, "latest");
    
    const priorityFee = ethers.utils.parseUnits("500", "gwei");
    const maxFee = ethers.utils.parseUnits("1000", "gwei");

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

    const receipt = await tx.wait();

    if (receipt.status === 0) {
        throw new Error(`트랜잭션 실패: ${tx.hash}`);
    }

    // 6. 로그 파싱
    let newMarketAddress = null;
    const factoryInterface = new ethers.utils.Interface(BetFactoryArtifact.abi);

    for (const log of receipt.logs) {
        try {
            const parsedLog = factoryInterface.parseLog(log);
            if (parsedLog && parsedLog.name === "NewMarketCreated") {
                newMarketAddress = parsedLog.args.newMarketAddress;
                break;
            }
        } catch (_) {}
    }

    if (!newMarketAddress) {
        throw new Error("트랜잭션 로그에서 새 마켓 주소를 찾을 수 없습니다.");
    }

    // 7. DB 저장
    const dbResult = await bettingRepository.saveNewMarket({
        title,
        settlementTime: new Date(settlementTime * 1000).toISOString().slice(0, 19).replace('T', ' '),
        targetPrice: targetPrice.toString(),
        assetType,
        marketContractAddress: newMarketAddress,
        priceFeedAddress
    });

    res.status(200).json({
        success: true,
        marketId: dbResult.insertId,
        marketAddress: newMarketAddress,
        transactionHash: tx.hash,
        polygonscan: `https://polygonscan.com/address/${newMarketAddress}`
    });
});

export const getFinalizableBets = wrap(async (req, res) => {
    // 1. 현재 시간 확인
    const provider = new ethers.providers.JsonRpcProvider(RPC_URL, {
        name: "matic",
        chainId: 137
    });
    
    const currentBlock = await provider.getBlock("latest");
    const currentTimestamp = currentBlock.timestamp;
    
    // 2. DB에서 정산 가능한 베팅 조회
    // settlement_time이 현재보다 과거이고, is_finalized = false인 베팅들
    const finalizableBets = await bettingRepository.getFinalizableBets(currentTimestamp);
    
    // 3. 각 베팅의 현재가 조회
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
                console.error(`가격 조회 실패 (마켓 ${bet.idx}):`, error.message);
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

//=====================================================================================================
// 여러 베팅 한번에 확정
//=====================================================================================================
export const finalizeBatchBets = wrap(async (req, res) => {
    const { marketIds } = req.body;
    
    if (!marketIds || !Array.isArray(marketIds) || marketIds.length === 0) {
        throw new Error('확정할 베팅 ID 배열이 필요합니다.');
    }
    
    // Provider & Signer 설정
    const provider = new ethers.providers.JsonRpcProvider(RPC_URL, {
        name: "matic",
        chainId: 137
    });
    const signer = new ethers.Wallet(ADMIN_PRIVATE_KEY, provider);
    
    // 각 베팅을 순차적으로 처리
    const results = [];
    let nonce = await provider.getTransactionCount(signer.address, "pending");
    
    for (const marketId of marketIds) {
        try {
            // 1. 마켓 정보 조회
            const market = await bettingRepository.getMarketDetail(marketId);
            
            if (!market) {
                results.push({
                    marketId,
                    success: false,
                    error: '존재하지 않는 마켓'
                });
                continue;
            }
            
            if (market.is_finalized) {
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
            
            // 5. 영수증 대기
            const receipt = await tx.wait();
            
            if (receipt.status === 0) {
                throw new Error(`트랜잭션 실패: ${tx.hash}`);
            }
            
            // 6. 최종 가격 확인
            const finalPrice = await marketContract.getLatestPrice();
            const targetPrice = await marketContract.targetPrice();
            const winner = finalPrice.gte(targetPrice) ? "Above" : "Below";
            
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
            results.push({
                marketId,
                success: false,
                error: error.message
            });
        }
    }
    
    // 결과 요약
    const successCount = results.filter(r => r.success).length;
    const failCount = results.length - successCount;
    
    res.status(200).json({
        success: true,
        total: results.length,
        successCount,
        failCount,
        results
    });
});

export const placeBettingWithPKP = wrap(async (req, res) => {
    const userId = extractIdFromToken(req.headers.authorization);
    const userIdx = extractIdxFromToken(req.headers.authorization);

    const { amount, isAbove } = req.body;
    const marketId = req.params.marketId;
    
    try {
        // 1. 기본 검증
        if (!userId || !amount || typeof isAbove !== 'boolean') {
            return res.status(400).json({
                success: false,
                errorType: 'INVALID_PARAMS',
                message: '필수 파라미터가 누락되었습니다.'
            });
        }
        
        if (parseFloat(amount) <= 0) {
            return res.status(400).json({
                success: false,
                errorType: 'INVALID_AMOUNT',
                message: '베팅 금액은 0보다 커야 합니다.'
            });
        }
        
        // 2. 마켓 정보 조회
        const market = await bettingRepository.getMarketDetail(marketId);
        
        if (!market) {
            return res.status(404).json({
                success: false,
                errorType: 'MARKET_NOT_FOUND',
                message: '존재하지 않는 마켓입니다.'
            });
        }
        
        if (market.is_finalized) {
            return res.status(400).json({
                success: false,
                errorType: 'MARKET_CLOSED',
                message: '이미 종료된 베팅입니다.'
            });
        }
        
        // 3. 트랜잭션 준비
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
        
        // 4. PKP로 트랜잭션 전송
        const result = await signAndSendTransactionWithIdx(
            userId,
            market.market_contract_address,
            data,
            betAmountWei.toString()
        );
        
        // 5. DB 업데이트
        // 참가자 수 업데이트
        await bettingRepository.updateParticipantCount(marketId, isAbove);
        
        // 베팅 금액 업데이트
        await bettingRepository.updateBetAmount(marketId, isAbove, betAmountWei.toString());
        
        // 베팅 기록 저장
        await bettingRepository.saveBet({
            userIdx: userIdx,
            betDirection: isAbove,
            amount: betAmountWei.toString(),
            betDetailIdx: marketId,
            transactionHash: result.transactionHash
        });
        
        res.status(200).json({
            success: true,
            message: '베팅 성공!',
            transactionHash: result.transactionHash,
            blockNumber: result.blockNumber,
            gasUsed: result.gasUsed,
            polygonscan: `https://polygonscan.com/tx/${result.transactionHash}`
        });
        
    } catch (error) {
        // 가스비 관련 에러 체크
        const errorMessage = error.message?.toLowerCase() || '';
        
        if (errorMessage.includes('insufficient funds') || 
            errorMessage.includes('gas') ||
            errorMessage.includes('underpriced') ||
            errorMessage.includes('fee')) {
            
            return res.status(400).json({
                success: false,
                errorType: 'INSUFFICIENT_GAS',
                message: '가스비가 부족합니다. 지갑에 POL을 충전해주세요.'
            });
        }
        
        // 네트워크 에러
        if (errorMessage.includes('network') || 
            errorMessage.includes('timeout') ||
            errorMessage.includes('connection')) {
            
            return res.status(503).json({
                success: false,
                errorType: 'NETWORK_ERROR',
                message: '네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'
            });
        }
        
        // 컨트랙트 에러
        if (errorMessage.includes('revert') || 
            errorMessage.includes('execution reverted')) {
            
            return res.status(400).json({
                success: false,
                errorType: 'CONTRACT_ERROR',
                message: '스마트 컨트랙트 실행 중 오류가 발생했습니다.'
            });
        }
        
        // 기타 에러
        res.status(500).json({
            success: false,
            errorType: 'UNKNOWN',
            message: error.message || '베팅 처리 중 오류가 발생했습니다.'
        });
    }
});


export const GetMainData = wrap(async (req, res) => {
    // 현재 시간 확인
    const provider = new ethers.providers.JsonRpcProvider(RPC_URL, {
        name: "matic",
        chainId: 137
    });
    
    const currentBlock = await provider.getBlock("latest");
    const currentTimestamp = currentBlock.timestamp;
    
    // 진행 중인 베팅 목록 가져오기 (현재 시간 전달)
    const bets = await bettingRepository.getActiveBets(currentTimestamp);

    // 프론트엔드 형식으로 변환
    const formattedBets = bets.map(bet => {
        const yesAmount = parseFloat(ethers.utils.formatEther(bet.yes_bet_amount.toString()));
        const noAmount = parseFloat(ethers.utils.formatEther(bet.no_bet_amount.toString()));
        const totalAmount = yesAmount + noAmount;

        // 찬성 수익률 계산 (총 베팅액 / 찬성 베팅액)
        const yesOdds = yesAmount > 0 ? (totalAmount / yesAmount) : 1.0;

        return {
            idx: bet.idx,
            title: bet.title,
            settlementTime: bet.settlement_time,
            yesOdds: yesOdds.toFixed(2),
            participantCount: bet.participant_count,
            yesParticipantCount: bet.yes_participant_count,
            noParticipantCount: bet.no_participant_count,
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
    const { marketId } = req.params;
    
    if (!marketId) {
        throw new Error('marketId가 필요합니다.');
    }
    
    // 1. 마켓 정보 조회
    const market = await bettingRepository.getMarketDetail(marketId);
    
    if (!market) {
        throw new Error('존재하지 않는 마켓입니다.');
    }
    
    // 2. 현재가격 조회 (Chainlink)
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
    } catch (error) {
        console.error("현재가격 조회 실패:", error.message);
    }
    
    // 3. 베팅 금액 및 배당률 계산
    const yesAmount = parseFloat(ethers.utils.formatEther(market.yes_bet_amount.toString()));
    const noAmount = parseFloat(ethers.utils.formatEther(market.no_bet_amount.toString()));
    const totalAmount = yesAmount + noAmount;
    
    const yesOdds = yesAmount > 0 ? (totalAmount / yesAmount) : 1.0;
    const noOdds = noAmount > 0 ? (totalAmount / noAmount) : 1.0;
    
    const yesParticipants = market.yes_participant_count;
    const noParticipants = market.no_participant_count;
    
    // 4. 참여자 수 조회
    const participants = await bettingRepository.getMarketParticipants(marketId);
    
    // 5. 사용자 베팅 내역 (로그인한 경우)
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
            console.error("사용자 베팅 내역 조회 실패:", error);
        }
    }
    
    // 6. 응답 데이터 구성
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
            yesParticipants: yesParticipants,
            noParticipants: noParticipants 
        },
        userBets: userBets
    });
});

export const FinishBet = wrap(async (req, res) => {
    const { marketAddress } = req.body;
    
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
    
    // Contract 인스턴스
    const marketContract = new ethers.Contract(
        marketAddress,
        BetMarketArtifact.abi,
        signer
    );
    
    // 정산 시간 확인
    const settlementTime = await marketContract.settlementTime();
    const currentBlock = await provider.getBlock("latest");
    const currentTimestamp = currentBlock.timestamp;
    
    if (currentTimestamp < settlementTime) {
        throw new Error(`아직 정산 시간이 아닙니다. (${Math.floor((Number(settlementTime) - currentTimestamp) / 60)}분 남음)`);
    }
    
    // 이미 정산되었는지 확인
    const isFinalized = await marketContract.isFinalized();
    if (isFinalized) {
        throw new Error('이미 정산된 마켓입니다.');
    }
    
    // Nonce & 가스 설정
    const nonce = await provider.getTransactionCount(signer.address, "pending");
    
    // 현재 가스 가격 확인
    const feeData = await provider.getFeeData();
    
    // 초고속 가스비 설정 (20초 내 확정)
    const priorityFee = ethers.utils.parseUnits("600", "gwei");
    const maxFee = ethers.utils.parseUnits("1200", "gwei");
    
    // finalize 호출 (v5)
    const tx = await marketContract.finalize({
        gasLimit: 600000, // 여유있게
        maxPriorityFeePerGas: priorityFee,
        maxFeePerGas: maxFee,
        nonce: nonce,
        type: 2 // EIP-1559
    });
    
    const receipt = await tx.wait();
    
    if (receipt.status === 0) {
        throw new Error(`정산 실패: ${tx.hash}`);
    }
    
    // 최종 가격 확인 (v5)
    const finalPrice = await marketContract.getLatestPrice();
    const targetPrice = await marketContract.targetPrice();
    
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