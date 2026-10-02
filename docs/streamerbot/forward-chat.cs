// Streamer.bot action: forward chat commands to Corrupted Raids.
//
// Trigger:  Twitch > Chat > Message
// Sub-action: Core > C# > Execute C# Code (paste this file)
//
// Set the secret once, as a PERSISTED global named crChatSecret, to the same
// value as CHAT_SECRET in the game's .env. It is read from a global rather
// than written here so that exporting or sharing this action does not share
// the secret with it.
//
// Sends only lines that start with "!". The game ignores everything else
// anyway, but a busy chat is hundreds of lines a minute and none of them need
// to leave Streamer.bot.
using System;
using System.Net;
using System.Text;

public class CPHInline
{
    private const string Url = "http://localhost:8787/chat";

    public bool Execute()
    {
        string message = args.ContainsKey("rawInput") ? args["rawInput"].ToString() : "";
        if (!message.TrimStart().StartsWith("!")) return true;

        string secret = CPH.GetGlobalVar<string>("crChatSecret", true);
        if (string.IsNullOrEmpty(secret))
        {
            CPH.LogWarn("Corrupted Raids: global crChatSecret is not set.");
            return false;
        }

        string body = "{\"userId\":\"" + Esc(args["userId"].ToString()) + "\","
                    + "\"userName\":\"" + Esc(args["user"].ToString()) + "\","
                    + "\"message\":\"" + Esc(message) + "\"}";
        try
        {
            using (var client = new WebClient())
            {
                client.Encoding = Encoding.UTF8;
                client.Headers[HttpRequestHeader.ContentType] = "application/json";
                client.Headers["X-Chat-Secret"] = secret;
                client.UploadString(Url, "POST", body);
            }
        }
        catch (Exception e)
        {
            // The game is not running, or the secret is wrong. Logged, not
            // thrown: a chat line must never take the bot's action queue down.
            CPH.LogWarn("Corrupted Raids: /chat failed - " + e.Message);
        }
        return true;
    }

    private static string Esc(string s)
    {
        var sb = new StringBuilder();
        foreach (char c in s)
        {
            if (c == '"' || c == '\\') sb.Append('\\').Append(c);
            else if (c < ' ') sb.Append(' ');
            else sb.Append(c);
        }
        return sb.ToString();
    }
}
