cat > init.sql << 'EOF'
CREATE DATABASE IF NOT EXISTS BlockChain CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE BlockChain;

-- Users 테이블
CREATE TABLE IF NOT EXISTS users (
    idx INT PRIMARY KEY AUTO_INCREMENT,
    google_id VARCHAR(100) NOT NULL UNIQUE,
    pkp_public_key VARCHAR(200) NOT NULL,
    pkp_token_id VARCHAR(200) NOT NULL,
    pkp_eth_address VARCHAR(200) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    INDEX idx_google_id (google_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- bet_detail 테이블
CREATE TABLE IF NOT EXISTS bet_detail (
    idx INT PRIMARY KEY AUTO_INCREMENT,
    title VARCHAR(100) NOT NULL,
    participant_count INT NOT NULL DEFAULT 0,
    yes_participant_count INT NOT NULL DEFAULT 0,
    no_participant_count INT NOT NULL DEFAULT 0,
    yes_bet_amount BIGINT NOT NULL DEFAULT 0,
    no_bet_amount BIGINT NOT NULL DEFAULT 0,
    settlement_time TIMESTAMP NOT NULL,
    asset_type INT NOT NULL,
    target_price BIGINT NOT NULL,
    market_contract_address VARCHAR(100) NOT NULL,
    is_finalized BOOLEAN NOT NULL DEFAULT FALSE,
    winner_direction ENUM('above', 'below', 'none') NOT NULL DEFAULT 'none',
    price_feed_address VARCHAR(100) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_market_address (market_contract_address),
    INDEX idx_settlement_time (settlement_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- bet 테이블
CREATE TABLE IF NOT EXISTS bet (
    idx INT PRIMARY KEY AUTO_INCREMENT,
    user_idx INT NOT NULL,
    bet_direction BOOLEAN NOT NULL,
    amount BIGINT NOT NULL,
    bet_detail_idx INT NOT NULL,
    transaction_hash VARCHAR(100) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_settled BOOLEAN NOT NULL DEFAULT FALSE,
    FOREIGN KEY (user_idx) REFERENCES users(idx) ON DELETE CASCADE,
    FOREIGN KEY (bet_detail_idx) REFERENCES bet_detail(idx) ON DELETE CASCADE,
    INDEX idx_user (user_idx),
    INDEX idx_bet_detail (bet_detail_idx),
    INDEX idx_tx_hash (transaction_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
EOF