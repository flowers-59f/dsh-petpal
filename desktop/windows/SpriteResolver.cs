// Sprite atlas loading and WebP conversion.
//
// Petdex ships 8-column WebP atlases (1536x1872 or 1536x2288). Chromium and
// WKWebView understand WebP natively, but WPF/.NET Framework's imaging stack
// only does when the optional "WebP Image Extensions" store package is
// installed. To keep Windows installs dependency-free, tools/dwebp.exe
// (official libwebp 1.6.0) converts the atlas once into
// <pets>/.petdex/cache/<slug>-<mtime>-<size>.png, keyed by mtime and size.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Media.Imaging;

namespace PetPal
{
    internal sealed class SpriteSheet
    {
        private readonly BitmapSource _source;
        private readonly Dictionary<string, CroppedBitmap[]> _frames =
            new Dictionary<string, CroppedBitmap[]>(StringComparer.Ordinal);

        public readonly int Rows;
        public readonly int FrameWidth;
        public readonly int FrameHeight;

        private SpriteSheet(BitmapSource source)
        {
            _source = source;
            Rows = DetectRows(source.PixelWidth, source.PixelHeight);
            FrameWidth = Math.Max(1, source.PixelWidth / 8);
            FrameHeight = Math.Max(1, source.PixelHeight / Rows);
        }

        public static SpriteSheet Load(string path)
        {
            BitmapSource source;
            using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                source = BitmapFrame.Create(
                    stream,
                    BitmapCreateOptions.IgnoreImageCache | BitmapCreateOptions.PreservePixelFormat,
                    BitmapCacheOption.OnLoad);
                source.Freeze();
            }

            return new SpriteSheet(source);
        }

        /// <summary>
        /// 9 rows normally, 11 for ChatGPT-petdex exports (1536x2288).
        ///
        /// Petdex cells are 192x208, so the atlas height is rows * 208. The
        /// ratio rows/8 heuristic used by the web preview assumes square cells
        /// and misreads the 11-row atlas; estimate the row count from the
        /// 192:208 frame aspect first, then fall back to the ratio heuristic
        /// for square-cell sheets.
        /// </summary>
        public static int DetectRows(int width, int height)
        {
            if (width <= 0 || height <= 0)
            {
                return 9;
            }

            const double frameAspect = 208.0 / 192.0;
            var cellWidth = (double)width / 8.0;
            var estimate = height / (cellWidth * frameAspect);
            if (Math.Abs(estimate - 9) < 0.35)
            {
                return 9;
            }

            if (Math.Abs(estimate - 11) < 0.35)
            {
                return 11;
            }

            var ratio = (double)height / width;
            const double ratio9 = 9.0 / 8.0;
            const double ratio11 = 11.0 / 8.0;
            var best = Math.Abs(ratio11 - ratio) < Math.Abs(ratio9 - ratio) ? 11 : 9;
            var bestRatio = best == 11 ? ratio11 : ratio9;
            return Math.Abs(bestRatio - ratio) < 0.05 ? best : 9;
        }

        public CroppedBitmap[] Frames(Pose pose)
        {
            if (pose == null)
            {
                pose = Pose.Idle;
            }

            CroppedBitmap[] cached;
            if (_frames.TryGetValue(pose.Id, out cached))
            {
                return cached;
            }

            var row = pose.Row;
            if (row < 0 || row >= Rows)
            {
                row = 0;
            }

            var count = Math.Min(Math.Max(1, pose.Frames), 8);
            var result = new List<CroppedBitmap>(count);
            var top = row * FrameHeight;
            for (var column = 0; column < count; column += 1)
            {
                var left = column * FrameWidth;
                var width = Math.Min(FrameWidth, _source.PixelWidth - left);
                var height = Math.Min(FrameHeight, _source.PixelHeight - top);
                if (width <= 0 || height <= 0)
                {
                    break;
                }

                var crop = new CroppedBitmap(_source, new Int32Rect(left, top, width, height));
                crop.Freeze();
                result.Add(crop);
            }

            cached = result.ToArray();
            _frames[pose.Id] = cached;
            return cached;
        }
    }

    internal static class SpriteResolver
    {
        private static readonly System.Text.RegularExpressions.Regex SlugPattern =
            new System.Text.RegularExpressions.Regex(
                "^[a-z0-9][a-z0-9-]{0,80}$",
                System.Text.RegularExpressions.RegexOptions.CultureInvariant);

        private static readonly System.Text.RegularExpressions.Regex SpriteNamePattern =
            new System.Text.RegularExpressions.Regex(
                "^[a-z0-9._-]+\\.(webp|png)$",
                System.Text.RegularExpressions.RegexOptions.IgnoreCase |
                System.Text.RegularExpressions.RegexOptions.CultureInvariant);

        /// <summary>
        /// Finds the active pet's atlas. pet.json's spritesheetPath wins, then
        /// the two names the Host writes.
        /// </summary>
        public static string Resolve(string petsRoot, string slug, out string error)
        {
            error = null;
            if (string.IsNullOrEmpty(slug) || !SlugPattern.IsMatch(slug))
            {
                error = "invalid slug";
                return null;
            }

            var directory = Path.Combine(petsRoot, slug);
            var candidates = new List<string>();

            var pet = Json.ReadObject(Path.Combine(directory, "pet.json"));
            var declared = Json.String(pet, "spritesheetPath", null);
            if (!string.IsNullOrEmpty(declared))
            {
                var name = Path.GetFileName(declared.Replace('\\', '/'));
                if (SpriteNamePattern.IsMatch(name))
                {
                    candidates.Add(name);
                }
            }

            candidates.Add("spritesheet.webp");
            candidates.Add("spritesheet.png");

            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var name in candidates)
            {
                if (!seen.Add(name))
                {
                    continue;
                }

                var path = Path.Combine(directory, name);
                if (File.Exists(path))
                {
                    return path;
                }
            }

            error = "no spritesheet in " + directory;
            return null;
        }

        /// <summary>
        /// Returns a path WPF can decode. WebP is converted to a cached PNG with
        /// the bundled dwebp; if that is unavailable the original path is
        /// returned so a system WebP codec can still try.
        /// </summary>
        public static string EnsureBitmap(string spritePath, string slug, string cacheDir, out string error)
        {
            error = null;
            if (string.IsNullOrEmpty(spritePath))
            {
                error = "empty sprite path";
                return spritePath;
            }

            var extension = Path.GetExtension(spritePath);
            if (!string.Equals(extension, ".webp", StringComparison.OrdinalIgnoreCase))
            {
                return spritePath;
            }

            FileInfo source;
            try
            {
                source = new FileInfo(spritePath);
            }
            catch (Exception exception)
            {
                error = exception.Message;
                return spritePath;
            }

            if (!source.Exists)
            {
                error = "sprite does not exist";
                return spritePath;
            }

            string cached;
            try
            {
                Directory.CreateDirectory(cacheDir);
                var name = string.Format(
                    CultureInfo.InvariantCulture,
                    "{0}-{1}-{2}.png",
                    slug,
                    source.LastWriteTimeUtc.Ticks,
                    source.Length);
                cached = Path.Combine(cacheDir, name);
            }
            catch (Exception exception)
            {
                error = exception.Message;
                return spritePath;
            }

            if (File.Exists(cached))
            {
                try
                {
                    if (new FileInfo(cached).Length > 0)
                    {
                        return cached;
                    }
                }
                catch (Exception)
                {
                }
            }

            var dwebp = FindDwebp();
            if (dwebp == null)
            {
                error = "tools/dwebp.exe not found";
                return spritePath;
            }

            string conversionError;
            if (!ConvertWebp(dwebp, spritePath, cached, out conversionError))
            {
                error = conversionError;
                TryDelete(cached);
                return spritePath;
            }

            // Only one cache generation per pet is useful.
            try
            {
                foreach (var old in Directory.GetFiles(cacheDir, slug + "-*.png"))
                {
                    if (!string.Equals(old, cached, StringComparison.OrdinalIgnoreCase))
                    {
                        TryDelete(old);
                    }
                }
            }
            catch (Exception)
            {
            }

            Log.Debug("converted " + spritePath + " -> " + cached);
            return cached;
        }

        private static string FindDwebp()
        {
            string baseDirectory;
            try
            {
                baseDirectory = AppDomain.CurrentDomain.BaseDirectory;
            }
            catch (Exception)
            {
                return null;
            }

            var candidates = new[]
            {
                Path.Combine(baseDirectory, "tools", "dwebp.exe"),
                Path.Combine(baseDirectory, "dwebp.exe"),
            };

            foreach (var candidate in candidates)
            {
                if (File.Exists(candidate))
                {
                    return candidate;
                }
            }

            return null;
        }

        private static bool ConvertWebp(string dwebp, string input, string output, out string error)
        {
            error = null;
            var directory = Path.GetDirectoryName(output) ?? Environment.CurrentDirectory;
            var slug = Path.GetFileNameWithoutExtension(output);
            // Write next to the destination and move it into place, so a crash
            // or timeout can never leave a truncated PNG behind the cache name.
            var temporary = Path.Combine(
                directory,
                slug + "-tmp-" + Guid.NewGuid().ToString("N").Substring(0, 8) + ".png");

            try
            {
                var startInfo = new ProcessStartInfo
                {
                    FileName = dwebp,
                    Arguments = "-quiet \"" + input + "\" -o \"" + temporary + "\"",
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    WorkingDirectory = Path.GetDirectoryName(dwebp) ?? Environment.CurrentDirectory,
                };

                using (var process = new Process())
                {
                    process.StartInfo = startInfo;
                    process.Start();
                    Task<string> stdout = process.StandardOutput.ReadToEndAsync();
                    Task<string> stderr = process.StandardError.ReadToEndAsync();
                    var exited = process.WaitForExit(20000);
                    if (!exited)
                    {
                        try
                        {
                            process.Kill();
                        }
                        catch (Exception)
                        {
                        }

                        try
                        {
                            process.WaitForExit(2000);
                        }
                        catch (Exception)
                        {
                        }

                        error = "dwebp timed out";
                        return false;
                    }

                    var stderrText = string.Empty;
                    try
                    {
                        stderrText = stderr.Result;
                    }
                    catch (Exception)
                    {
                    }

                    try
                    {
                        stdout.Wait(1000);
                    }
                    catch (Exception)
                    {
                    }

                    var code = -1;
                    try
                    {
                        code = process.ExitCode;
                    }
                    catch (Exception)
                    {
                    }

                    if (code != 0)
                    {
                        error = "dwebp exit " + code +
                                (string.IsNullOrWhiteSpace(stderrText) ? string.Empty : ": " + stderrText.Trim());
                        return false;
                    }
                }

                if (!File.Exists(temporary) || new FileInfo(temporary).Length == 0)
                {
                    error = "dwebp produced no PNG";
                    return false;
                }

                try
                {
                    if (File.Exists(output))
                    {
                        try
                        {
                            File.Replace(temporary, output, null);
                            return true;
                        }
                        catch (Exception)
                        {
                        }

                        try
                        {
                            File.Delete(output);
                        }
                        catch (Exception)
                        {
                        }
                    }

                    File.Move(temporary, output);
                    return true;
                }
                catch (Exception exception)
                {
                    error = "cache move failed: " + exception.Message;
                    return false;
                }
            }
            catch (Exception exception)
            {
                error = exception.Message;
                return false;
            }
            finally
            {
                TryDelete(temporary);
            }
        }

        private static void TryDelete(string path)
        {
            try
            {
                File.Delete(path);
            }
            catch (Exception)
            {
            }
        }
    }
}
