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
                message: "토큰이 없습니다.",
                redirectTo: "/login"
            });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        console.log("token : ",token)
        console.log("decoded : ",decoded)
        
        // ✅ google_id 저장
        req.user = {
            id: decoded.id,              // google_id
            idx: decoded.idx,            // user idx
            isAdmin: decoded.admin || false
        };
        
        next();
        
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: "유효하지 않은 토큰입니다.",
            redirectTo: "/login"
        });
    }
}


/**
 * JWT에서 id만 추출하는 헬퍼 함수 (미들웨어 없이 사용)
 */
export const extractIdFromToken = (authHeader) => {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new Error('토큰이 없습니다.');
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    return decoded.id;
};

/**
 * JWT에서 idx만 추출하는 헬퍼 함수
 */
export const extractIdxFromToken = (authHeader) => {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new Error('토큰이 없습니다.');
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    return decoded.idx;
};

/**
 * ✅ JWT에서 isAdmin 추출하는 헬퍼 함수
 */
export const extractAdminFromToken = (authHeader) => {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new Error('토큰이 없습니다.');
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    return decoded.admin || false;
};

/**
 * ✅ 관리자 권한 체크 미들웨어
 */
export const verifyAdmin = (req, res, next) => {
    try {
        // verifyToken을 먼저 거쳐야 하므로 req.user가 있어야 함
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: '인증이 필요합니다.',
                redirectTo: "/login"
            });
        }
        
        if (!req.user.isAdmin) {
            return res.status(403).json({
                success: false,
                message: '관리자 권한이 필요합니다.'
            });
        }
        
        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: '인증 실패',
            redirectTo: "/login"
        });
    }
};