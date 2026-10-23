// Data model shared with the Host half: ui.json settings, activity.json
// sessions, the sprite atlas layout, and the bubble copy rules.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.RegularExpressions;

namespace PetPal
{
    internal sealed class Pose
    {
        public readonly string Id;
        public readonly int Row;
        public readonly int Frames;
        public readonly int DurationMs;

        public Pose(string id, int row, int frames, int durationMs)
        {
            Id = id;
            Row = row;
            Frames = frames;
            DurationMs = durationMs;
        }

        public static readonly Pose Idle = new Pose("idle", 0, 6, 1100);
        public static readonly Pose Waving = new Pose("waving", 3, 4, 700);

        public static readonly Pose[] All =
        {
            Idle,
            new Pose("running-right", 1, 8, 1060),
            new Pose("running-left", 2, 8, 1060),
            Waving,
            new Pose("jumping", 4, 5, 840),
            new Pose("failed", 5, 8, 1220),
            new Pose("waiting", 6, 6, 1010),
            new Pose("running", 7, 6, 820),
            new Pose("review", 8, 6, 1030),
        };

        public static Pose Find(string id)
        {
            if (string.IsNullOrEmpty(id))
            {
                return null;
            }

            foreach (var pose in All)
            {
                if (string.Equals(pose.Id, id, StringComparison.Ordinal))
                {
                    return pose;
                }
            }

            return null;
        }
    }

    internal sealed class UiConfig
    {
        private static readonly Regex SlugPattern = new Regex(
            "^[a-z0-9][a-z0-9-]{0,80}$", RegexOptions.CultureInvariant);

        private static readonly Regex ColorPattern = new Regex(
            "^#[0-9a-f]{6}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

        public string Active;
        public bool Enabled = true;
        public bool Visible = true;
        public double Scale = 1;
        public bool Bubbles = true;
        public int BubbleFontSize = 13;
        public int BubbleMaxWidth = 320;
        public double BubbleLifetime = 8;
        public string BubbleColor = "#0f0f0f";
        public int BubbleOpacity = 100;
        public string BubbleTextColor = "#ffffff";
        public bool ClickThrough;

        public bool HasPosition;
        public double WinX;
        public double WinY;

        public static UiConfig Parse(Dictionary<string, object> raw)
        {
            var ui = new UiConfig();
            if (raw == null)
            {
                return ui;
            }

            var active = Json.String(raw, "active", null);
            ui.Active = active != null && SlugPattern.IsMatch(active) ? active : null;
            ui.Enabled = Json.Boolean(raw, "enabled", true);
            ui.Visible = Json.Boolean(raw, "visible", true);
            ui.Scale = ClampNumber(Json.Number(raw, "scale", 1), 0.4, 2.4);
            ui.Bubbles = Json.Boolean(raw, "bubbles", true);
            ui.BubbleFontSize = ClampInteger(Json.Number(raw, "bubbleFontSize", 13), 9, 28);
            ui.BubbleMaxWidth = ClampInteger(Json.Number(raw, "bubbleMaxWidth", 320), 140, 640);
            ui.BubbleLifetime = ClampNumber(Json.Number(raw, "bubbleLifetime", 8), 0, 60);
            ui.BubbleOpacity = ClampInteger(Json.Number(raw, "bubbleOpacity", 100), 0, 100);
            ui.ClickThrough = Json.Boolean(raw, "clickThrough", false);

            var bubbleColor = Json.String(raw, "bubbleColor", null);
            if (bubbleColor != null && ColorPattern.IsMatch(bubbleColor))
            {
                ui.BubbleColor = bubbleColor.ToLowerInvariant();
            }

            var textColor = Json.String(raw, "bubbleTextColor", null);
            if (textColor != null && ColorPattern.IsMatch(textColor))
            {
                ui.BubbleTextColor = textColor.ToLowerInvariant();
            }

            var x = Json.Number(raw, "winX", double.NaN);
            var y = Json.Number(raw, "winY", double.NaN);
            if (!double.IsNaN(x) && !double.IsNaN(y) &&
                !double.IsInfinity(x) && !double.IsInfinity(y))
            {
                ui.HasPosition = true;
                ui.WinX = x;
                ui.WinY = y;
            }

            return ui;
        }

        public static double ClampNumber(double value, double min, double max)
        {
            if (double.IsNaN(value) || double.IsInfinity(value))
            {
                return min;
            }

            return Math.Min(Math.Max(value, min), max);
        }

        public static int ClampInteger(double value, int min, int max)
        {
            if (double.IsNaN(value) || double.IsInfinity(value))
            {
                return min;
            }

            return (int)Math.Round(Math.Min(Math.Max(value, min), max));
        }

        public bool SameBubbleAppearance(UiConfig other)
        {
            if (other == null)
            {
                return false;
            }

            return Bubbles == other.Bubbles &&
                   BubbleFontSize == other.BubbleFontSize &&
                   BubbleMaxWidth == other.BubbleMaxWidth &&
                   Math.Abs(BubbleLifetime - other.BubbleLifetime) < 0.0001 &&
                   BubbleOpacity == other.BubbleOpacity &&
                   string.Equals(BubbleColor, other.BubbleColor, StringComparison.Ordinal) &&
                   string.Equals(BubbleTextColor, other.BubbleTextColor, StringComparison.Ordinal);
        }
    }

    internal sealed class SessionInfo
    {
        public string Id;
        public string Title;
        public string State;
        public string Status;
        public string Label;
        public string Detail;
        public string Open;
        public long Rev;
        public bool Hold;

        public static SessionInfo FromDictionary(Dictionary<string, object> raw)
        {
            if (raw == null)
            {
                return null;
            }

            var id = Json.String(raw, "id", null);
            if (string.IsNullOrEmpty(id))
            {
                return null;
            }

            var session = new SessionInfo();
            session.Id = id;
            session.Title = Json.String(raw, "title", string.Empty);
            session.State = Json.String(raw, "state", "idle");
            session.Status = Json.String(raw, "status", null);
            session.Label = Json.String(raw, "label", null);
            session.Detail = Json.String(raw, "detail", null);
            session.Open = Json.String(raw, "open", "dsh://open");
            session.Rev = Json.Long(raw, "rev", 0);
            session.Hold = Json.Boolean(raw, "hold", false);
            return session;
        }
    }

    internal sealed class ActivityInfo
    {
        public long Seq;
        public long At;
        public readonly List<SessionInfo> Sessions = new List<SessionInfo>();

        public static ActivityInfo Parse(Dictionary<string, object> raw)
        {
            var activity = new ActivityInfo();
            if (raw == null)
            {
                return activity;
            }

            activity.Seq = Json.Long(raw, "seq", 0);
            activity.At = Json.Long(raw, "at", 0);

            var items = Json.Array(raw, "sessions");
            if (items == null)
            {
                return activity;
            }

            foreach (var item in items)
            {
                var session = SessionInfo.FromDictionary(item as Dictionary<string, object>);
                if (session != null)
                {
                    activity.Sessions.Add(session);
                }
            }

            return activity;
        }
    }

    internal static class SessionText
    {
        private static readonly Regex Whitespace = new Regex(
            "\\s+", RegexOptions.CultureInvariant);

        public static string Flatten(string text)
        {
            if (string.IsNullOrEmpty(text))
            {
                return string.Empty;
            }

            return Whitespace.Replace(text, " ").Trim();
        }

        public static bool IsActiveStatus(string status)
        {
            return status == "thinking" ||
                   status == "generating" ||
                   status == "tool" ||
                   status == "working" ||
                   status == "starting" ||
                   status == "active";
        }

        public static string IconKey(SessionInfo session)
        {
            if (session == null)
            {
                return "done";
            }

            if (session.Status == "done")
            {
                return "done";
            }

            if (session.Status == "failed" || session.Status == "blocked")
            {
                return "failed";
            }

            if (session.Status == "waiting")
            {
                return "waiting";
            }

            if (IsActiveStatus(session.Status))
            {
                return "active";
            }

            return "done";
        }

        /// <summary>The page's statusLine rule: label, or streaming reply text.</summary>
        public static string StatusLine(SessionInfo session)
        {
            if (session == null)
            {
                return string.Empty;
            }

            if (session.Status == "generating")
            {
                var streamed = Flatten(session.Detail);
                return streamed != string.Empty ? streamed : "正在生成回复";
            }

            var label = Flatten(session.Label);
            if (label == string.Empty)
            {
                switch (session.Status)
                {
                    case "done":
                        label = "已完成";
                        break;
                    case "failed":
                        label = "出错了";
                        break;
                    case "waiting":
                        label = "等待你的操作";
                        break;
                    case "tool":
                        label = "正在运行命令";
                        break;
                    case "working":
                        label = "正在分析请求";
                        break;
                    default:
                        label = string.Empty;
                        break;
                }
            }

            var detail = Flatten(session.Detail);
            if (detail != string.Empty && label != string.Empty)
            {
                return label + " · " + detail;
            }

            return label;
        }

        public static string Title(SessionInfo session)
        {
            if (session == null || string.IsNullOrEmpty(session.Title))
            {
                return "新会话";
            }

            return session.Title;
        }

        public static string Count(int value)
        {
            return "+" + value.ToString(CultureInfo.InvariantCulture);
        }
    }
}
