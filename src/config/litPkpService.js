// src/config/litPkpService.js
import { LitNodeClient } from '@lit-protocol/lit-node-client';
import { EthWalletProvider } from '@lit-protocol/lit-auth-client';
import { LitActionResource } from '@lit-protocol/auth-helpers';
import { LIT_ABILITY } from '@lit-protocol/constants';
import { ethers } from 'ethers';
import { LitContracts } from '@lit-protocol/contracts-sdk';
import * as dotenv from 'dotenv';
import db from './db.js';

dotenv.config();

const AuthMethodType = {
    EthWallet: 1,
};

const AuthMethodScope = {
    SignAnything: 1,
};

let litNodeClient = null;

const getLitNodeClient = async () => {
    if (litNodeClient && litNodeClient.ready) {
        return litNodeClient;
    }

    litNodeClient = new LitNodeClient({
        litNetwork: 'datil-dev',
        debug: false,
    });

    await litNodeClient.connect();
    return litNodeClient;
};

//=====================================================================================================
// PKP Minting
//=====================================================================================================

export const mintAndRegisterPKP = async (googleId) => {
    const privateKey = process.env.ADMIN_PRIVATE_KEY;
    const rpcUrl = process.env.CHRONICLE_RPC_URL || 'https://yellowstone-rpc.litprotocol.com/';
    
    if (!privateKey) {
        throw new Error("ADMIN_PRIVATE_KEY 환경 변수가 설정되지 않았습니다.");
    }

    try {
        const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
        const wallet = new ethers.Wallet(privateKey, provider);
        
        const balance = await provider.getBalance(wallet.address);
        if (balance.isZero()) {
            throw new Error("잔액이 0입니다. Faucet: https://chronicle-yellowstone-faucet.getlit.dev/");
        }

        const litContracts = new LitContracts({
            signer: wallet,
            network: 'datil-dev',
        });
        
        await litContracts.connect();
        const mintResult = await litContracts.pkpNftContractUtils.write.mint();

        const pkpTokenId = mintResult.pkp.tokenId;
        const pkpPublicKey = mintResult.pkp.publicKey;
        const pkpEthAddress = mintResult.pkp.ethAddress;

        const messageToSign = `Registering PKP for Google ID: ${googleId}`;
        const signedMessage = await wallet.signMessage(messageToSign);

        const authMethod = {
            authMethodType: AuthMethodType.EthWallet,
            accessToken: JSON.stringify({
                sig: signedMessage,
                derivedVia: "web3.eth.personal.sign",
                signedMessage: messageToSign,
                address: wallet.address,
            }),
        };

        const authMethodId = ethers.utils.keccak256(
            ethers.utils.toUtf8Bytes(authMethod.accessToken)
        );
        
        await litContracts.addPermittedAuthMethod({
            pkpTokenId: pkpTokenId,
            authMethodType: authMethod.authMethodType,
            authMethodId: authMethodId,
            authMethodScopes: [AuthMethodScope.SignAnything],
        });

        return { pkpPublicKey, pkpTokenId, pkpEthAddress };

    } catch (error) {
        console.error("[Lit Service] PKP Minting 실패:", error);
        throw new Error(`PKP 생성 실패: ${error.message}`);
    }
};

//=====================================================================================================
// DB 조회
//=====================================================================================================

const getPKPInfoByUserId = async (userId) => {
    const query = `SELECT pkp_public_key, pkp_token_id, pkp_eth_address FROM users WHERE google_id = ?`;
    const [results] = await db.query(query, [userId]);
    
    if (results.length === 0) {
        throw new Error(`사용자를 찾을 수 없습니다: ${userId}`);
    }
    
    return {
        pkpPublicKey: results[0].pkp_public_key,
        pkpTokenId: results[0].pkp_token_id,
        pkpEthAddress: results[0].pkp_eth_address
    };
};

//=====================================================================================================
//  PKP Session Sigs 생성 (공식 방식)
//=====================================================================================================

const getPkpSessionSigs = async (litNodeClient, pkpPublicKey) => {
    const privateKey = process.env.ADMIN_PRIVATE_KEY;
    const provider = new ethers.providers.JsonRpcProvider(process.env.CHRONICLE_RPC_URL);
    const ethersSigner = new ethers.Wallet(privateKey, provider);
    
    //  공식 문서 방식: EthWalletProvider.authenticate 사용
    const pkpSessionSigs = await litNodeClient.getPkpSessionSigs({
        pkpPublicKey: pkpPublicKey,
        authMethods: [
            await EthWalletProvider.authenticate({
                signer: ethersSigner,
                litNodeClient,
                expiration: new Date(Date.now() + 1000 * 60 * 10).toISOString(), // 10분
            }),
        ],
        resourceAbilityRequests: [
            {
                resource: new LitActionResource("*"),
                ability: LIT_ABILITY.LitActionExecution,
            },
        ],
        expiration: new Date(Date.now() + 1000 * 60 * 10).toISOString(), // 10분
    });
    
    return pkpSessionSigs;
};

//=====================================================================================================
// 트랜잭션 서명 (executeJs 사용)
//=====================================================================================================

export const signTransactionWithId = async (userId, toAddress, data, value = "0") => {
    try {
        const pkpInfo = await getPKPInfoByUserId(userId);
        const litNodeClient = await getLitNodeClient();
        
        // ✅ Session Sigs 생성 (공식 방식)
        const sessionSigs = await getPkpSessionSigs(litNodeClient, pkpInfo.pkpPublicKey);
        
        // Polygon Provider
        const rpcUrl = process.env.POLYGON_RPC_URL;
        const provider = new ethers.providers.JsonRpcProvider(rpcUrl, {
            name: "matic",
            chainId: 137
        });
        
        const nonce = await provider.getTransactionCount(pkpInfo.pkpEthAddress, "pending");
        
        const txParams = {
            to: toAddress,
            from: pkpInfo.pkpEthAddress,
            value: ethers.BigNumber.from(value),
            data: data,
            nonce: nonce,
            chainId: 137,
            gasLimit: 400000,
            maxPriorityFeePerGas: ethers.utils.parseUnits("800", "gwei"),
            maxFeePerGas: ethers.utils.parseUnits("1500", "gwei"),
            type: 2,
        };
        
        const serializedTx = ethers.utils.serializeTransaction(txParams);
        const unsignedTxHash = ethers.utils.keccak256(serializedTx);
        
        // executeJs로 서명
        const signatureResult = await litNodeClient.executeJs({
            sessionSigs: sessionSigs,
            code: `(async () => {
                const sigShare = await Lit.Actions.signEcdsa({
                    toSign: dataToSign,
                    publicKey: pkpPublicKey,
                    sigName: "sig1",
                });
                Lit.Actions.setResponse({ response: sigShare });
            })();`,
            jsParams: {
                dataToSign: ethers.utils.arrayify(unsignedTxHash),
                pkpPublicKey: pkpInfo.pkpPublicKey,
            },
        });
        
        // signatures.sig1에서 서명 정보 추출
        const signature = signatureResult.signatures.sig1;
        
        const signedTx = ethers.utils.serializeTransaction(txParams, {
            r: "0x" + signature.r,
            s: "0x" + signature.s,
            v: signature.recid + 27,
        });
        
        return signedTx;
        
    } catch (error) {
        console.error(`[Lit Service] 트랜잭션 서명 실패:`, error);
        throw new Error(`트랜잭션 서명 실패: ${error.message}`);
    }
};

//=====================================================================================================
// 트랜잭션 서명 & 전송
//=====================================================================================================

export const signAndSendTransactionWithIdx = async (userId, toAddress, data, value = "0") => {
    try {
        const signedTx = await signTransactionWithId(userId, toAddress, data, value);
        
        const rpcUrl = process.env.POLYGON_RPC_URL;
        const provider = new ethers.providers.JsonRpcProvider(rpcUrl, {
            name: "matic",
            chainId: 137
        });
        
        const txResponse = await provider.sendTransaction(signedTx);
        
        const receipt = await txResponse.wait();
        
        return {
            transactionHash: receipt.transactionHash,
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed.toString(),
            status: receipt.status
        };
        
    } catch (error) {
        console.error(`[Lit Service] 트랜잭션 실행 실패:`, error);
        throw new Error(`트랜잭션 실행 실패: ${error.message}`);
    }
};