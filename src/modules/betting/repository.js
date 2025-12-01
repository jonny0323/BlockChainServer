// repository.js에 추가할 함수들

import db from "../../config/db.js";

// ============================================
// ✅ 정산 가능한 베팅 목록 조회
// ============================================
export const getFinalizableBets = async (currentTimestamp) => {
    const query = `
        SELECT 
            idx,
            title,
            settlement_time,
            target_price,
            price_feed_address,
            market_contract_address,
            participant_count,
            yes_participant_count,
            no_participant_count,
            yes_bet_amount,
            no_bet_amount,
            is_finalized
        FROM bet_detail
        WHERE UNIX_TIMESTAMP(settlement_time) <= ?
          AND is_finalized = false
        ORDER BY settlement_time ASC
    `;
    
    const [rows] = await db.execute(query, [currentTimestamp]);
    return rows;
};

// ============================================
// ✅ 마켓 정산 완료 업데이트
// ============================================
export const updateMarketFinalized = async (marketId, winnerDirection, finalPrice) => {
    const query = `
        UPDATE bet_detail
        SET 
            is_finalized = true,
            winner_direction = ?,
            final_price = ?,
            finalized_at = NOW()
        WHERE idx = ?
    `;
    
    const [result] = await db.execute(query, [
        winnerDirection,
        finalPrice,
        marketId
    ]);
    
    return result;
};

// ============================================
// ✅ 기존 함수들 (참고용 - 이미 있다고 가정)
// ============================================

// 진행 중인 베팅 목록
export const getActiveBets = async (currentTimestamp) => {
    const query = `
        SELECT 
            idx,
            title,
            settlement_time,
            target_price,
            participant_count,
            yes_participant_count,
            no_participant_count,
            yes_bet_amount,
            no_bet_amount,
            asset_type,
            is_finalized
        FROM bet_detail
        WHERE is_finalized = false
        AND UNIX_TIMESTAMP(settlement_time) > ?
        ORDER BY settlement_time ASC
    `;
    
    const [rows] = await db.execute(query, [currentTimestamp]);
    return rows;
};


// 마켓 상세 정보
export const getMarketDetail = async (marketId) => {
    const query = `
        SELECT *
        FROM bet_detail
        WHERE idx = ?
    `;
    
    const [rows] = await db.execute(query, [marketId]);
    return rows[0];
};

// 참가자 수 업데이트
export const updateParticipantCount = async (marketId, isAbove) => {
    const column = isAbove ? 'yes_participant_count' : 'no_participant_count';
    
    const query = `
        UPDATE bet_detail
        SET 
            participant_count = participant_count + 1,
            ${column} = ${column} + 1
        WHERE idx = ?
    `;
    
    await db.execute(query, [marketId]);
};

// 베팅 금액 업데이트
export const updateBetAmount = async (marketId, isAbove, amount) => {
    const column = isAbove ? 'yes_bet_amount' : 'no_bet_amount';
    
    const query = `
        UPDATE bet_detail
        SET ${column} = ${column} + ?
        WHERE idx = ?
    `;
    
    await db.execute(query, [amount, marketId]);
};

// 베팅 기록 저장
export const saveBet = async ({ userIdx, betDirection, amount, betDetailIdx, transactionHash }) => {
    const query = `
        INSERT INTO bet
        (user_idx, bet_direction, amount, bet_detail_idx, transaction_hash, created_at)
        VALUES (?, ?, ?, ?, ?, NOW())
    `;
    
    const [result] = await db.execute(query, [
        userIdx,
        betDirection,
        amount,
        betDetailIdx,
        transactionHash
    ]);
    
    return result;
};

// 사용자 베팅 내역
export const getUserBetHistory = async (marketId, userIdx) => {
    const query = `
        SELECT 
            bet_direction,
            amount,
            transaction_hash,
            created_at
        FROM bet
        WHERE bet_detail_idx = ?
          AND user_idx = ?
        ORDER BY created_at DESC
    `;
    
    const [rows] = await db.execute(query, [marketId, userIdx]);
    return rows;
};

// 마켓 참여자 수
export const getMarketParticipants = async (marketId) => {
    const query = `
        SELECT 
            COUNT(DISTINCT CASE WHEN bet_direction = true THEN user_idx END) as yesCount,
            COUNT(DISTINCT CASE WHEN bet_direction = false THEN user_idx END) as noCount
        FROM bet
        WHERE bet_detail_idx = ?
    `;
    
    const [rows] = await db.execute(query, [marketId]);
    return rows[0];
};

// 새 마켓 저장
export const saveNewMarket = async ({ title, settlementTime, targetPrice, assetType, marketContractAddress, priceFeedAddress }) => {
    const query = `
        INSERT INTO bet_detail 
        (title, settlement_time, target_price, asset_type, market_contract_address, price_feed_address, created_at)
        VALUES (?, ?, ?, ?, ?, ?, NOW())
    `;
    
    const [result] = await db.execute(query, [
        title,
        settlementTime,
        targetPrice,
        assetType,
        marketContractAddress,
        priceFeedAddress
    ]);
    
    return result;
};