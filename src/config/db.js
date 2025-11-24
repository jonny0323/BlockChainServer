import mysql from 'mysql2';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 환경변수 사용
export const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    multipleStatements: true  // 여러 쿼리 실행 허용
}).promise();

console.log("MySQL Connection Pool Created.");

// 테이블 자동 초기화
async function initializeTables() {
    try {
        // users 테이블 존재 확인
        const [tables] = await pool.query("SHOW TABLES LIKE 'users'");
        
        if (tables.length === 0) {
            console.log("📋 Initializing database tables...");
            
            // init.sql 읽기 (src/config에서 프로젝트 루트로 2단계 위)
            const initSQL = fs.readFileSync(
                path.join(__dirname, '../../init.sql'), 
                'utf8'
            );
            
            // USE BlockChain; 제거 (이미 연결되어 있음)
            const cleanSQL = initSQL.replace(/USE\s+\w+\s*;/gi, '');
            
            // 테이블 생성
            await pool.query(cleanSQL);
            console.log("✅ Database tables initialized successfully");
        } else {
            console.log("✅ Database tables already exist");
        }
    } catch (error) {
        console.error("❌ Database initialization error:", error.message);
        // 에러가 나도 서버는 계속 실행
    }
}

// 서버 시작 시 자동 실행
initializeTables();

export default pool;