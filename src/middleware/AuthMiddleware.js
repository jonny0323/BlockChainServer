import jwt from 'jsonwebtoken';
import 'dotenv/config';

/**
 * JWT 인증 미들웨어
 */
export function verifyToken(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        console.log("authHeader : ",authHeader)
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                message: "토큰이 없습니다."
            });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        console.log("token : ",token)
        console.log("decoded : ",decoded)
        
        // ✅ google_id 저장
        req.user = {
            id: decoded.id,              // google_id
            isAdmin: decoded.isAdmin || false
        };
        
        next();
        
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: "유효하지 않은 토큰입니다."
        });
    }
}


/**
 * JWT에서 idx만 추출하는 헬퍼 함수 (미들웨어 없이 사용)
 */
export const extractIdFromToken = (authHeader) => {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new Error('토큰이 없습니다.');
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    return decoded.id;
};

export const extractIdxFromToken = (authHeader) => {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new Error('토큰이 없습니다.');
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    return decoded.idx;
};




/**
 * 관리자 권한 체크 (JWT 기반)
 */
export const verifyAdmin = (req, res, next) => {
    try {
        const isAdmin = extractAdminFromToken(req.headers.authorization);
        
        if (!isAdmin) {
            return res.status(403).json({
                success: false,
                message: '관리자 권한이 필요합니다.'
            });
        }
        
        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: '인증 실패'
        });
    }
};


