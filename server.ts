import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/telegram/send", async (req, res) => {
    try {
      const { botToken, chatId, message } = req.body;
      
      if (!botToken || !chatId) {
        return res.status(400).json({ error: "Missing botToken or chatId" });
      }

      const cleanToken = botToken.replace(/^["']|["']$/g, '').trim();
      let cleanChatId = chatId.replace(/^["']|["']$/g, '').trim();
      
      // Extract channel name if user pasted a t.me URL
      if (cleanChatId.includes('t.me/')) {
        cleanChatId = cleanChatId.split('t.me/')[1].split('/')[0].split('?')[0];
      }
      
      // If the chat ID is not purely numeric and doesn't start with @ or -, it's likely a public channel missing the @ prefix
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
        const errorData = await response.text();
        console.error('Telegram API Error:', response.status, errorData);
        
        let errorMessage = errorData;
        if (errorData.includes("chat not found")) {
          errorMessage = `Chat not found (${cleanChatId}). Ensure the bot is added to the channel/group as an administrator. If using a private group, ensure the ID is correct (often starts with '-100').`;
          
          // Try to fetch updates to see if we can find the correct chat ID
          try {
            const updatesUrl = `https://api.telegram.org/bot${finalToken}/getUpdates`;
            const updatesResponse = await fetch(updatesUrl);
            if (updatesResponse.ok) {
              const updatesData = await updatesResponse.json();
              if (updatesData.ok && updatesData.result.length > 0) {
                const recentChats = new Set();
                updatesData.result.forEach((update: any) => {
                  if (update.message && update.message.chat) {
                    recentChats.add(`${update.message.chat.title || update.message.chat.username || 'Unknown'}: ${update.message.chat.id}`);
                  } else if (update.channel_post && update.channel_post.chat) {
                    recentChats.add(`${update.channel_post.chat.title || update.channel_post.chat.username || 'Unknown'}: ${update.channel_post.chat.id}`);
                  } else if (update.my_chat_member && update.my_chat_member.chat) {
                    recentChats.add(`${update.my_chat_member.chat.title || update.my_chat_member.chat.username || 'Unknown'}: ${update.my_chat_member.chat.id}`);
                  }
                });
                
                if (recentChats.size > 0) {
                  errorMessage += `\n\nI found these recent chat IDs your bot has seen:\n${Array.from(recentChats).join('\n')}\n\nTry using one of these numbers as your VITE_TELEGRAM_CHAT_ID.`;
                } else {
                  errorMessage += `\n\nI checked your bot's recent activity but couldn't find any chat IDs. Try sending a message in your channel, or removing and re-adding the bot, then try again.`;
                }
              }
            }
          } catch (e) {
            console.error("Failed to fetch updates for debugging", e);
          }
        }
        
        return res.status(response.status).json({ error: errorMessage });
      }
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error sending Telegram message via proxy:', error);
      res.status(500).json({ error: "Failed to send message" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
