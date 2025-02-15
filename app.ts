import "dotenv/config";
import { Client, GatewayIntentBits, Partials, Message, Channel } from "discord.js";
import connectDB from "./config/db";
import {
  showWallet,
  createWallet,
  exportPrivateKey,
  withdrawSOL,
  setFee,
  showTokenPortfolio,
  swapToken,
  buyTrendingTokens,
  sellTrendingTokens,
} from "./controllers/walletController";

connectDB();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel],
});

client.on("messageCreate", async (msg: Message) => {
  if (msg.author.bot) return;

  const userId = msg.author.id;
  const content = msg.content.trim();
  const isDM = !msg.guild;

  try {
    if (content.startsWith("/wallet show")) {
      await showWallet(userId, msg);
    } else if (content.startsWith("/wallet new")) {
      await createWallet(userId, msg);
    } else if (content.startsWith("/wallet export")) {
      await exportPrivateKey(userId, msg);
    } else if (content.startsWith("/wallet withdraw")) {
      const args = content.split(" ");
      const solanaWallet = args[2];
      const amount = args[3];

      if (!solanaWallet || !amount) {
        return await msg.reply("Usage: `/wallet withdraw <address> <amount>`");
      }

      await withdrawSOL(userId, solanaWallet, amount, msg);
    } else if (content.startsWith("/fees")) {
      const priorityInput = content.split(" ")[1];
      const priorityNumber = parseFloat(priorityInput);

      const priorityFees: { [key: string]: number } = {
        very_high: 0.01,
        high: 0.005,
        medium: 0.001,
      };

      const priorityFee =
        !isNaN(priorityNumber) && priorityNumber > 0
          ? priorityNumber
          : priorityFees[priorityInput?.toLowerCase()];

      if (priorityFee === undefined) {
        return await msg.reply(
          "Usage: `/fees <priority>` (e.g., a number or one of the following: very_high, high, medium)"
        );
      }

      await setFee(userId, priorityFee, msg);
    } else if (content.startsWith("/portfolio")) {
      const args = content.split(" ");
      const tokenAddress = args[1];

      if (!tokenAddress) {
        return await msg.reply(
          "Usage: `/portfolio <address>` to view token details."
        );
      }

      await showTokenPortfolio(userId, tokenAddress, msg);
    } else if (content.startsWith("/buy")) {
      const args = content.split(" ");
      const tokenAddress = args[1];
      const amount = parseFloat(args[2]);
      const slippageBps = parseInt(args[3]) || 50; // Default to 0.5% slippage if not specified

      if (!tokenAddress || isNaN(amount)) {
        return await msg.reply(
          "Usage: `/buy <tokenAddress> <amount> <slippageBps>`"
        );
      }

      const inputMint = "So11111111111111111111111111111111111111112"; // SOL mint address
      await swapToken(
        userId,
        inputMint,
        tokenAddress,
        amount,
        slippageBps,
        msg
      );

    } else if (content.startsWith("/sell")) {
      const args = content.split(" ");
      const tokenAddress = args[1];
      const amount = parseFloat(args[2]);
      const slippageBps = parseInt(args[3]) || 50; // Default to 0.5% slippage if not specified

      if (!tokenAddress || isNaN(amount)) {
        return await msg.reply(
          "Usage: `/sell <tokenAddress> <amount> <slippageBps>`"
        );
      }

      const outputMint = "So11111111111111111111111111111111111111112";
      await swapToken(
        userId,
        tokenAddress,
        outputMint,
        amount,
        slippageBps,
        msg
      );
    } else if (content.startsWith("/listTokens")) {
      await buyTrendingTokens(client);
    }
    else if (isDM) {
      await msg.reply(
        "Unknown command. Try `/wallet show`, `/wallet new`, `/wallet export`, `/wallet withdraw`, `/fees <priority>`, `/portfolio <address>`, `/buy <tokenAddress> <amount> <slippageBps>`, or `/sell <tokenAddress> <amount> <slippageBps>`."
      );
    }
  } catch (error) {
    console.error("Error handling command:", error);
    await msg.reply(
      "An error occurred while processing your request. Please try again."
    );
  }
});

client.once('ready', () => {
  setInterval(async () => {
    try {
      await sellTrendingTokens(client);
      await buyTrendingTokens(client);
    } catch (error) {
      console.error('Error in selling or buying trending tokens:', error);
    }
  }, 2 * 60 * 60 * 1000); // Interval of 6 minutes
});
client
  .login(process.env.DISCORD_TOKEN)
  .then(() => console.log("Discord client logged in."))
  .catch(console.error);
