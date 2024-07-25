require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const path = require('path');
const fs = require('fs').promises;
const winston = require('winston');
const schedule = require('node-schedule');

// Configuration
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });
const imagePath = path.join(__dirname, 'images', 'honkguru.jpeg');
const dataPath = path.join(__dirname, 'data.json');

// Logging setup
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple(),
  }));
}

// Data structure
let data = {
  contractAddress: '',
  alertGif: '',
  chatId: '',
  watchList: [],
  lastUpdate: null,
};

// Load data from file
const loadData = async () => {
  try {
    const fileData = await fs.readFile(dataPath, 'utf8');
    data = JSON.parse(fileData);
    logger.info('Data loaded successfully');
  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.info('Data file not found. Creating a new one.');
      await saveData();
    } else {
      logger.error('Error loading data:', error);
    }
  }
};

// Save data to file
const saveData = async () => {
  try {
    await fs.writeFile(dataPath, JSON.stringify(data), 'utf8');
    logger.info('Data saved successfully');
  } catch (error) {
    logger.error('Error saving data:', error);
  }
};

// Load data on startup
loadData();

// Helper function to send welcome message
const sendWelcomeMessage = async (chatId, isGroup) => {
  const caption = isGroup
    ? 'Hello! I can track Solana contract buys and market cap. Use /config to set up the bot, or /help to see all available commands.'
    : 'Please add me to a group to configure and use my features.';

  try {
    await bot.sendPhoto(chatId, imagePath, { 
      caption,
      contentType: '/images/honkguru.jpeg' // Explicitly set content type
    });
  } catch (error) {
    logger.error('Error sending welcome message:', error);
    await bot.sendMessage(chatId, caption);
  }
};

// Command handlers
bot.onText(/\/start/, (msg) => {
  sendWelcomeMessage(msg.chat.id, msg.chat.type !== 'private');
});

bot.onText(/\/help/, (msg) => {
  const helpMessage = `
Available commands:
/config - Start the configuration process
/status - Check the current status of the bot
/marketcap - Get the current market cap
/recentbuys - Get recent buy transactions
/addwatch [address] - Add an address to the watch list
/removewatch [address] - Remove an address from the watch list
/watchlist - View the current watch list
/schedule [time] - Schedule daily updates (e.g., /schedule 09:00)
  `;
  bot.sendMessage(msg.chat.id, helpMessage);
});

// New configuration process
bot.onText(/\/config/, async (msg) => {
  if (msg.chat.type === 'private') {
    await bot.sendMessage(msg.chat.id, 'Please add me to a group to configure and use my features.');
    return;
  }

  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, 'Let\'s configure the bot. Please enter the Solana contract address you want to track on honk.guru .');

  // Set up a one-time listener for the next message
  bot.once('message', async (responseMsg) => {
    if (responseMsg.chat.id !== chatId) return; // Ignore messages from other chats

    const address = responseMsg.text.trim();
    
    // Validate and scan the address
    try {
      const contractData = await getContractData(address);
      if (contractData) {
        data.contractAddress = address;
        data.chatId = chatId;
        await saveData();
        await bot.sendMessage(chatId, `Great! I've set the contract address to: ${address}`);
        await bot.sendMessage(chatId, 'You can now use /status to check the current configuration, or /help to see all available commands.');
      } else {
        await bot.sendMessage(chatId, 'I couldn\'t verify that address. Please try /config again with a valid Solana contract address.');
      }
    } catch (error) {
      logger.error('Error during configuration:', error);
      await bot.sendMessage(chatId, 'An error occurred while trying to verify the address. Please try /config again.');
    }
  });
});

bot.onText(/\/status/, (msg) => {
  const status = `
Current status:
Contract Address: ${data.contractAddress || 'Not set'}
Alert GIF: ${data.alertGif || 'Not set'}
Watch List: ${data.watchList.length} addresses
Last Update: ${data.lastUpdate ? new Date(data.lastUpdate).toLocaleString() : 'Never'}
  `;
  bot.sendMessage(msg.chat.id, status);
});

bot.onText(/\/addwatch (.+)/, (msg, match) => {
  const address = match[1];
  if (!data.watchList.includes(address)) {
    data.watchList.push(address);
    saveData();
    bot.sendMessage(msg.chat.id, `Address ${address} added to watch list.`);
  } else {
    bot.sendMessage(msg.chat.id, `Address ${address} is already in the watch list.`);
  }
});

bot.onText(/\/removewatch (.+)/, (msg, match) => {
  const address = match[1];
  const index = data.watchList.indexOf(address);
  if (index > -1) {
    data.watchList.splice(index, 1);
    saveData();
    bot.sendMessage(msg.chat.id, `Address ${address} removed from watch list.`);
  } else {
    bot.sendMessage(msg.chat.id, `Address ${address} is not in the watch list.`);
  }
});

bot.onText(/\/watchlist/, (msg) => {
  if (data.watchList.length > 0) {
    const list = data.watchList.join('\n');
    bot.sendMessage(msg.chat.id, `Watch List:\n${list}`);
  } else {
    bot.sendMessage(msg.chat.id, 'The watch list is empty.');
  }
});

bot.onText(/\/schedule (.+)/, (msg, match) => {
  const time = match[1];
  const [hour, minute] = time.split(':');
  if (hour >= 0 && hour < 24 && minute >= 0 && minute < 60) {
    schedule.scheduleJob(`${minute} ${hour} * * *`, () => {
      checkForUpdates();
    });
    bot.sendMessage(msg.chat.id, `Daily updates scheduled for ${time}`);
  } else {
    bot.sendMessage(msg.chat.id, 'Invalid time format. Please use HH:MM (24-hour format).');
  }
});

// API interaction
const getContractData = async (address) => {
  try {
    const response = await axios.get(`https://api.solscan.io/account?address=${address}`);
    const txsResponse = await axios.get(`https://api.solscan.io/account/transactions?address=${address}&limit=10`);

    const marketCap = response.data.marketCap;
    const buys = txsResponse.data.filter(tx => tx.parsedInstruction.type === 'buy');

    return { buys, marketCap };
  } catch (error) {
    logger.error('Error fetching contract data:', error);
    return null;
  }
};

bot.onText(/\/marketcap/, async (msg) => {
  if (!data.contractAddress) {
    bot.sendMessage(msg.chat.id, 'Contract address not set. Use /config to set up the bot.');
    return;
  }

  const contractData = await getContractData(data.contractAddress);
  if (contractData) {
    bot.sendMessage(msg.chat.id, `Current Market Cap: ${contractData.marketCap}`);
  } else {
    bot.sendMessage(msg.chat.id, 'Failed to fetch market cap data.');
  }
});

bot.onText(/\/recentbuys/, async (msg) => {
  if (!data.contractAddress) {
    bot.sendMessage(msg.chat.id, 'Contract address not set. Use /config to set up the bot.');
    return;
  }

  const contractData = await getContractData(data.contractAddress);
  if (contractData && contractData.buys.length > 0) {
    let message = 'Recent Buys:\n';
    contractData.buys.forEach((buy, index) => {
      message += `Buy ${index + 1}: ${buy.parsedInstruction.amount} SOL\n`;
    });
    bot.sendMessage(msg.chat.id, message);
  } else {
    bot.sendMessage(msg.chat.id, 'No recent buys found or failed to fetch data.');
  }
});

// Update checker
const checkForUpdates = async () => {
  if (data.contractAddress && data.chatId) {
    const contractData = await getContractData(data.contractAddress);
    if (contractData) {
      const { buys, marketCap } = contractData;
      let message = `Market Cap: ${marketCap}\nRecent Buys:\n`;

      buys.forEach((buy, index) => {
        message += `Buy ${index + 1}: ${buy.parsedInstruction.amount} SOL\n`;
      });

      bot.sendMessage(data.chatId, message);

      if (data.alertGif) {
        bot.sendAnimation(data.chatId, data.alertGif);
      }

      // Check watch list
      for (const address of data.watchList) {
        const watchData = await getContractData(address);
        if (watchData && watchData.buys.length > 0) {
          bot.sendMessage(data.chatId, `Activity detected for watched address ${address}`);
        }
      }

      data.lastUpdate = Date.now();
      saveData();
    }
  }
};

// Set up periodic checks
setInterval(checkForUpdates, 5 * 60 * 1000); // Check every 5 minutes

// Handle new chat members (bot added to a group)
bot.on('new_chat_members', async (msg) => {
  const newMembers = msg.new_chat_members;
  const botInfo = await bot.getMe();
  
  if (newMembers.some(member => member.id === botInfo.id)) {
    await sendWelcomeMessage(msg.chat.id, true);
  }
});

// Error handling
bot.on('polling_error', (error) => {
  logger.error('Polling error:', error);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Bot shutting down');
  await saveData();
  process.exit(0);
});

logger.info('Bot started');