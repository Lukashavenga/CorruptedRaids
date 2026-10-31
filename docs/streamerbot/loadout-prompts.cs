// Streamer.bot action: say each viewer's one nightly "something is waiting in
// your loadout" prompt in chat.
//
// Trigger:  Core > Timed Actions  (repeat every 30 seconds)
// Sub-action: Core > C# > Execute C# Code (paste this file)
//
// The game cannot push a chat message - it has no Twitch connection, on
// purpose (src/server/chat.ts) - so this asks for them. POST /prompts hands
// back the viewers whose fight has ended with a chest, unspent points or an
// unworn starter kit waiting, and never the same viewer twice in a night, so
// polling often is harmless. A message the bot fails to send is not resent.
//
// Same global as the other actions: crChatSecret, persisted, equal to
// CHAT_SECRET in the game's .env. The game also needs LOADOUT_URL set, or it
// answers 503 and sends nothing.
//
// Asks for ?format=text so there is no JSON to parse: one finished chat line
// per row, already addressed to the viewer.
using System;
using System.Net;
using System.Text;

public class CPHInline
{
    private const string Url = "http://localhost:8787/prompts?format=text";

    public bool Execute()
    {
        string secret = CPH.GetGlobalVar<string>("crChatSecret", true);
        if (string.IsNullOrEmpty(secret))
        {
            CPH.LogWarn("Corrupted Raids: global crChatSecret is not set.");
            return false;
        }

        string reply;
        try
        {
            using (var client = new WebClient())
            {
                client.Encoding = Encoding.UTF8;
                client.Headers["X-Chat-Secret"] = secret;
                reply = client.UploadString(Url, "POST", "");
            }
        }
        catch (Exception e)
        {
            // The game is not running, or LOADOUT_URL is unset (503). Logged,
            // not thrown: a timer must never take the action queue down.
            CPH.LogWarn("Corrupted Raids: /prompts failed - " + e.Message);
            return true;
        }

        foreach (string row in reply.Split('\n'))
        {
            string message = row.Trim();
            if (message.Length > 0) CPH.SendMessage(message);
        }
        return true;
    }
}
