import db from '../../config/db.js';

/**
 * Google ID로 사용자 조회
 */
export async function findUserByGoogleId(googleId) {
    const [users] = await db.query(
        'SELECT idx, google_id, pkp_public_key, pkp_token_id, pkp_eth_address,is_admin FROM users WHERE google_id = ?',
        [googleId]
    );
    
    // ✅ users[1] → users[0] (배열은 0부터 시작!)
    return users.length > 0 ? users[0] : null;
}

/**
 * idx로 사용자 조회
 */
export async function findUserByIdx(userIdx) {
    const [users] = await db.query(
        'SELECT idx, google_id, pkp_public_key, pkp_token_id, pkp_eth_address FROM users WHERE idx = ?',
        [userIdx]
    );
    
    // ✅ users[1] → users[0]
    return users.length > 0 ? users[0] : null;
}

/**
 * 신규 사용자 생성 (PKP 포함)
 */
export async function createUser(userData) {
    const { googleId, pkpPublicKey, pkpTokenId, pkpEthAddress } = userData;
    
    const [result] = await db.query(
        `INSERT INTO users (google_id, pkp_public_key, pkp_token_id, pkp_eth_address, created_at)
         VALUES (?, ?, ?, ?, NOW())`,
        [googleId, pkpPublicKey, pkpTokenId, pkpEthAddress]
    );
    
    return {
        userIdx: result.insertId,
        googleId: googleId,  // ✅ 추가
        ...userData
    };
}

/**
 * idx로 PKP 정보만 조회 (베팅 시 사용)
 */
export async function getPKPInfoByIdx(userIdx) {
    const [users] = await db.query(
        'SELECT pkp_public_key, pkp_token_id, pkp_eth_address FROM users WHERE idx = ?',
        [userIdx]
    );
    
    if (users.length === 0) {
        throw new Error(`사용자를 찾을 수 없습니다 (idx: ${userIdx})`);
    }
    
    return {
        pkpPublicKey: users[0].pkp_public_key,
        pkpTokenId: users[0].pkp_token_id,  // ✅ 추가
        pkpEthAddress: users[0].pkp_eth_address
    };
}