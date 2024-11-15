import { config } from "dotenv";
import { Message } from "discord.js";

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
import {
    deserializeInstruction,
    getAddressLookupTableAccounts,
    simulateTransaction,
    createVersionedTransaction,
} from "../config/transactionUtils";
import { createJitoBundle, sendJitoBundle } from "../api/jitoService";
import { TokenInfo, TokenPrice, TokenInfo2 } from "../types/tokenTypes";



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

const swapToken = async (userId: string, inputMint: string, outputMint: string, amount: number, slippageBps: number, message: Message): Promise<void> => {
    try {
        const wallet = await Wallet.findOne({ userId });
        if (!wallet) {
            await sendDM(
                message,
                "No wallet found. Please create one using `/wallet new`."
            );
            return;
        }
        await sendDM(
            message,
            `🔄 Starting swap transaction...\nInput Token: ${inputMint}\nOutput Token: ${outputMint}\nAmount: ${amount} SOL\nSlippage: ${slippageBps / 100
            }%`
        );

        const publicKey = new PublicKey(wallet.publicKey);
        const userWallet = Keypair.fromSecretKey(
            Uint8Array.from(JSON.parse(wallet.privateKey))
        );

        // Step 1: Retrieve Quote from Jupiter
        const quoteResponse = await getQuote(
            inputMint,
            outputMint,
            amount * LAMPORTS_PER_SOL,
            slippageBps
        );
        if (!quoteResponse?.routePlan) {
            await sendDM(message, "Failed to retrieve a quote. Please try again later.");
            return;
        }
        console.log("✅ Quote received successfully");

        // Step 2: Get Swap Instructions
        const swapInstructions = await getSwapInstructions(
            quoteResponse,
            publicKey.toString()
        );
        if (swapInstructions === null) {
            await sendDM(message, "Failed to get swap instructions. Please try again later.");
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
        await sendDM(
            message,
            `✨ Swap executed successfully! 🔗 View on Solscan: https://solscan.io/tx/${signature}`
        );

        console.log(`✅ Jito bundle sent. Bundle ID: ${bundleId}`);

    } catch (err) {

    }
}


export {
    showWallet,
    createWallet,
    exportPrivateKey,
    withdrawSOL,
    setFee,
    showTokenPortfolio,
    swapToken
};
