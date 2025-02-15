import { config } from "dotenv";
import { Message, Client } from "discord.js";

import Wallet from "../models/walletModel";
import bs58 from "bs58";
import {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    Transaction,
    SystemProgram,
    PublicKey,
    sendAndConfirmTransaction,
} from "@solana/web3.js";



import {
    getTokenInfo,
    getTokenPrice,
    getTokenInfo2,

} from "../config/getData";
import { getQuote, getSwapInstructions } from "../api/jupiter_v6";
import { fetchTrendingTokens } from "../api/fetchTrends";
import {
    deserializeInstruction,
    getAddressLookupTableAccounts,
    simulateTransaction,
    createVersionedTransaction,
} from "../config/transactionUtils";
import { createJitoBundle, sendJitoBundle } from "../api/jitoService";
import { TokenInfo, TokenPrice, TokenInfo2, TokenDetail } from "../types/tokenTypes";
import { getNumberDecimals, getTokenList } from "../config/getTokenList";



config();

const connection = new Connection(
    process.env.QUIKNODE_RPC || "https://api.devnet.solana.com",
    "confirmed"
);


interface IWallet {
    userId: string;
    publicKey: string;
    privateKey: string;
    balance: string;
    fee?: bigint;
    save: () => Promise<void>;
}


const sendDM = async (message: Message, content: string): Promise<void> => {
    try {
        await message.author.send(content);
    } catch (error) {
        console.error("Could not send DM:", error);
        await message.reply(
            "I couldn't send you a DM. Please check your privacy settings."
        );
    }
};

const sendDM2 = async (client: Client, content: string): Promise<void> => {
    const user = await client.users.fetch(process.env.DISCORD_USER_ID || "949497352375377940");
    console.log(`process.env.DISCORD_USER_ID is`, process.env.DISCORD_USER_ID);
    try {
        await user.send(content);
    } catch (error) {
        console.error("Could not send DM:", error);
        await user.send(
            "I couldn't send you a DM. Please check your privacy settings."
        );
    }
};


// Show Wallet
const showWallet = async (userId: string, message: Message) => {
    try {
        const wallet: IWallet | null = await Wallet.findOne({ userId });

        if (!wallet) {
            return await sendDM(
                message,
                "No wallet found. Please create one using `/wallet new`."
            );
        }

        const publicKey = new PublicKey(wallet.publicKey);
        const balanceLamports = await connection.getBalance(publicKey);

        const balanceSOL = (balanceLamports / LAMPORTS_PER_SOL).toFixed(4);

        if (balanceSOL !== wallet.balance) {
            wallet.balance = balanceSOL;
            await wallet.save();
        }

        await sendDM(
            message,
            `Hey @${message.author.username}, here’s your wallet info:\nPublic Key: \`${wallet.publicKey}\`\nBalance: ${balanceSOL} SOL`
        );
    } catch (error) {
        console.error("Error fetching balance:", error);
        await sendDM(
            message,
            "An error occurred while fetching your wallet balance. Please try again later."
        );
    }
};

// Create Wallet
const createWallet = async (userId: string, message: Message) => {
    try {
        const existingWallet: IWallet | null = await Wallet.findOne({ userId });

        if (existingWallet) {
            return await sendDM(message, "You already have a wallet.");
        }

        const newWallet = Keypair.generate();
        const walletData = new Wallet({
            userId,
            publicKey: newWallet.publicKey.toString(),
            privateKey: JSON.stringify(Array.from(newWallet.secretKey)),
            balance: "0",
        });

        await walletData.save();
        await sendDM(
            message,
            `Hey @${message.author.username}, your new wallet has been created!\nPublic Key: \`${newWallet.publicKey.toString()}\``
        );
    } catch (error) {
        console.error("Error creating wallet:", error);
        await sendDM(message, "An error occurred while creating your wallet.");
    }
};

// Export Wallet PrivateKey
const exportPrivateKey = async (userId: string, message: Message) => {
    try {
        const wallet: IWallet | null = await Wallet.findOne({ userId });

        if (!wallet) {
            return await sendDM(
                message,
                "No wallet found. Please create one using `/wallet new`."
            );
        }

        const privateKeyArray = JSON.parse(wallet.privateKey) as number[];
        const privateKeyHex = Buffer.from(privateKeyArray).toString("hex");

        await sendDM(
            message,
            `Hey @${message.author.username}, your Private Key: \`${privateKeyHex}\``
        );
    } catch (error) {
        console.error("Error parsing private key:", error);
        await sendDM(
            message,
            "An error occurred while retrieving your private key. Please try again."
        );
    }
};

// Withdraw SOL
const withdrawSOL = async (
    userId: string,
    solanaWallet: string,
    amount: string,
    message: Message
) => {
    try {
        const wallet: IWallet | null = await Wallet.findOne({ userId });
        if (!wallet) {
            return await sendDM(
                message,
                "No wallet found. Please create one using `/wallet new`."
            );
        }

        const balance = parseFloat(wallet.balance);
        const withdrawAmount = parseFloat(amount);

        if (withdrawAmount > balance) {
            return await sendDM(message, "Insufficient balance.");
        }

        let toPublicKey;
        try {
            toPublicKey = new PublicKey(solanaWallet);
        } catch (error) {
            return await sendDM(message, "Invalid Solana wallet address.");
        }
        const privateKey = Uint8Array.from(JSON.parse(wallet.privateKey));
        const fromWallet = Keypair.fromSecretKey(privateKey);

        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: fromWallet.publicKey,
                toPubkey: toPublicKey,
                lamports: withdrawAmount * LAMPORTS_PER_SOL,
            })
        );

        const signature = await sendAndConfirmTransaction(
            connection,
            transaction,
            [fromWallet]
        );
        wallet.balance = (balance - withdrawAmount).toString();
        await wallet.save();

        await sendDM(
            message,
            `Hey @${message.author.username}, successfully withdrew ${amount} SOL to ${solanaWallet}.`
        );
    } catch (error) {
        console.error("Error during withdrawal:", error);
        await sendDM(
            message,
            "An error occurred while processing your withdrawal."
        );
    }
};

// Set Fee
const setFee = async (userId: string, priority: number, message: Message) => {
    try {
        const wallet: IWallet | null = await Wallet.findOne({ userId });
        if (!wallet) {
            return await sendDM(
                message,
                "No wallet found. Please create one using `/wallet new`."
            );
        }

        const priorityFee = BigInt(priority * LAMPORTS_PER_SOL);

        wallet.fee = priorityFee;
        await wallet.save();

        await sendDM(
            message,
            `Priority fee set to ${(Number(priorityFee) / LAMPORTS_PER_SOL).toFixed(
                4
            )} SOL based on the selected priority: "${priority}".`
        );

        return priorityFee;
    } catch (error) {
        console.error("Error setting priority fee:", error);
        await sendDM(
            message,
            "An error occurred while setting the priority fee. Please try again."
        );
    }
};

// Show Token Portfolio
const showTokenPortfolio = async (userId: string, tokenAddress: string, message: Message): Promise<void> => {
    try {
        const wallet: IWallet | null = await Wallet.findOne({ userId });
        if (!wallet) {
            return await sendDM(
                message,
                "No wallet found. Please create one using `/wallet new`."
            );
        }

        const [info, price, info2] = await Promise.all([
            getTokenInfo(tokenAddress),
            getTokenPrice(tokenAddress),
            getTokenInfo2(tokenAddress),
        ]);

        const { name = "Unknown Token", symbol = "N/A", address = tokenAddress }: TokenInfo = info ?? {};
        const { price: currentPrice = 0, price5m = 0, price1h = 0, price6h = 0, price24h = 0 }: TokenPrice = price ?? {};
        const { totalSupply = "N/A", mcap = "N/A", fdv = "N/A" }: TokenInfo2 = info2 ?? {};

        const calcPercentChange = (oldPrice: number): string =>
            oldPrice ? (((currentPrice - oldPrice) / oldPrice) * 100).toFixed(2) : "N/A";

        const formatLargeNumber = (num: string | number): string => {
            const numValue = typeof num === 'string' ? parseFloat(num) : num;
            if (numValue >= 1e6) return (numValue / 1e6).toFixed(2) + "M";
            if (numValue >= 1e3) return (numValue / 1e3).toFixed(2) + "K";
            return numValue.toFixed(2);
        };

        const formattedPrice = currentPrice.toFixed(8);
        const formattedMcap = mcap !== "N/A" ? formatLargeNumber(mcap) : "N/A";
        const formattedFDV = fdv !== "N/A" ? formatLargeNumber(fdv) : "N/A";

        const percentChange5m = calcPercentChange(price5m);
        const percentChange1h = calcPercentChange(price1h);
        const percentChange6h = calcPercentChange(price6h);
        const percentChange24h = calcPercentChange(price24h);

        const msg = [
            `**Token Portfolio:**`,
            `Token: **${name}** (**${symbol}**)`,
            `Address: **${address}**`,
            `Price: **$${formattedPrice}**`,
            `5m: **${percentChange5m}%** 1h: **${percentChange1h}%** 6h: **${percentChange6h}%** 24h: **${percentChange24h}%**`,
            `Market Cap: **$${formattedMcap}** FDV: **$${formattedFDV}**`,
            `Wallet Balance: ${wallet.balance} SOL`,
        ].join("\n");

        await sendDM(message, msg);

    } catch (error) {
        console.error("Error fetching token information:", error);
        await sendDM(
            message,
            "An error occurred while retrieving the token information. Please try again later."
        );
    }
};

// Swap Token Using Jito

const swapToken = async (
    userId: string,
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number,
    message: Message | Client
): Promise<void> => {
    try {
        const wallet = await Wallet.findOne({ userId });
        if (!wallet) {
            const content = "No wallet found. Please create one using `/wallet new`.";
            if (message instanceof Message) {
                await sendDM(message, content);
            } else {
                await sendDM2(message, content);
            }
            return;
        }

        const content = `🔄 Starting swap transaction...\nInput Token: ${inputMint}\nOutput Token: ${outputMint}\nAmount: ${amount} SOL\nSlippage: ${slippageBps / 100}%`;
        if (message instanceof Message) {
            await sendDM(message, content);
        } else {
            await sendDM2(message, content);
        }

        const publicKey = new PublicKey(wallet.publicKey);
        const userWallet = Keypair.fromSecretKey(
            Uint8Array.from(JSON.parse(wallet.privateKey))
        );

        // Step 1: Retrieve Quote from Jupiter
        const inputDecimals = await getNumberDecimals(inputMint);

        const quoteResponse = await getQuote(
            inputMint,
            outputMint,
            amount * Math.pow(10, inputDecimals),
            slippageBps
        );
        if (!quoteResponse?.routePlan) {
            const errorContent = "Failed to retrieve a quote. Please try again later.";
            if (message instanceof Message) {
                await sendDM(message, errorContent);
            } else {
                await sendDM2(message, errorContent);
            }
            return;
        }
        console.log("✅ Quote received successfully");

        // Step 2: Get Swap Instructions
        const swapInstructions = await getSwapInstructions(
            quoteResponse,
            publicKey.toString()
        );
        if (swapInstructions === null) {
            const errorContent = "Failed to get swap instructions. Please try again later.";
            if (message instanceof Message) {
                await sendDM(message, errorContent);
            } else {
                await sendDM2(message, errorContent);
            }
            return;
        }
        console.log("✅ Swap instructions received successfully");

        const {
            setupInstructions,
            swapInstruction: swapInstructionPayload,
            cleanupInstruction,
            addressLookupTableAddresses,
        } = swapInstructions;
        const swapInstruction = deserializeInstruction(swapInstructionPayload);

        // Step 3: Prepare Transaction Instructions
        const instructions = [
            ...setupInstructions.map(deserializeInstruction),
            swapInstruction,
            ...(cleanupInstruction ? [deserializeInstruction(cleanupInstruction)] : []),
        ];

        const addressLookupTableAccounts = await getAddressLookupTableAccounts(addressLookupTableAddresses);
        const latestBlockhash = await connection.getLatestBlockhash('finalized');
        if (!latestBlockhash?.blockhash)
            console.log("Failed to fetch latest blockhash.");

        // Step 4: Simulate Transaction for Compute Units
        let computeUnits = await simulateTransaction(
            instructions,
            publicKey,
            addressLookupTableAccounts,
            5
        );
        if (!computeUnits || typeof computeUnits !== 'number') {
            console.log("Transaction simulation failed or returned invalid compute units.");
            computeUnits = 0;
        }

        // Step 5: Create and Sign Versioned Transaction
        const feeMicroLamports =
            wallet.fee !== undefined ? BigInt(wallet.fee) : BigInt(0);
        const feeMicroLamportsAsNumber = Number(feeMicroLamports);
        if (isNaN(feeMicroLamportsAsNumber)) {
            console.error("Fee is too large to fit into a number");
        }
        const transaction = createVersionedTransaction(
            instructions,
            publicKey,
            addressLookupTableAccounts,
            latestBlockhash.blockhash,
            computeUnits,
            { microLamports: feeMicroLamportsAsNumber }
        );
        transaction.sign([userWallet]);

        // Step 6: Create and Send Jito Bundle
        const jitoBundle = await createJitoBundle(transaction, userWallet);
        const bundleId = await sendJitoBundle(jitoBundle);

        // Final confirmation and transaction link
        const signature = bs58.encode(transaction.signatures[0]);
        const successContent = `✨ Swap executed successfully! 🔗 View on Solscan: https://solscan.io/tx/${signature}`;

        if (message instanceof Message) {
            await sendDM(message, successContent);
        } else {
            await sendDM2(message, successContent);
        }

        console.log(`✅ Jito bundle sent. Bundle ID: ${bundleId}`);

    } catch (err) {
        console.error('Error during swap:', err);
    }
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const buyTrendingTokens = async (client: Client): Promise<void> => {
    try {
        const trendingTokens = await fetchTrendingTokens();

        if (!trendingTokens || trendingTokens.length === 0) {
            console.warn("No trending tokens found.");
            return;
        }

        const userId = process.env.DISCORD_USER_ID || "949497352375377940";
        const inputMint = "So11111111111111111111111111111111111111112";
        const amount = 0.01;
        const slippageBps = 50;

        const tokenSwapPromises = trendingTokens.map(async (token: TokenDetail, index: number) => {
            console.log(`Attempting to buy token with address: ${token.address}`);

            if (client) {
                if (index > 0) await delay(30 * 1000);
                await swapToken(userId, inputMint, token.address, amount, slippageBps, client);
            } else {
                console.warn("Message object is not defined. Skipping DM.");
            }
        });

        await Promise.all(tokenSwapPromises);

        console.log("Token purchase process for trending tokens completed.");
    } catch (error) {
        console.error("Error posting trending tokens:", error);
    }
};

const sellTrendingTokens = async (client: Client): Promise<void> => {
    try {
        const tokenList = await getTokenList(process.env.PUBLIC_KEY || "J7sHo1LpayZjcaqw5C9QBqnq5fYWPRRLmdtWeCcJGtLT", connection);

        if (!tokenList) {
            console.warn("No trending tokens found.");
            return;
        }

        console.log(`tokenList`, tokenList)

        const userId = process.env.DISCORD_USER_ID || "949497352375377940";
        const outputMint = "So11111111111111111111111111111111111111112";
        const slippageBps = 50;

        const tokenSwapPromises = tokenList.map(async ({ mintAddress, tokenBalance }: any, index: number) => {
            console.log(`Attempting to sell token with mint address: ${mintAddress}`);

            if (client) {
                if (index > 0) await delay(30 * 1000);  // 30 seconds delay between requests
                await swapToken(userId, mintAddress, outputMint, tokenBalance, slippageBps, client);
            } else {
                console.warn("Message object is not defined. Skipping DM.");
            }
        });

        await Promise.all(tokenSwapPromises);  // Wait for all swaps to finish

        console.log("Token purchase process for trending tokens completed.");
    } catch (error) {
        console.error("Error posting trending tokens:", error);
    }
};

export {
    showWallet,
    createWallet,
    exportPrivateKey,
    withdrawSOL,
    setFee,
    showTokenPortfolio,
    swapToken,
    buyTrendingTokens,
    sellTrendingTokens
};
