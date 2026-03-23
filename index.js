const { Telegraf } = require('telegraf');

const bot = new Telegraf(process.env.BOT_TOKEN);

/* ========================
   🔹 SIMPLE DB
======================== */
const db = [];

/* ========================
   ⚙️ START
======================== */
bot.start(async (ctx) => {
  const param = ctx.startPayload;

  if (!param) {
    return ctx.reply('👋 Welcome!\nUse /store to save message');
  }

  const stored = db.find(d => d.uniqueParam === param);

  if (!stored) return ctx.reply('🚫 File not found');

  if (stored.expiresAt && Date.now() > stored.expiresAt) {
    return ctx.reply('⏳ Link expired');
  }

  if (stored.password) {
    ctx.session = { checkPass: param };
    return ctx.reply('🔐 Enter password');
  }

  return sendStored(ctx, stored);
});

/* ========================
   📦 STORE
======================== */
bot.command('store', async (ctx) => {
  ctx.session = {
    expiresAt: null,
    password: null,
    oneTime: false,
    step: 'menu'
  };

  await ctx.reply('⚙️ Choose options:', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '⏳ Expiry', callback_data: 'exp_menu' }],
        [{ text: '🔐 Password', callback_data: 'set_pass' }],
        [{ text: '👁 One-Time', callback_data: 'one_time' }],
        [{ text: '✅ Continue', callback_data: 'continue' }]
      ]
    }
  });
});

/* ========================
   ⏳ EXPIRY
======================== */
bot.action('exp_menu', (ctx) => {
  ctx.editMessageText('Select expiry:', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '10 min', callback_data: 'exp_10' }],
        [{ text: '1 hour', callback_data: 'exp_1h' }],
        [{ text: '1 day', callback_data: 'exp_1d' }],
        [{ text: 'Never', callback_data: 'exp_never' }]
      ]
    }
  });
});

bot.action(/exp_/, (ctx) => {
  const map = {
    exp_10: 10 * 60 * 1000,
    exp_1h: 60 * 60 * 1000,
    exp_1d: 24 * 60 * 60 * 1000
  };

  if (ctx.callbackQuery.data === 'exp_never') {
    ctx.session.expiresAt = null;
  } else {
    ctx.session.expiresAt = Date.now() + map[ctx.callbackQuery.data];
  }

  ctx.answerCbQuery('✅ Expiry set');
});

/* ========================
   🔐 PASSWORD
======================== */
bot.action('set_pass', (ctx) => {
  ctx.session.step = 'wait_pass';
  ctx.reply('🔐 Send password');
});

/* ========================
   👁 ONE TIME
======================== */
bot.action('one_time', (ctx) => {
  ctx.session.oneTime = true;
  ctx.answerCbQuery('👁 Enabled');
});

/* ========================
   ▶️ CONTINUE
======================== */
bot.action('continue', (ctx) => {
  ctx.session.step = 'send_msg';
  ctx.reply('📨 Send message to store');
});

/* ========================
   🧠 MESSAGE
======================== */
bot.on('message', async (ctx) => {

  if (ctx.session?.step === 'wait_pass') {
    ctx.session.password = ctx.message.text;
    ctx.session.step = 'menu';
    return ctx.reply('✅ Password saved');
  }

  if (ctx.session?.step === 'send_msg') {
    const uniqueParam = Math.random().toString(36).substring(2, 10);

    db.push({
      chatId: ctx.chat.id,
      messageId: ctx.message.message_id,
      uniqueParam,
      expiresAt: ctx.session.expiresAt,
      password: ctx.session.password,
      oneTime: ctx.session.oneTime,
      views: 0
    });

    const link = `https://t.me/${ctx.botInfo.username}?start=${uniqueParam}`;

    ctx.session = null;

    return ctx.reply(`✅ Stored!\n\n🔗 ${link}`);
  }

  if (ctx.session?.checkPass) {
    const stored = db.find(d => d.uniqueParam === ctx.session.checkPass);

    if (ctx.message.text !== stored.password) {
      return ctx.reply('❌ Wrong password');
    }

    ctx.session = null;
    return sendStored(ctx, stored);
  }
});

/* ========================
   📤 SEND
======================== */
async function sendStored(ctx, stored) {
  await ctx.telegram.copyMessage(ctx.chat.id, stored.chatId, stored.messageId);

  stored.views++;

  if (stored.oneTime) {
    const index = db.findIndex(d => d.uniqueParam === stored.uniqueParam);
    if (index !== -1) db.splice(index, 1);
  }
}

/* ======================== */
bot.launch();
console.log('🚀 Running...');
