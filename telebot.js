const TelegramBot = require('node-telegram-bot-api');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
require('dotenv').config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const ownerId = parseInt(process.env.OWNER_CHAT_ID);

if (!token || !ownerId) {
    console.warn('[TeleBot] Missing TELEGRAM_BOT_TOKEN or OWNER_CHAT_ID in .env. Bot disabled.');
    module.exports = { init: () => {} };
    return;
}

// Ensure authorized_users.json exists
const authFilePath = path.join(__dirname, 'authorized_users.json');
if (!fs.existsSync(authFilePath)) {
    fs.writeFileSync(authFilePath, JSON.stringify([]));
}

let bot;
try {
    bot = new TelegramBot(token, { polling: true });
} catch (e) {
    console.warn('[TeleBot] Failed to start bot:', e.message);
    module.exports = { init: () => {} };
    return;
}

console.log('[TeleBot] Initialized and polling for commands.');

// Helpers
function getAuthorizedUsers() {
    try {
        return JSON.parse(fs.readFileSync(authFilePath, 'utf8'));
    } catch (e) {
        return [];
    }
}

function saveAuthorizedUsers(users) {
    fs.writeFileSync(authFilePath, JSON.stringify(users, null, 2));
}

function isAuthorized(chatId) {
    if (chatId === ownerId) return true;
    const users = getAuthorizedUsers();
    return users.includes(chatId);
}

// Menus
const MAIN_MENU = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '🚀 Deploy & Restart', callback_data: 'cmd_deploy' }],
            [{ text: '🔋 Hardware Status', callback_data: 'cmd_status' }],
            [{ text: '👥 Manage Sudo Users', callback_data: 'cmd_manage' }]
        ]
    }
};

const MANAGE_MENU = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '➕ Add User', callback_data: 'cmd_adduser' }, { text: '➖ Remove User', callback_data: 'cmd_removeuser' }],
            [{ text: '📋 List Users', callback_data: 'cmd_listusers' }],
            [{ text: '🔙 Back to Menu', callback_data: 'cmd_menu' }]
        ]
    }
};

// Handlers
bot.onText(/\/(start|menu)/, (msg) => {
    const chatId = msg.chat.id;
    if (!isAuthorized(chatId)) {
        bot.sendMessage(chatId, '⛔ Unauthorized access.');
        return;
    }
    bot.sendMessage(chatId, '🎛️ **Nuvio Control Panel**\nSelect a command below:', Object.assign({ parse_mode: 'Markdown' }, MAIN_MENU));
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    if (!isAuthorized(chatId)) {
        bot.answerCallbackQuery(query.id, { text: 'Unauthorized', show_alert: true });
        return;
    }

    if (data === 'cmd_menu') {
        bot.editMessageText('🎛️ **Nuvio Control Panel**\nSelect a command below:', Object.assign({
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown'
        }, MAIN_MENU));
        bot.answerCallbackQuery(query.id);
    } 
    else if (data === 'cmd_deploy') {
        bot.answerCallbackQuery(query.id, { text: 'Deploying...' });
        bot.sendMessage(chatId, '🚀 Pulling from GitHub and installing dependencies...');
        
        exec('git pull origin main && npm install', (error, stdout, stderr) => {
            if (error) {
                bot.sendMessage(chatId, `❌ **Deploy Failed:**\n\`\`\`\n${stderr || error.message}\n\`\`\``, { parse_mode: 'Markdown' });
            } else {
                bot.sendMessage(chatId, `✅ **Deploy Successful:**\n\`\`\`\n${stdout.substring(0, 500)}\n\`\`\`\n\n🔄 Restarting server in 2 seconds...`, { parse_mode: 'Markdown' });
                setTimeout(() => {
                    process.exit(0); // Assuming PM2 or loop script will restart it
                }, 2000);
            }
        });
    }
    else if (data === 'cmd_status') {
        bot.answerCallbackQuery(query.id, { text: 'Fetching status...' });
        
        // Basic Node.js OS stats
        const totalMem = (os.totalmem() / 1024 / 1024).toFixed(0);
        const freeMem = (os.freemem() / 1024 / 1024).toFixed(0);
        const usedMem = totalMem - freeMem;
        const uptime = (os.uptime() / 60 / 60).toFixed(2);
        const load = os.loadavg()[0].toFixed(2);
        
        let replyMsg = `📊 **Server Status**\n\n`;
        replyMsg += `⏱️ **Uptime:** ${uptime} Hours\n`;
        replyMsg += `🧠 **RAM:** ${usedMem} MB / ${totalMem} MB\n`;
        replyMsg += `⚙️ **CPU Load:** ${load}\n\n`;

        // Try Termux API for battery (fails gracefully on Windows)
        exec('termux-battery-status', (error, stdout) => {
            if (!error && stdout) {
                try {
                    const bat = JSON.parse(stdout);
                    replyMsg += `🔋 **Battery:** ${bat.percentage}%\n`;
                    replyMsg += `🌡️ **Temperature:** ${bat.temperature}°C\n`;
                    replyMsg += `🔌 **Status:** ${bat.status}\n`;
                } catch (e) {}
            }
            bot.sendMessage(chatId, replyMsg, { 
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'cmd_menu' }]]
                }
            });
        });
    }
    else if (data === 'cmd_manage') {
        if (chatId !== ownerId) {
            bot.answerCallbackQuery(query.id, { text: 'Only the Owner can manage users.', show_alert: true });
            return;
        }
        bot.editMessageText('👥 **Manage Sudo Users**\nSelect an action:', Object.assign({
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown'
        }, MANAGE_MENU));
        bot.answerCallbackQuery(query.id);
    }
    else if (data === 'cmd_listusers') {
        if (chatId !== ownerId) return;
        const users = getAuthorizedUsers();
        bot.answerCallbackQuery(query.id);
        if (users.length === 0) {
            bot.sendMessage(chatId, 'No sudo users authorized.', {
                reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'cmd_menu' }]] }
            });
        } else {
            bot.sendMessage(chatId, `📋 **Sudo Users:**\n\n${users.map(u => `\`${u}\``).join('\n')}`, { 
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Menu', callback_data: 'cmd_menu' }]] }
            });
        }
    }
    else if (data === 'cmd_adduser') {
        if (chatId !== ownerId) return;
        bot.answerCallbackQuery(query.id);
        bot.sendMessage(chatId, 'Reply to this message with the Telegram Chat ID you want to ADD:', {
            reply_markup: { force_reply: true }
        }).then(sentMsg => {
            bot.onReplyToMessage(sentMsg.chat.id, sentMsg.message_id, (reply) => {
                const newId = parseInt(reply.text.trim());
                if (isNaN(newId)) {
                    bot.sendMessage(chatId, '❌ Invalid ID. Must be a number.');
                    return;
                }
                const users = getAuthorizedUsers();
                if (!users.includes(newId)) {
                    users.push(newId);
                    saveAuthorizedUsers(users);
                    bot.sendMessage(chatId, `✅ Added \`${newId}\` to authorized users.`, { parse_mode: 'Markdown' });
                } else {
                    bot.sendMessage(chatId, '⚠️ User already exists.');
                }
            });
        });
    }
    else if (data === 'cmd_removeuser') {
        if (chatId !== ownerId) return;
        bot.answerCallbackQuery(query.id);
        bot.sendMessage(chatId, 'Reply to this message with the Telegram Chat ID you want to REMOVE:', {
            reply_markup: { force_reply: true }
        }).then(sentMsg => {
            bot.onReplyToMessage(sentMsg.chat.id, sentMsg.message_id, (reply) => {
                const delId = parseInt(reply.text.trim());
                if (isNaN(delId)) return bot.sendMessage(chatId, '❌ Invalid ID.');
                let users = getAuthorizedUsers();
                if (users.includes(delId)) {
                    users = users.filter(id => id !== delId);
                    saveAuthorizedUsers(users);
                    bot.sendMessage(chatId, `✅ Removed \`${delId}\`.`, { parse_mode: 'Markdown' });
                } else {
                    bot.sendMessage(chatId, '⚠️ User not found.');
                }
            });
        });
    }
});

module.exports = {
    init: () => {
        // Expose a way for index.js to send messages (e.g. startup Cloudflare URL)
    },
    sendMessageToOwner: (msg) => {
        if (bot && ownerId) {
            bot.sendMessage(ownerId, msg, { parse_mode: 'Markdown' }).catch(() => {});
        }
    }
};
