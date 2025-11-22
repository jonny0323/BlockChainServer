// repository.js
import db from '../../config/db.js';

// ✅ 진행 중인 베팅 목록 조회
export const getActiveBets = async () => {
    const query = `
        SELECT 
            idx,
            title,
            participant_count,
            yes_participant_count, 
            no_participant_count,  
            yes_bet_amount,
            no_bet_amount,
            settlement_time,
            asset_type,
            target_price,
            is_finalized,
            created_at
        FROM bet_detail
        WHERE is_finalized = FALSE
        ORDER BY settlement_time ASC
    `;
    
    const [rows] = await db.query(query);
    return rows;
};

export const getMarketDetail = async (marketId) => {
    const query = `
        SELECT 
            idx,
            title,
            participant_count,
            yes_participant_count,  
            no_participant_count,   
            yes_bet_amount,
            no_bet_amount,
            settlement_time,
            asset_type,
            target_price,
            market_contract_address,
            price_feed_address,
            is_finalized,
            winner_direction,
            created_at
        FROM bet_detail
        WHERE idx = ?
    `;
    
    const [rows] = await db.query(query, [marketId]);
    return rows[0];
};

// ✅ 사용자의 베팅 내역 조회
export const getUserBetHistory = async (marketId, userId) => {
    const query = `
        SELECT 
            b.idx,
            b.amount,
            b.bet_direction,
            b.created_at,
            b.is_settled,
            b.transaction_hash
        FROM bet b
        WHERE b.bet_detail_idx = ? AND b.user_idx = ?
        ORDER BY b.created_at DESC
    `;
    
    const [rows] = await db.query(query, [marketId, userId]);
    return rows;
};

// ✅ 특정 마켓의 모든 베팅 조회 (참여자 수 계산용)
export const getMarketParticipants = async (marketId) => {
    const query = `
        SELECT 
            COUNT(DISTINCT user_idx) as yes_count
        FROM bet
        WHERE bet_detail_idx = ? AND bet_direction = TRUE
    `;
    
    const query2 = `
        SELECT 
            COUNT(DISTINCT user_idx) as no_count
        FROM bet
        WHERE bet_detail_idx = ? AND bet_direction = FALSE
    `;
    
    const [yesRows] = await db.query(query, [marketId]);
    const [noRows] = await db.query(query2, [marketId]);
    
    return {
        yesCount: yesRows[0].yes_count,
        noCount: noRows[0].no_count
    };
};

export const saveNewMarket = async (marketData) => {
    // ✅ UNIX timestamp를 MySQL DATETIME으로 변환
    const settlementDate = new Date(parseInt(marketData.settlementTime) * 1000);
    const mysqlDateTime = settlementDate.toISOString().slice(0, 19).replace('T', ' ');
    
    const query = `
        INSERT INTO bet_detail (
            title,
            settlement_time,
            target_price,
            asset_type,
            market_contract_address,
            price_feed_address
        ) VALUES (?, ?, ?, ?, ?, ?)
    `;
    
    const [result] = await db.query(query, [
        marketData.title,
        mysqlDateTime,  // ✅ 변환된 DATETIME 사용
        marketData.targetPrice,
        marketData.assetType,
        marketData.marketContractAddress,
        marketData.priceFeedAddress
    ]);
    
    return result;
};

// ✅ 참가자 수 업데이트
export const updateParticipantCount = async (marketId, isAbove) => {
    const field = isAbove ? 'yes_participant_count' : 'no_participant_count';
    
    const query = `
        UPDATE bet_detail 
        SET ${field} = ${field} + 1,
            participant_count = participant_count + 1
        WHERE idx = ?
    `;
    
    await db.query(query, [marketId]);
};

// ✅ 베팅 금액 업데이트
export const updateBetAmount = async (marketId, isAbove, amount) => {
    const field = isAbove ? 'yes_bet_amount' : 'no_bet_amount';
    
    const query = `
        UPDATE bet_detail 
        SET ${field} = ${field} + ?
        WHERE idx = ?
    `;
    
    await db.query(query, [amount, marketId]);
};

// ✅ 베팅 기록 저장
export const saveBet = async (betData) => {
    const query = `
        INSERT INTO bet (
            user_idx,
            bet_direction,
            amount,
            bet_detail_idx,
            transaction_hash
        ) VALUES (?, ?, ?, ?, ?)
    `;
    
    const [result] = await db.query(query, [
        betData.userIdx,
        betData.betDirection,
        betData.amount,
        betData.betDetailIdx,
        betData.transactionHash
    ]);
    
    return result;
};

// ✅ 사용자가 이미 베팅했는지 확인
export const checkUserBet = async (marketId, userId) => {
    const query = `
        SELECT COUNT(*) as count
        FROM bet
        WHERE bet_detail_idx = ? AND user_idx = ?
    `;
    
    const [rows] = await db.query(query, [marketId, userId]);
    return rows[0].count > 0;
};
