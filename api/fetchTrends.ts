import { config } from "dotenv";
import axios, { AxiosResponse } from "axios";

import { TokenDetail, BirdEyeApiResponse } from "../types/tokenTypes";

config();

const options = {
    method: 'GET',
    headers: {
        accept: 'application/json',
        'x-chain': 'solana',
        'X-API-KEY': process.env.BIRD_EYE_API_KEY,
    },
};

// Fetch trending tokens from the BirdEye API using axios
const fetchTrendingTokens = async (): Promise<TokenDetail[] | undefined> => {
    try {
        const response: AxiosResponse<BirdEyeApiResponse> = await axios.get(
            'https://public-api.birdeye.so/defi/token_trending?sort_by=rank&sort_type=asc&offset=0&limit=5',
            options
        );

        const { data } = response;

        if (data.success) {
            return data.data.tokens;  // Return the tokens array
        } else {
            console.error('Failed to fetch trending tokens.');
            return undefined;  // Return undefined in case of failure
        }
    } catch (err) {
        console.error('Error fetching trending tokens:', err);
        return undefined;
    }
};

export { fetchTrendingTokens }