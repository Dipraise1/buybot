require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const path = require('path');

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

let contractAddress = '';
let chatId = '';
let alertGif = '';

// Path to the image you want to send
const imagePath = path.join(__dirname, 'images/honkguru.jpeg');  // Make sure the image path is correct

bot.on('message', (msg) => {
    chatId = msg.chat.id;
    if (msg.chat.type === 'private') {
        bot.sendPhoto(chatId, imagePath, {
            caption: 'Please add me to a group to configure and use my features.'
        });
    } else {
        bot.sendMessage(chatId, 'Hello! I can track Solana contract buys and market cap. Use /setcontract [address] to set the contract address and /setgif [URL] to set the GIF for buy alerts.');
    }
});

bot.onText(/\/setcontract (.+)/, (msg, match) => {
    if (msg.chat.type === 'private') {
        bot.sendPhoto(msg.chat.id, imagePath, {
            caption: 'Please add me to a group to configure and use my features.'
        });
    } else {
        contractAddress = match[1];
        bot.sendMessage(msg.chat.id, `Contract address set to: ${contractAddress}`);
    }
});

bot.onText(/\/setgif (.+)/, (msg, match) => {
    if (msg.chat.type === 'private') {
        bot.sendPhoto(msg.chat.id, imagePath, {
            caption: 'Please add me to a group to configure and use my features.'
        });
    } else {
        alertGif = match[1];
        bot.sendMessage(msg.chat.id, `GIF for buy alerts set to: ${alertGif}`);
    }
});

const getContractData = async (address) => {
    try {
        const response = await axios.get(`https://api.solscan.io/account?address=${address}`);
        const txsResponse = await axios.get(`https://api.solscan.io/account/transactions?address=${address}&limit=10`);

        const marketCap = response.data.marketCap;
        const buys = txsResponse.data.filter(tx => tx.parsedInstruction.type === 'buy');

        return { buys, marketCap };
    } catch (error) {
        console.error(error);
        return null;
    }
};

const checkForUpdates = async () => {
    if (contractAddress) {
        const data = await getContractData(contractAddress);
        if (data) {
            const { buys, marketCap } = data;
            let message = `Market Cap: ${marketCap}\nRecent Buys:\n`;

            buys.forEach((buy, index) => {
                message += `Buy ${index + 1}: ${buy.parsedInstruction.amount} SOL\n`;
            });

            bot.sendMessage(chatId, message);

            if (alertGif) {
                bot.sendAnimation(chatId, alertGif);
            }
        }
    }
};

setInterval(checkForUpdates, 60000); // Check every minute
