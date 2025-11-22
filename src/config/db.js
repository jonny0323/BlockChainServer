import mysql from 'mysql2';


// 💡 중요: 실제 비밀번호와 호스트는 환경 변수(.env)에 저장하여 사용해야 합니다.
export const pool = mysql.createPool({
    host: 'localhost',         
    user: 'jonny',             // ✨ jonny로 변경
    password: '0323',          // ✨ 비밀번호 '0323'로 변경
    database: 'BlockChain', 
    waitForConnections: true,  
    connectionLimit: 10,       
    queueLimit: 0              
}).promise();

console.log("MySQL Connection Pool Created.");

export default pool;