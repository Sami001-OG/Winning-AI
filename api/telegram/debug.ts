import "dotenv/config";

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { botToken } = req.body;
    if (!botToken) {
      return res.status(400).json({ error: "Missing botToken" });
    }

    const cleanToken = botToken.replace(/^["']|["']$/g, '').trim();
    const finalToken = cleanToken.toLowerCase().startsWith('bot') 
      ? cleanToken.substring(3) 
      : cleanToken;

    const updatesUrl = `https://api.telegram.org/bot${finalToken}/getUpdates`;
    const updatesResponse = await fetch(updatesUrl);
    
    if (!updatesResponse.ok) {
      const errorText = await updatesResponse.text();
      return res.status(updatesResponse.status).json({ error: "Failed to fetch updates from Telegram", details: errorText });
    }

    const updatesData = await updatesResponse.json();
    
    if (!updatesData.ok) {
      return res.status(400).json({ error: "Telegram API returned not ok", details: updatesData });
    }

    const recentChats = new Set();
    const rawChats: any[] = [];
    
    if (updatesData.result && updatesData.result.length > 0) {
      updatesData.result.forEach((update: any) => {
        let chat = null;
        if (update.message && update.message.chat) chat = update.message.chat;
        else if (update.channel_post && update.channel_post.chat) chat = update.channel_post.chat;
        else if (update.my_chat_member && update.my_chat_member.chat) chat = update.my_chat_member.chat;
        
        if (chat) {
          recentChats.add(`${chat.title || chat.username || chat.first_name || 'Unknown'}: ${chat.id} (Type: ${chat.type})`);
          rawChats.push(chat);
        }
      });
    }
    
    return res.status(200).json({ 
      success: true, 
      message: "Successfully fetched recent activity",
      foundChats: Array.from(recentChats),
      rawUpdatesCount: updatesData.result ? updatesData.result.length : 0,
      rawChats
    });
  } catch (error) {
    console.error('Error in debug endpoint:', error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
