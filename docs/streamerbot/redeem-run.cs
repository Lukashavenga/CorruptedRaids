// Streamer.bot action: a channel-point redeem opens a random dungeon (or raid).
//
// Trigger:  Twitch > Channel Reward > Reward Redemption  (pick your reward)
// Sub-action: Core > C# > Execute C# Code (paste this file)
//
// THE REWARD MUST BE CREATED IN STREAMER.BOT (Platforms > Twitch > Channel
// Point Rewards), not on the Twitch dashboard. Twitch only lets the app that
// created a reward refund it, so a dashboard-made reward opens dungeons fine
// and can never give the points back.
//
// Set the reward to "skip the redemption queue: OFF", so a redemption stays
// pending until this action marks it fulfilled or cancels (refunds) it.
//
// For a RAID reward, duplicate this action and change Reward to "raid".
using System;
using System.Net;
using System.Text;

public class CPHInline
{
    private const string Url = "http://localhost:8787/redeem";
    private const string Reward = "dungeon"; // or "raid"

    public bool Execute()
    {
        string rewardId = args.ContainsKey("rewardId") ? args["rewardId"].ToString() : "";
        string redemptionId = args.ContainsKey("redemptionId") ? args["redemptionId"].ToString() : "";

        string secret = CPH.GetGlobalVar<string>("crChatSecret", true);
        string reply = null;
        if (!string.IsNullOrEmpty(secret))
        {
            string body = "{\"userId\":\"" + Esc(args["userId"].ToString()) + "\","
                        + "\"userName\":\"" + Esc(args["user"].ToString()) + "\","
                        + "\"reward\":\"" + Reward + "\"}";
            try
            {
                using (var client = new WebClient())
                {
                    client.Encoding = Encoding.UTF8;
                    client.Headers[HttpRequestHeader.ContentType] = "application/json";
                    client.Headers["X-Chat-Secret"] = secret;
                    reply = client.UploadString(Url, "POST", body);
                }
            }
            catch (Exception e)
            {
                CPH.LogWarn("Corrupted Raids: /redeem failed - " + e.Message);
            }
        }
        else
        {
            CPH.LogWarn("Corrupted Raids: global crChatSecret is not set.");
        }

        // Anything other than a clear "a run opened" gives the points back:
        // the game being closed, a wrong secret, or a run already on screen.
        bool opened = reply != null && reply.Contains("\"ok\":true");
        if (rewardId != "" && redemptionId != "")
        {
            if (opened) CPH.TwitchRedemptionFulfill(rewardId, redemptionId);
            else CPH.TwitchRedemptionCancel(rewardId, redemptionId);
        }
        if (!opened)
        {
            CPH.SendMessage("@" + args["user"] + " no run could start right now - your points are back.");
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
