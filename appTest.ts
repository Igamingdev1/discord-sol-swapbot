import { config } from "dotenv";
import { Connection, GetProgramAccountsFilter, PublicKey, ParsedAccountData } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

config();

const connection = new Connection(
    process.env.QUIKNODE_RPC || "https://api.devnet.solana.com",
    "confirmed"
);

const walletToQuery = 'J7sHo1LpayZjcaqw5C9QBqnq5fYWPRRLmdtWeCcJGtLT';

async function getNumberDecimals(mintAddress: string): Promise<number> {
    const info = await connection.getParsedAccountInfo(new PublicKey(mintAddress));
    const result = (info.value?.data as ParsedAccountData).parsed.info.decimals as number;
    console.log(result)
    return result;
}

async function getTokenAccounts(wallet: string, connection: Connection) {
    const filters: GetProgramAccountsFilter[] = [
        {
            dataSize: 165,
        },
        {
            memcmp: {
                offset: 32,
                bytes: wallet,
            },
        }];

    const accounts = await connection.getParsedProgramAccounts(
        TOKEN_PROGRAM_ID,
        { filters: filters }
    );

    console.log(`Found ${accounts.length} token account(s) for wallet ${wallet}.`);
    for (const [i, account] of accounts.entries()) {
        // Parse the account data
        const parsedAccountInfo: any = account.account.data;
        const mintAddress: string = parsedAccountInfo["parsed"]["info"]["mint"];
        const tokenBalance: number = parsedAccountInfo["parsed"]["info"]["tokenAmount"]["uiAmount"];

        // Log results
        console.log(`Token Account No. ${i + 1}: ${account.pubkey.toString()}`);
        // console.log(`Token Mint Address: ${mintAddress}`);
        console.log(`Token Balance: ${tokenBalance}`);

        // Get token decimals
        const decimals = await getNumberDecimals(mintAddress);
        console.log(`Decimals for Token Mint: ${decimals}`);
    }
}


getNumberDecimals("6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN");

getTokenAccounts(walletToQuery, connection)