export const isNYSession = (): boolean => {
  // NY session is typically 08:00 to 17:00 EST/EDT
  // We can use Intl.DateTimeFormat to get the current hour in New York
  const now = new Date();
  const nyTimeStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hour12: false,
  }).format(now);

  const hour = parseInt(nyTimeStr, 10);
  
  // TEMPORARILY DISABLED FOR TESTING - ALWAYS RETURN TRUE
  // 08:00 to 17:00 (5 PM)
  // if (!isNaN(hour) && hour >= 8 && hour < 17) {
  //   return true;
  // }
  // return false;
  return true;
};

export const sendTelegramMessage = async (botToken: string, chatId: string, message: string) => {
  if (!botToken || !chatId) return false;
  
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
      }),
    });
    
    return response.ok;
  } catch (error) {
    console.error('Error sending Telegram message:', error);
    return false;
  }
};
