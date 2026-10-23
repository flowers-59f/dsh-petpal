// File logging for the desktop companion. The process is a WinExe and normally
// has no console, so failures are only visible through these files:
//
//   <pets>/.petdex/app.log        verbose, only when PETDEX_DEBUG=1
//   <pets>/.petdex/app-error.log  always written for unexpected failures
using System;
using System.IO;
using System.Text;

namespace PetPal
{
    internal static class Log
    {
        private static readonly object Gate = new object();
        private static readonly UTF8Encoding Utf8NoBom = new UTF8Encoding(false);
        private static string _configDir;
        private static bool _debug;

        public static void Init(string configDir, bool debug)
        {
            _configDir = configDir;
            _debug = debug;
        }

        public static bool DebugEnabled
        {
            get { return _debug; }
        }

        public static void Debug(string message)
        {
            if (!_debug)
            {
                return;
            }

            Write("app.log", message);
        }

        public static void Error(string message, Exception error)
        {
            var line = message;
            if (error != null)
            {
                line += Environment.NewLine + error;
            }

            Write("app-error.log", line);
            Debug(message + (error != null ? " :: " + error.Message : string.Empty));
        }

        private static void Write(string file, string message)
        {
            if (string.IsNullOrEmpty(_configDir))
            {
                return;
            }

            lock (Gate)
            {
                try
                {
                    Directory.CreateDirectory(_configDir);
                    var path = Path.Combine(_configDir, file);
                    var stamp = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff");
                    File.AppendAllText(path, stamp + " " + message + Environment.NewLine, Utf8NoBom);
                }
                catch (Exception)
                {
                    // Logging must never take the companion down.
                }
            }
        }
    }
}
