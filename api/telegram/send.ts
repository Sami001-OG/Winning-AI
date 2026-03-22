import "dotenv/config";

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { botToken, chatId, message } = req.body;
    
    if (!botToken || !chatId) {
      return res.status(400).json({ error: "Missing botToken or chatId" });
    }

    const cleanToken = botToken.replace(/^["']|["']$/g, '').trim();
    let cleanChatId = chatId.replace(/^["']|["']$/g, '').trim();
    
    if (cleanChatId.includes('t.me/')) {
      cleanChatId = cleanChatId.split('t.me/')[1].split('/')[0].split('?')[0];
    }
    
    if (!/^-?\d+$/.test(cleanChatId) && !cleanChatId.startsWith('@')) {
      cleanChatId = '@' + cleanChatId;
    }
    
    const finalToken = cleanToken.toLowerCase().startsWith('bot') 
      ? cleanToken.substring(3) 
      : cleanToken;

    const url = `https://api.telegram.org/bot${finalToken}/sendMessage`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: cleanChatId,
        text: message,
        parse_mode: 'HTML',
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: "Failed to send message", details: errorText });
    }
    
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error sending Telegram message via proxy:', error);
    return res.status(500).json({ error: "Failed to send message" });
  }
}
