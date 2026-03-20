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
    // Sanitize inputs in case they contain quotes or extra spaces from env vars
    const cleanToken = botToken.replace(/^["']|["']$/g, '').trim();
    const cleanChatId = chatId.replace(/^["']|["']$/g, '').trim();
    
    // Handle case where user might have included the 'bot' prefix in their token
    const finalToken = cleanToken.toLowerCase().startsWith('bot') 
      ? cleanToken.substring(3) 
      : cleanToken;

    const params = new URLSearchParams({
      chat_id: cleanChatId,
      text: message,
      parse_mode: 'HTML',
    });

    const url = `https://api.telegram.org/bot${finalToken}/sendMessage?${params.toString()}`;
    
    console.log(`Attempting to send Telegram message to chat: ${cleanChatId}`);
    
    // Using GET request avoids CORS preflight (OPTIONS) issues that can cause "Failed to fetch"
    const response = await fetch(url, {
      method: 'GET',
    });
    
    if (!response.ok) {
      const errorData = await response.text();
      console.error('Telegram API Error:', response.status, errorData);
    }
    
    return response.ok;
  } catch (error) {
    console.error('Error sending Telegram message:', error);
    return false;
  }
};
