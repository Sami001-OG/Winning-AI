export const isNYSession = (): boolean => {
  // NY session is typically 08:00 to 17:00 EST/EDT
  const now = new Date();
  const nyTimeStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hour12: false,
  }).format(now);

  let hour = parseInt(nyTimeStr, 10);
  if (hour === 24) hour = 0;
  
  // 08:00 to 17:00 (5 PM)
  if (!isNaN(hour) && hour >= 8 && hour < 17) {
    return true;
  }
  return false;
};

export const sendTelegramMessage = async (botToken: string, chatId: string, message: string) => {
  if (!botToken || !chatId) return false;
  
  try {
    console.log(`Attempting to send Telegram message to chat: ${chatId} via proxy`);
    
    const response = await fetch('/api/telegram/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        botToken,
        chatId,
        message,
      }),
    });
    
    if (!response.ok) {
      try {
        const errorData = await response.json();
        console.error('Telegram API Error via proxy:', response.status, errorData.error || errorData);
      } catch (e) {
        const textData = await response.text();
        console.error('Telegram API Error via proxy:', response.status, textData);
      }
    }
    
    return response.ok;
  } catch (error) {
    console.error('Error sending Telegram message:', error);
    return false;
  }
};
