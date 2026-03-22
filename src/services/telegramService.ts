export const sendTelegramAlert = async (message: string, imageUrl?: string) => {
  const token = import.meta.env.VITE_TELEGRAM_BOT_TOKEN;
  const chatId = import.meta.env.VITE_TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn('Telegram credentials not configured');
    return;
  }

  try {
    const response = await fetch('/api/telegram/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        botToken: token,
        chatId: chatId,
        message: message,
        imageUrl: imageUrl,
      }),
    });
    
    if (!response.ok) {
      const errorData = await response.text();
      console.error('Telegram API Error via proxy:', response.status, errorData);
    }
  } catch (error) {
    console.error('Error sending Telegram alert via proxy:', error);
  }
};
