// Small JSON helpers around .NET Framework's JavaScriptSerializer.
//
// The Host half writes ui.json and activity.json, and the macOS companion
// writes drag coordinates back into ui.json. Unknown keys must survive a
// write, so every write is a read/merge/serialize of the whole document.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;

namespace PetPal
{
    internal static class Json
    {
        private static readonly UTF8Encoding Utf8NoBom = new UTF8Encoding(false);
        private static readonly JavaScriptSerializer Serializer = CreateSerializer();

        private static JavaScriptSerializer CreateSerializer()
        {
            return new JavaScriptSerializer
            {
                MaxJsonLength = 8 * 1024 * 1024,
                RecursionLimit = 64,
            };
        }

        public static bool TryReadObject(string path, out Dictionary<string, object> value)
        {
            value = null;
            string text;
            try
            {
                if (!File.Exists(path))
                {
                    return false;
                }

                text = File.ReadAllText(path, Encoding.UTF8);
            }
            catch (Exception)
            {
                return false;
            }

            if (string.IsNullOrWhiteSpace(text))
            {
                return false;
            }

            try
            {
                var parsed = Serializer.DeserializeObject(text) as Dictionary<string, object>;
                if (parsed == null)
                {
                    return false;
                }

                value = parsed;
                return true;
            }
            catch (Exception)
            {
                // The Host writes with writeFile, which is not atomic. A partial
                // read is expected occasionally and must not reset live state.
                return false;
            }
        }

        public static Dictionary<string, object> ReadObject(string path)
        {
            Dictionary<string, object> value;
            if (TryReadObject(path, out value))
            {
                return value;
            }

            return new Dictionary<string, object>();
        }

        public static void WriteObject(string path, Dictionary<string, object> value)
        {
            var json = Serializer.Serialize(value);
            var directory = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(directory))
            {
                Directory.CreateDirectory(directory);
            }

            var temporary = path + ".tmp";
            File.WriteAllText(temporary, json, Utf8NoBom);
            if (File.Exists(path))
            {
                try
                {
                    File.Replace(temporary, path, null);
                    return;
                }
                catch (Exception)
                {
                    // Different filesystem or AV interference: fall back to copy.
                }

                File.Copy(temporary, path, true);
                try
                {
                    File.Delete(temporary);
                }
                catch (Exception)
                {
                }
            }
            else
            {
                File.Move(temporary, path);
            }
        }

        public static string String(Dictionary<string, object> source, string key, string fallback)
        {
            if (source == null)
            {
                return fallback;
            }

            object value;
            if (!source.TryGetValue(key, out value))
            {
                return fallback;
            }

            var text = value as string;
            return text ?? fallback;
        }

        public static double Number(Dictionary<string, object> source, string key, double fallback)
        {
            if (source == null)
            {
                return fallback;
            }

            object value;
            if (!source.TryGetValue(key, out value) || value == null)
            {
                return fallback;
            }

            try
            {
                return Convert.ToDouble(value, CultureInfo.InvariantCulture);
            }
            catch (Exception)
            {
                return fallback;
            }
        }

        public static long Long(Dictionary<string, object> source, string key, long fallback)
        {
            if (source == null)
            {
                return fallback;
            }

            object value;
            if (!source.TryGetValue(key, out value) || value == null)
            {
                return fallback;
            }

            try
            {
                return Convert.ToInt64(value, CultureInfo.InvariantCulture);
            }
            catch (Exception)
            {
                return fallback;
            }
        }

        public static bool Boolean(Dictionary<string, object> source, string key, bool fallback)
        {
            if (source == null)
            {
                return fallback;
            }

            object value;
            if (!source.TryGetValue(key, out value))
            {
                return fallback;
            }

            if (value is bool)
            {
                return (bool)value;
            }

            bool parsed;
            if (value is string && bool.TryParse((string)value, out parsed))
            {
                return parsed;
            }

            return fallback;
        }

        public static object[] Array(Dictionary<string, object> source, string key)
        {
            if (source == null)
            {
                return null;
            }

            object value;
            if (!source.TryGetValue(key, out value) || value == null)
            {
                return null;
            }

            var array = value as object[];
            if (array != null)
            {
                return array;
            }

            // JavaScriptSerializer historically returned ArrayList for arrays;
            // accept any non-string enumerable so activity.json parses on every
            // .NET Framework servicing branch.
            var enumerable = value as System.Collections.IEnumerable;
            if (enumerable == null || value is string)
            {
                return null;
            }

            var result = new List<object>();
            foreach (var item in enumerable)
            {
                result.Add(item);
            }

            return result.ToArray();
        }
    }
}
